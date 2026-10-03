# helptai

Record one continuous scroll through a book or bound document. helptai picks the clearest frames in your browser, sends only those to Gemini to rebuild the pages and extract the text, flags pages that need another look, and exports to PDF, Word and PowerPoint.

## Setup

Requires Node 22.9 or newer.

```bash
npm install
cp .env.example .env      # then add your GEMINI_API_KEY
npm run dev               # web on :5173, API on :8080 (web proxies /api)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API server and the web app together |
| `npm run typecheck` | Type-checks every package |
| `npm run build` | Typecheck, then build web and API |

## Environment

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Required. Google AI Studio key. |
| `GEMINI_MODELS` | Optional. Comma-separated models tried in order; a busy or out-of-quota model falls through to the next (default `gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash`). |
| `PORT` | Optional. API port (default 8080). |
| `API_PORT` | Optional. Port the web dev server proxies `/api` to (default 8080). |

## Layout

- `artifacts/helptai` — React + Vite web app
- `artifacts/api-server` — Express API that calls Gemini
- `lib/api-spec` — OpenAPI spec and code generation
- `lib/api-zod`, `lib/api-client-react` — generated schemas and client
- `lib/integrations-gemini-ai` — Gemini client and batching helpers
