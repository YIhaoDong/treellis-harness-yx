# Treellis generation harness

Treellis is a local editable 3D workspace with a training-free generation harness: prompt assembly, structured AML output, scoped edits, geometric validation, and bounded repair.

This private repository preserves two separately versioned application snapshots:

- `baseline-v1`: the application frozen before the 20-case, five-effort framework evaluation.
- `optimized-v2`: the separately stored optimization version, published after evaluation and verification.

The baseline's functional source, prompt templates, application resources, and dependency lockfile match the frozen local snapshot. Publication-only changes protect credentials and private data and clarify setup. `SNAPSHOT-PROVENANCE.json` records those differences and the local source manifest hash.

## Run locally

Use a supported Node.js installation, then run:

```sh
npm ci
npm run server
```

In another terminal, run `npm run dev` and open the URL shown by Vite.

Each user supplies their own OpenAI API key through the application's Key control. A local `OPENAI_API_KEY` environment variable is also supported. This repository contains no API key or `.local` development configuration.

## Verify

```sh
npm test
npm run build
```

See `README-Treellis.txt`, `GENERATION-FRAMEWORK.txt`, and `STAGED-GENERATION.txt` for application behavior and harness details.

## Local research records

The original application snapshot, full private study-data supplement, benchmark inputs/outputs, and per-run observations are retained locally. Private user behavior CSV files, participant/study data, API credentials, job capability files, dependency folders, and build output are excluded from this repository. These exclusions do not remove application source or UI functionality.
