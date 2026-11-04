# Treellis generation harness

Treellis is a local editable 3D workspace with a training-free generation harness: prompt assembly, structured AML output, scoped edits, geometric validation, and bounded repair.

This repository contains the current Treellis application, based on the original `baseline-v1` snapshot and subsequent editor and generation updates. `SNAPSHOT-PROVENANCE.json` records the initial snapshot's publication changes; the Git history records later changes.

## Run locally

Use a supported Node.js installation, then run:

```sh
npm ci
npm run server
```

In another terminal, run `npm run dev` and open the URL shown by Vite.

Each user supplies their own OpenAI API key through the account chip next to Generate (or signs in for free generations when the server enables them). A local `OPENAI_API_KEY` environment variable is also supported. This repository contains no API key or `.local` development configuration.

## Responsive editor

On phones and tablets up to 1100 CSS pixels wide, the 3D view stays above one full-width editor. The bottom navigation switches between Structure, Parameters and Prompt; Model uses the full workspace for the 3D view. Parameter ranges and extra structure actions collapse to leave more editing space. Larger screens keep the three-column workspace.

Libraries opens the nine selected creation models directly in the editor. Parameter, color and name edits retain the current selection and highlight through Undo and Redo.

An optional offline demo can be built with `npm run build:static`. Open the generated `static-demo/treellis-static.html`; generation and server saving are disabled in this demo. Generated demos and verification artifacts are excluded from Git.

## Deploy

The frontend and the generation server deploy separately (see `.env.example`):

- **Frontend → Vercel** (`treellis.art`): import this repo as a Vite project and set `VITE_API_BASE=https://api.treellis.art`.
- **Generation server → Render** (`api.treellis.art`): in Render choose New → Blueprint, select this repo, and it creates the `treellis-api` service from `render.yaml` (free plan). Then add `api.treellis.art` under the service's Settings → Custom Domains and create the CNAME record Render shows at the DNS provider; Render issues the HTTPS certificate. Pushes to `main` redeploy automatically. The free plan sleeps after 15 minutes without requests (waking takes up to a minute and drops nothing, but a sleep or restart drops generations in progress, since jobs live in memory), so add a free uptime monitor (e.g. UptimeRobot or cron-job.org) that requests `https://api.treellis.art/api/health` every 10 minutes; 750 free instance hours a month cover one always-awake service. For guaranteed uptime, change `plan: free` to `plan: starter` ($7/month). `ALLOWED_ORIGINS` puts the server in public mode: CORS is limited to the site, and the local key and the draft/commit endpoints are disabled.

Self-hosted alternative: `server.js` runs under systemd (`deploy/treellis-api.service`) behind Caddy (`deploy/Caddyfile`) or nginx (`deploy/nginx.conf`), which terminates HTTPS. First-time setup (Ubuntu shown; on Amazon Linux use `dnf install nodejs22` and install Caddy from its COPR):

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs caddy git
sudo useradd --system --create-home --home-dir /opt/treellis treellis
sudo -u treellis git clone https://github.com/YIhaoDong/treellis-harness-yx.git /opt/treellis
cd /opt/treellis && sudo -u treellis npm ci --omit=dev
sudo cp deploy/treellis-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now treellis-api
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Update: `cd /opt/treellis && sudo -u treellis git pull && sudo -u treellis npm ci --omit=dev && sudo systemctl restart treellis-api`.

Users can enter their own OpenAI key, which the server forwards to OpenAI without storing it, or sign in for free generations (below).

### Free accounts

Visitors can type a prompt (or tap an example) and press Generate before signing in. Generate then opens a short sheet: the free trial first (email → a 6-digit code, or the link in the same email), with "Use your own OpenAI key" as the alternative, and the waiting generation starts as soon as either is done. The chip next to Generate shows the state (`Sign in · 3 free`, `name · 2 left`, `Free runs used`, `Own key`) and reopens the sheet. Free users see the efforts outside `FREE_EFFORTS` marked "own key". Signed-in visitors run `FREE_GENERATIONS` generations (default 3, in total) on the lab's OpenAI key, at the efforts in `FREE_EFFORTS` (default low, medium, high). A user's own key always takes precedence. A run that fails is given back; a run the user stops is not. `FREE_ATTEMPTS` (default 10) caps how many runs one account can start including given-back failures, and each account runs one generation at a time. Accounts and usage counts live in Supabase; the lab key stays on Render and never reaches the browser. Without the four variables below the feature stays off and Treellis works as before.

One-time setup:

1. **Supabase**: create a project. In SQL Editor, run `supabase/schema.sql`. Under Authentication → URL Configuration set Site URL `https://treellis.art` and add redirect URLs `https://treellis.art/**`, `https://www.treellis.art/**`, `http://localhost:5173/**`. Under Authentication → Email Templates, add the code `{{ .Token }}` to both **Confirm signup** (a visitor's first email) and **Magic Link** (later emails), keeping the `{{ .ConfirmationURL }}` link; on phones the code is the reliable path, since mail apps often open links in their own browser. Keep the template HTML well formed: a stray quote makes Supabase fail with "Error sending confirmation email". The code length is under Authentication → Providers → Email → Email OTP Length; if it is not 8, set `SIGN_IN_CODE_LENGTH` on Render to match. Supabase's built-in email sender allows only a few emails per hour, so before inviting people set up custom SMTP (Authentication → Emails → SMTP settings, e.g. Resend or SendGrid) and raise the email rate limit under Authentication → Rate Limits.
2. **OpenAI**: create a project for Treellis, set its monthly budget (Settings → Project → Limits), and create a key in it. Budget enforcement can lag behind usage, so keep the organization's prepaid credit modest with auto-recharge off as a hard backstop.
3. **Render**: in the `treellis-api` service's Environment, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (Supabase → Project Settings → API Keys) and `ACCOUNT_OPENAI_API_KEY`. The browser receives the Supabase URL and publishable key from `/api/generation/config`, so Vercel needs no new variables.

For a conference QR code, link to `https://www.treellis.art/try`: it opens the Prompt tab directly on phones (`vercel.json` serves the app at `/try`). The empty composer offers example prompts (`EXAMPLE_PROMPTS` in `src/components/PromptPanel.jsx`).

To review sign-ups and usage, see Authentication → Users and the `generation_usage` table in Supabase. To give someone more generations, lower their `used` count there.

## Verify

```sh
npm test
npm run build
```

See `README-Treellis.txt`, `GENERATION-FRAMEWORK.txt`, and `STAGED-GENERATION.txt` for application behavior and harness details.

## Local research records

The original application snapshot, full private study-data supplement, benchmark inputs/outputs, and per-run observations are retained locally. Private user behavior CSV files, participant/study data, API credentials, job capability files, dependency folders, and build output are excluded from this repository. These exclusions do not remove application source or UI functionality.
