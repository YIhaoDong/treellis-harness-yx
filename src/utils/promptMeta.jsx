// src/utils/promptMeta.js
// Unified builder for snapshot.meta:
// - meta.prompt: { mode, text/preview/hash, len }
// - meta.model:  { name, temperature?, top_p? }  (you can extend later)
// - meta.anchor: { scope:'global'|'node', path?, name?, uid? }

export const PROMPT_MODE = 'full'; 
// Options: 'full' | 'preview' | 'hash' | 'none'
// 你当前希望记录完整提示词 → 默认 'full'
// 若需隐私脱敏，改为 'preview'/'hash'/'none' 即可统一生效

function hashLite(s = '') {
  // tiny non-crypto hash for dedup/telemetry (do NOT use for security)
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * Build a compact, policy-aware prompt meta block.
 * 统一构造 prompt 元数据，按 PROMPT_MODE 自动裁剪/哈希。
 *
 * @param {Object} opts
 * @param {string} opts.text     - user prompt text
 * @param {string} opts.model    - model name (e.g., 'gpt-5')
 * @param {Object} opts.anchor   - { scope:'global'|'node', path?, name?, uid? }
 * @returns {{prompt:Object, model:Object, anchor:Object}}
 */
export function buildPromptMeta({ text = '', model, anchor }) {
  const len = text.length;

  const prompt = { mode: PROMPT_MODE, len };
  if (PROMPT_MODE === 'full') {
    prompt.text = text;
  } else if (PROMPT_MODE === 'preview') {
    prompt.preview = text.slice(0, 120) + (len > 120 ? ' …' : '');
  } else if (PROMPT_MODE === 'hash') {
    prompt.hash = hashLite(text);
  }
  // 'none' -> keep only len

  return {
    prompt,
    model: {
      name: model,
      // add these when/if you need them:
      // temperature, top_p
    },
    anchor, // { scope:'global'|'node', path?, name?, uid? }
  };
}

/**
 * Best-effort display name for a node.
 * 取一个尽量好看的节点显示名。
 */
export function nodeDisplayName(node) {
  if (!node || typeof node !== 'object') return 'node';
  return node.name || node?.primitive?.type || 'node';
}
