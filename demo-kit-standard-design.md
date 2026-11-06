# MongoDB Demo Kit — Standard Stack Design

**Date:** 2026-11-06
**Status:** Approved (no code yet)
**Inputs:** Past designs — Portfolio Tracker, Cascade (Express + React), SEC Insights, Cosmos migration (FastAPI + plain HTML)

## Goal

One standard way to build MongoDB Atlas demos (Atlas Search, Vector Search, Hybrid Search, Voyage AI, `$graphLookup`) that are shared with prospects on GitHub. The standard must:

1. Read well for **both** Python (data/AI) and JS/TS (app) prospect teams.
2. Support rich, "wow" UIs (D3 graphs, side-by-side search comparisons).
3. Start with **one command**: `npm run dev`.
4. Provide a **Setup page** in every demo and a catalog of **reusable feature modules**.

## Decisions

| Topic | Decision |
|---|---|
| Backend | Python 3.12, **FastAPI**, PyMongo (async), managed with **uv** |
| Frontend | React + TypeScript, **Vite**, **Tailwind**, **D3**, TanStack Query |
| API contract | FastAPI `app.openapi()` (no server or Atlas needed) → `openapi-typescript` → committed `web/src/core/api-types.ts` |
| Run | Root `npm run dev` = `concurrently` (`uv run uvicorn` on `127.0.0.1:8000` + `vite`, proxy `/api`) |
| Prereqs | Node 22+, uv (uv installs Python 3.12), Atlas cluster |
| Platforms | macOS and Linux. Windows best-effort (settings file mode `0600` not enforced) |
| Database | Atlas, MongoDB **9.0** (latest; `$rankFusion`), **M10+** recommended (search index limits on M0) |
| Reuse model | **Kit repo** = Setup-only `template/` + `modules/` catalog + scaffolding scripts (Approach 2) |
| Module wiring | Auto-discovery on both sides. Copying folders installs a module |
| Embeddings | Voyage (`voyage-4`, 1024 dims, default base URL `https://ai.mongodb.com`) or OpenAI (`text-embedding-3-small`, 1536 dims) |
| Reranker | Voyage `rerank-3` (Voyage only) |
| Secrets | Server-side `api/config/settings.json`, gitignored, `0600`, masked in all responses |
| Auth | None. Local, single-user demo bound to `127.0.0.1` |
| Data | Synthetic only, deterministic (seeded RNG) |

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Express + TS everywhere | Strong for UI/shared types, but Python is the lingua franca for AI/data prospects and Voyage/RAG tooling |
| FastAPI + plain HTML/JS | No build step, but limits the rich D3/multi-page UI |
| One template with all modules (prune unused) | Simplest, but every demo carries unused modules |
| Published packages (PyPI/npm) | Hides the MongoDB code in `site-packages`/`node_modules`, which defeats the purpose |

## Architecture

```mermaid
flowchart LR
  UI[React + TS · Vite · Tailwind · D3<br/>Setup · module pages] -->|/api/* via Vite proxy| API[FastAPI · uv]
  API -->|PyMongo async| ATLAS[(Atlas<br/>collections · Search · Vector)]
  API -->|embed / rerank| EMB[Voyage AI or OpenAI]
  API -->|/openapi.json| GEN[openapi-typescript] --> UI
```

### Kit repo (`mongodb-demo-kit`)

```
template/                  # Setup-only starter, runnable on its own
modules/
  search-lab/   { api/, web/, module.json }
  graph-view/   { api/, web/, module.json }
scripts/new-demo.mjs       # npm run new -- <name> --modules a,b
scripts/add-module.mjs     # add a module to an existing demo
.github/workflows/ci.yml   # generate demo with all modules → lint, typecheck, test, build
```

### Generated demo repo (standalone, no runtime link to the kit)

```
api/
  app/main.py              # discovers app/modules/*/router.py
  app/core/                # settings, db, embeddings, errors, meta
  app/modules/<name>/      # router.py, seed.py, indexes.py, pipelines.py
  tests/
  pyproject.toml, uv.lock
web/
  src/core/                # layout, api client, api-types.ts, QueryDrawer
  src/modules/<name>/      # index.tsx exports { route, navItem }
package.json               # dev, build, test, gen:types
.env.example, LICENSE (Apache-2.0), README.md
```

### `module.json`

```json
{
  "name": "search-lab",
  "requires": ["setup"],
  "python": ["voyageai"],
  "npm": ["d3"],
  "collections": ["products"],
  "minServerVersion": "9.0",
  "codeMap": [{ "feature": "Hybrid search", "file": "api/app/modules/search_lab/pipelines.py", "docsUrl": "..." }]
}
```

`codeMap` feeds the README "Where's the MongoDB code?" table.

`new-demo` / `add-module` copy `api/` and `web/` folders, run `uv add` and `npm i -w web`, and check `requires`. Web discovery uses `import.meta.glob('./modules/*/index.tsx')`. Python module folders use underscores (`api/app/modules/search_lab/`) because they are packages; URLs (`/api/search-lab`) and web folders keep dashes.

## Setup module (always present)

### Fields

| Field | Notes |
|---|---|
| MongoDB URI | `type=password`, show/hide toggle, `autocomplete=off` |
| Database name | |
| Embedding provider | Voyage or OpenAI |
| Model | Defaulted per provider. Dims derived, never typed |
| API key | `type=password`, show/hide toggle |
| Voyage base URL | Advanced. Default `https://ai.mongodb.com`, override `https://api.voyageai.com` |

### Endpoints

| Endpoint | Behavior |
|---|---|
| `GET /api/setup` | Masked URI (`mongodb+srv://user:••••@host`), `hasKey`, key last 4 |
| `PUT /api/setup` | Blank secret = keep existing. `.env` prefills on first run |
| `POST /api/setup/test` | Rows: Atlas ping + version (tier is not exposed to drivers; M10+ shown as a recommendation) · Search available (`listSearchIndexes`) · `$rankFusion` supported · DB write permission · test embedding (dims, latency) |
| `POST /api/setup/seed` | Background job (in-memory; a dev-server code reload aborts it, re-run Seed). Each module's `seed.py` yields deterministic docs + fields to embed. Batched embeddings. Drops/recreates module collections after a confirm dialog. Writes `_demo_meta {provider, model, dims, seededAt, modules}` |
| `GET /api/setup/jobs/{id}` | Per-collection progress |
| `POST /api/setup/indexes` | Each module's `indexes.py`: regular + Search + Vector definitions. `numDimensions` from `_demo_meta`. Polls until queryable; per-index status |

### Guards

- Settings provider/model ≠ `_demo_meta` → "Re-seed required" banner; module endpoints return `409 RESEED_REQUIRED`.
- Module nav disabled until seeded and indexed.

## Shared convention

Every module query endpoint returns `{ results, pipeline, timings }`. The core **Query Drawer** shows the exact pipeline JSON (copy button), server latency, and optional `explain()`. Pipelines are built by pure functions in `pipelines.py`.

## Module catalog (v1)

### `search-lab`

- **Seed:** ~2,000 synthetic products (title, description, category, price, brand, tags). Embeds title + description.
- **UI:** one query box, filter chips (category, price). Side-by-side columns:
  1. Full-text — `$search` with fuzzy + highlights
  2. Vector — `$vectorSearch` with pre-filters
  3. Hybrid — `$rankFusion` with weight slider
  4. Hybrid + Rerank — Voyage `rerank-3` (disabled with tooltip on OpenAI)
- Each column shows rank, score, latency. Hovering a result highlights it in the other columns.

### `graph-view`

- **Seed:** ~500-node synthetic supply chain (supplier → part → product → customer). Nodes embedded.
- **UI:** natural-language query → `$vectorSearch` picks start nodes → `$graphLookup` (`maxDepth`, `restrictSearchWithMatch`, edge type). D3 force-directed graph colored by `depthField`; zoom, drag, click-to-expand. "GraphRAG-lite" on MongoDB only.

### Deferred

`rag-chat` (needs an LLM provider field in Setup), `change-stream-feed`, `charts-dashboard`.

### Customizing for a prospect

Edit the module's `seed.py` (theme), `indexes.py` and labels. Structure stays the same.

## Error handling

Envelope: `{ error: { code, message, hint } }`. UI shows `hint` inline on Setup rows or as a toast.

| Cause | Code | Hint |
|---|---|---|
| `ServerSelectionTimeoutError` | `ATLAS_UNREACHABLE` | Check IP access list / VPN |
| Auth failure | `AUTH_FAILED` | Check user/password in URI |
| Not seeded | `NOT_SEEDED` (409) | Run Seed on Setup |
| Provider changed | `RESEED_REQUIRED` (409) | Re-seed and re-index |
| Index building | `INDEX_NOT_READY` (409) | Wait for index status = ready |
| Embedding 401 | `EMBEDDING_AUTH` | Check API key / base URL |
| Embedding 429 | — | Retried with backoff during seeding |

- `MongoClient(..., tlsCAFile=certifi.where())` to avoid macOS CA issues.
- `$rankFusion` unsupported → Hybrid columns disabled with an explanation.
- Log filter masks URIs and keys.

## Testing

| Layer | Scope |
|---|---|
| pytest unit | Settings masking, blank-keeps-secret, module discovery, seed determinism, index dims from `_demo_meta`, pipeline builders |
| pytest `-m atlas` | Integration against `MONGODB_URI_TEST`; skipped if unset |
| Vitest | Graph→D3 transform, score normalization, column cross-highlight mapping |
| Kit CI | Generate a demo with all modules → `ruff`, `eslint`, `pyright`, `tsc`, unit tests, `npm run build` |

## Repo standards for prospects

- **README:** What it demonstrates (with MongoDB docs links) · Mermaid architecture · Prerequisites · 3-step quick start · **"Where's the MongoDB code?"** table (feature → file) · GIF/screenshot.
- Commit `uv.lock`, `package-lock.json`, `.env.example`, `LICENSE` (Apache-2.0).
- Synthetic data only. Pre-commit `gitleaks` blocks secrets.

## Out of scope (v1)

Auth/multi-user, Docker, cloud deployment, LLM chat, migrating existing demos to the kit.
