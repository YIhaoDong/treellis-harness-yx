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

Each user supplies their own OpenAI API key through the application's Key control. A local `OPENAI_API_KEY` environment variable is also supported. This repository contains no API key or `.local` development configuration.

## Responsive editor

On phones and tablets up to 1100 CSS pixels wide, the 3D view stays above one full-width editor. The bottom navigation switches between Structure, Parameters and Prompt; Model uses the full workspace for the 3D view. Parameter ranges and extra structure actions collapse to leave more editing space. Larger screens keep the three-column workspace.

Libraries opens the nine selected creation models directly in the editor. Parameter, color and name edits retain the current selection and highlight through Undo and Redo.

An optional offline demo can be built with `npm run build:static`. Open the generated `static-demo/treellis-static.html`; generation and server saving are disabled in this demo. Generated demos and verification artifacts are excluded from Git.

## Deploy

The frontend and the generation server deploy separately (see `.env.example`):

- **Frontend → Vercel** (`treellis.art`): import this repo as a Vite project and set `VITE_API_BASE=https://api.treellis.art`.
- **Generation server → AWS** (`api.treellis.art`): `server.js` runs under systemd (`deploy/treellis-api.service`) behind Caddy (`deploy/Caddyfile`) or nginx (`deploy/nginx.conf`), which terminates HTTPS. `ALLOWED_ORIGINS` puts the server in public mode: CORS is limited to the site, and the local key and the draft/commit endpoints are disabled.

First-time server setup (Ubuntu shown; on Amazon Linux use `dnf install nodejs22` and install Caddy from its COPR):

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs caddy git
sudo useradd --system --create-home --home-dir /opt/treellis treellis
sudo -u treellis git clone https://github.com/YIhaoDong/treellis-harness-yx.git /opt/treellis
cd /opt/treellis && sudo -u treellis npm ci --omit=dev
sudo cp deploy/treellis-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now treellis-api
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Update: `cd /opt/treellis && sudo -u treellis git pull && sudo -u treellis npm ci --omit=dev && sudo systemctl restart treellis-api`.

No API key is configured on either service; each user enters their own key, which the server forwards to OpenAI without storing it.

## Verify

```sh
npm test
npm run build
```

See `README-Treellis.txt`, `GENERATION-FRAMEWORK.txt`, and `STAGED-GENERATION.txt` for application behavior and harness details.

## Local research records

The original application snapshot, full private study-data supplement, benchmark inputs/outputs, and per-run observations are retained locally. Private user behavior CSV files, participant/study data, API credentials, job capability files, dependency folders, and build output are excluded from this repository. These exclusions do not remove application source or UI functionality.
