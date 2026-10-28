# -*- coding: utf-8 -*-
"""
Global Create Tech Eval batch runner for Treellis

Reads prompts (one per line) from:
  C:\Users\eeshi\Desktop\TTCS_Local_LLM_Overwrite - 副本\test\global_test_prompt.txt

Loads prompt assets from:
  C:\Users\eeshi\Desktop\TTCS_Local_LLM_Overwrite - 副本\public\prompts\*.txt

Runs conditions:
  - baseline: USER_PROMPT + jsonFormat + (small) jsonCase
  - treellis: baseline + parameterRules + colorRules + constraints_global

Runs model modes:
  - instant / thinking / auto (auto uses the same heuristic as your PromptPanel.jsx)

Saves:
  test\global_runs\<timestamp>\{baseline|treellis}\{instant|thinking|auto}\*.json
  test\global_runs\<timestamp>\...\raw\*.txt
  test\global_runs\<timestamp>\run_log.csv

Usage:
  python global_test.py
  python global_test.py --modes instant,thinking
  python global_test.py --condition baseline
  python global_test.py --temperature 1.0
"""

import os
import re
import csv
import json
import time
import hashlib
import argparse
import datetime
from typing import Optional, Dict, Any, List, Tuple

import requests

# =========================
# Fixed paths (as you specified)
# =========================
ROOT = r"C:\Users\eeshi\Desktop\TTCS_Local_LLM_Overwrite - 副本"
PROMPTS_DIR = os.path.join(ROOT, "public", "prompts")
PROMPT_FILE = os.path.join(ROOT, "test", "global_test_prompt.txt")
SCRIPT_DIR = os.path.join(ROOT, "test")

API_KEY_FILE = os.path.join(ROOT, "public", "OpenAiApiKey.txt")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# ===== GPT-5.2 model ids (match your PromptPanel.jsx) =====
MODEL_IDS = {
    "instant": "gpt-5.2-chat-latest",
    "thinking": "gpt-5.2",
}

# Default run config
DEFAULT_MODES = ["instant", "thinking", "auto"]
DEFAULT_CONDITION = "both"  # baseline | treellis | both
DEFAULT_TEMPERATURE = 1.0   # keep same as UI default; if API rejects, script auto-retries without temp

# pacing / retries
MIN_INTERVAL_S = 0.25
RETRY_MAX = 3
RETRY_BACKOFF_S = 1.2


# =========================
# Helpers (mirroring PromptPanel.jsx)
# =========================
def read_text_or_none(path: str) -> Optional[str]:
    try:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            t = f.read().strip()
            return t or None
    except Exception:
        return None


def clamp01(x: float) -> float:
    try:
        v = float(x)
    except Exception:
        return 1.0
    return max(0.0, min(1.0, v))


def is_complex_prompt(prompt_text: str) -> bool:
    s = str(prompt_text or "").strip()
    if not s:
        return False
    lines = [ln for ln in s.split("\n") if ln.strip()]
    if len(s) >= 420:
        return True
    if len(lines) >= 6:
        return True
    if re.search(r"[{}\[\]]", s) and len(s) >= 240:
        return True
    return False


def resolve_effective_model_id(mode: str, prompt_text: str, has_context: bool = False) -> str:
    if mode == "instant":
        return MODEL_IDS["instant"]
    if mode == "thinking":
        return MODEL_IDS["thinking"]
    # auto
    if has_context:
        return MODEL_IDS["thinking"]
    return MODEL_IDS["thinking"] if is_complex_prompt(prompt_text) else MODEL_IDS["instant"]


def extract_json_object(text: str) -> Dict[str, Any]:
    """
    Robust JSON extraction: raw JSON, fenced JSON, or first balanced {...} object in text.
    Mirrors your JSX extractJSONObject().
    """
    if not text or not isinstance(text, str):
        raise ValueError("Empty response")

    # 1) raw JSON
    try:
        return json.loads(text)
    except Exception:
        pass

    # 2) fenced
    m = re.search(r"```json\s*([\s\S]*?)```", text, flags=re.IGNORECASE) or re.search(
        r"```\s*([\s\S]*?)```", text, flags=re.IGNORECASE
    )
    if m and m.group(1):
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            pass

    # 3) first balanced JSON object
    s = text
    depth = 0
    start = -1
    for i, ch in enumerate(s):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                cand = s[start : i + 1]
                try:
                    return json.loads(cand)
                except Exception:
                    start = -1

    raise ValueError("Failed to parse JSON object from the response")


def normalize_root_scene(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Allow {scene:{...}} or direct {...}
    """
    if isinstance(obj, dict) and isinstance(obj.get("scene"), dict):
        return obj["scene"]
    if isinstance(obj, dict):
        return obj
    raise ValueError("Model did not return a valid scene object (not a dict).")


def short_hash(s: str, n: int = 10) -> str:
    h = hashlib.sha1((s or "").encode("utf-8")).hexdigest()
    return h[:n]


def sanitize_filename_piece(s: str, max_len: int = 20) -> str:
    s = (s or "").strip().replace("\n", " ").replace("\r", " ")
    s = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", s, flags=re.UNICODE)
    s = s.strip("_")
    if len(s) > max_len:
        s = s[:max_len]
    return s or "prompt"


def ensure_dir(p: str) -> None:
    os.makedirs(p, exist_ok=True)


# =========================
# Prompt asset loading
# =========================
def maybe_trim_jsoncase_for_baseline(full_case: Optional[str]) -> Optional[str]:
    """
    Baseline wants "少量 jsonCase": if you don't maintain a separate file,
    we trim the full jsonCase to the first ~2500 chars (typically a few examples).
    """
    if not full_case:
        return None
    if len(full_case) <= 2600:
        return full_case
    return full_case[:2500].rstrip() + "\n"


def load_global_assets() -> Dict[str, Optional[str]]:
    """
    Global-create uses:
      role_global.txt, task_global_create.txt, jsonFormat.txt, jsonCase.txt
    Treellis group additionally uses:
      parameterRules.txt, colorRules.txt, constraints_global.txt
    """
    assets = {
        "role_global": read_text_or_none(os.path.join(PROMPTS_DIR, "role_global.txt")),
        "task_global_create": read_text_or_none(os.path.join(PROMPTS_DIR, "task_global_create.txt")),
        "jsonFormat": read_text_or_none(os.path.join(PROMPTS_DIR, "jsonFormat.txt")),
        "jsonCase_full": read_text_or_none(os.path.join(PROMPTS_DIR, "jsonCase.txt")),
        "parameterRules": read_text_or_none(os.path.join(PROMPTS_DIR, "parameterRules.txt")),
        "colorRules": read_text_or_none(os.path.join(PROMPTS_DIR, "colorRules.txt")),
        "constraints_global": read_text_or_none(os.path.join(PROMPTS_DIR, "constraints_global.txt")),
    }
    assets["jsonCase_small"] = maybe_trim_jsoncase_for_baseline(assets["jsonCase_full"])
    return assets


def build_messages_global_create(
    assets: Dict[str, Optional[str]],
    user_prompt: str,
    condition: str,
) -> List[Dict[str, str]]:
    """
    Matches PromptPanel.jsx buildMessages() structure, but for Global Create only.

    Baseline:
      USER_PROMPT + JSON_FORMAT + JSON_CASE(small)
    Treellis:
      baseline + PARAMETER_RULES + COLOR_RULES + CONSTRAINTS_GLOBAL
    """
    role_text = assets.get("role_global") or "You are a CAD/CSG scene generator/editor."
    task_text = assets.get("task_global_create") or ""

    sys_parts = [
        role_text,
        "Return ONLY one JSON object. No markdown fences, no commentary.",
        task_text,
        "Strictly follow the provided JSON_FORMAT and constraints. Do not include any rule text in the output.",
    ]
    sys_content = "\n".join([p for p in sys_parts if p and p.strip()])

    parts = []
    parts.append("USER_PROMPT:\n" + str(user_prompt or "").strip())

    jf = assets.get("jsonFormat")
    if jf:
        parts.append("JSON_FORMAT (structure reference; DO NOT include this section in the output):\n" + jf)

    if condition == "baseline":
        jc = assets.get("jsonCase_small")
    else:
        jc = assets.get("jsonCase_full")

    if jc:
        parts.append("JSON_CASE (valid examples; DO NOT include this section in the output):\n" + jc)

    if condition == "treellis":
        pr = assets.get("parameterRules")
        cr = assets.get("colorRules")
        cg = assets.get("constraints_global")

        if pr:
            parts.append("PARAMETER_RULES (authoritative; DO NOT include this section in the output):\n" + pr)
        if cr and cr.strip():
            parts.append("COLOR_RULES (authoritative; DO NOT include this section in the output):\n" + cr.strip())
        if cg:
            parts.append("CONSTRAINTS_GLOBAL (authoritative; DO NOT include this section in the output):\n" + cg)

    return [
        {"role": "system", "content": sys_content},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


# =========================
# OpenAI call
# =========================
def read_api_key() -> str:
    # Priority: env var > file
    k = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if k:
        return k
    t = read_text_or_none(API_KEY_FILE)
    if t:
        return t.strip()
    raise RuntimeError(f"Missing API key. Set OPENAI_API_KEY or put key in: {API_KEY_FILE}")


def call_openai_chat(
    api_key: str,
    model: str,
    temperature: Optional[float],
    messages: List[Dict[str, str]],
) -> Dict[str, Any]:
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

    def _post(payload: Dict[str, Any]) -> requests.Response:
        return requests.post(OPENAI_URL, headers=headers, json=payload, timeout=180)

    payload = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": messages,
    }
    if temperature is not None:
        payload["temperature"] = float(clamp01(temperature))

    last_err = None
    for attempt in range(RETRY_MAX + 1):
        try:
            r = _post(payload)

            # transient retry
            if r.status_code in (429,) or 500 <= r.status_code <= 599:
                last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
                if attempt < RETRY_MAX:
                    time.sleep(RETRY_BACKOFF_S * (attempt + 1))
                    continue

            # If API complains about temperature unsupported, retry once without it
            if r.status_code == 400 and temperature is not None:
                txt = (r.text or "")
                if "temperature" in txt.lower() and ("unsupported" in txt.lower() or "not allowed" in txt.lower()):
                    payload.pop("temperature", None)
                    r = _post(payload)

            r.raise_for_status()
            return r.json()

        except Exception as e:
            last_err = e
            if attempt < RETRY_MAX:
                time.sleep(RETRY_BACKOFF_S * (attempt + 1))
                continue
            raise last_err


# =========================
# Main runner
# =========================
def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--condition", type=str, default=DEFAULT_CONDITION,
                    choices=["baseline", "treellis", "both"],
                    help="Run baseline / treellis / both")
    ap.add_argument("--modes", type=str, default=",".join(DEFAULT_MODES),
                    help="Comma-separated: instant,thinking,auto")
    ap.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE,
                    help="0~1; if API rejects, script retries without temperature")
    ap.add_argument("--min_interval", type=float, default=MIN_INTERVAL_S,
                    help="Min seconds between calls")
    return ap.parse_args()


def main():
    args = parse_args()

    api_key = read_api_key()
    assets = load_global_assets()

    if not os.path.exists(PROMPT_FILE):
        raise RuntimeError(f"Prompt file not found: {PROMPT_FILE}")

    with open(PROMPT_FILE, "r", encoding="utf-8") as f:
        prompts = [ln.strip() for ln in f.readlines()]
    prompts = [p for p in prompts if p]

    if not prompts:
        raise RuntimeError("No prompts found (file is empty after trimming).")

    run_tag = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_root = os.path.join(SCRIPT_DIR, "global_runs", run_tag)
    ensure_dir(out_root)

    modes = [m.strip() for m in (args.modes or "").split(",") if m.strip()]
    for m in modes:
        if m not in ("instant", "thinking", "auto"):
            raise RuntimeError(f"Unknown mode: {m}")

    conditions = ["baseline", "treellis"] if args.condition == "both" else [args.condition]

    log_path = os.path.join(out_root, "run_log.csv")
    with open(log_path, "w", encoding="utf-8", newline="") as csvf:
        writer = csv.DictWriter(
            csvf,
            fieldnames=[
                "run_tag",
                "prompt_id",
                "prompt_hash",
                "prompt_snippet",
                "condition",
                "model_mode",
                "effective_model",
                "temperature_requested",
                "duration_s",
                "parse_ok",
                "saved_json_path",
                "saved_raw_path",
                "finish_reason",
                "usage_prompt_tokens",
                "usage_completion_tokens",
                "usage_total_tokens",
                "error",
            ],
        )
        writer.writeheader()

        last_call_t = 0.0

        for idx, prompt_text in enumerate(prompts, start=1):
            prompt_id = f"{idx:03d}"
            ph = short_hash(prompt_text, 10)
            snippet = sanitize_filename_piece(prompt_text, 20)

            for condition in conditions:
                for mode in modes:
                    effective_model = resolve_effective_model_id(mode, prompt_text, has_context=False)

                    out_dir = os.path.join(out_root, condition, mode)
                    raw_dir = os.path.join(out_dir, "raw")
                    ensure_dir(out_dir)
                    ensure_dir(raw_dir)

                    file_stem = f"{prompt_id}_{ph}_{snippet}"
                    json_path = os.path.join(out_dir, file_stem + ".json")
                    raw_path = os.path.join(raw_dir, file_stem + ".txt")

                    # pacing
                    now = time.time()
                    wait = float(args.min_interval) - (now - last_call_t)
                    if wait > 0:
                        time.sleep(wait)

                    t0 = time.time()
                    parse_ok = False
                    err_msg = ""
                    finish_reason = ""
                    usage = {}

                    try:
                        messages = build_messages_global_create(
                            assets=assets,
                            user_prompt=prompt_text,
                            condition=condition,
                        )

                        data = call_openai_chat(
                            api_key=api_key,
                            model=effective_model,
                            temperature=args.temperature,
                            messages=messages,
                        )

                        content = ((data.get("choices") or [{}])[0]
                                   .get("message", {})
                                   .get("content", "")) or ""
                        finish_reason = (data.get("choices") or [{}])[0].get("finish_reason", "") or ""
                        usage = data.get("usage") or {}

                        # save raw
                        with open(raw_path, "w", encoding="utf-8") as rf:
                            rf.write(content)

                        obj = extract_json_object(content)
                        root = normalize_root_scene(obj)

                        # save JSON scene object
                        with open(json_path, "w", encoding="utf-8") as jf:
                            json.dump(root, jf, ensure_ascii=False, indent=2)

                        parse_ok = True

                    except Exception as e:
                        err_msg = str(e)

                    t1 = time.time()
                    last_call_t = t1
                    dur = round(t1 - t0, 4)

                    row = {
                        "run_tag": run_tag,
                        "prompt_id": prompt_id,
                        "prompt_hash": ph,
                        "prompt_snippet": snippet,
                        "condition": condition,
                        "model_mode": mode,
                        "effective_model": effective_model,
                        "temperature_requested": clamp01(args.temperature),
                        "duration_s": dur,
                        "parse_ok": int(parse_ok),
                        "saved_json_path": json_path if parse_ok else "",
                        "saved_raw_path": raw_path if os.path.exists(raw_path) else "",
                        "finish_reason": finish_reason,
                        "usage_prompt_tokens": usage.get("prompt_tokens", ""),
                        "usage_completion_tokens": usage.get("completion_tokens", ""),
                        "usage_total_tokens": usage.get("total_tokens", ""),
                        "error": err_msg,
                    }
                    writer.writerow(row)
                    csvf.flush()

                    print(
                        f"[{condition}/{mode}] prompt {prompt_id} "
                        f"model={effective_model} dur={dur}s parse_ok={parse_ok} "
                        f"{'ERR=' + err_msg[:160] if err_msg else ''}"
                    )

    print("\nDONE.")
    print("Outputs:", out_root)
    print("Log CSV:", log_path)


if __name__ == "__main__":
    main()