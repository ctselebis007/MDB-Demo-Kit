# MongoDB Demo Kit — Implementation Plan

**Date:** 2026-11-06
**Design:** [demo-kit-standard-design.md](./demo-kit-standard-design.md)

Each task is independently testable. "Done when" is the acceptance check. Dependencies are listed as task IDs.

**Test environment variables**

- `MONGODB_URI_TEST` — an Atlas 9.0 M10+ dev cluster. Integration tests (`pytest -m atlas`) create and drop `demokit_test_<ts>`. If unset, they are skipped.
- `TEST_VOYAGE_KEY`, `TEST_OPENAI_KEY` — used by embedding/rerank integration tests. If unset, those tests are skipped and HTTP is mocked (`respx`).

## Phase 0 — Kit skeleton and risk spike

| ID | Task | Depends | Done when |
|---|---|---|---|
| T01 | Kit repo `mongodb-demo-kit/` with `template/`, `modules/`, `scripts/`. `template/api`: uv project, Python 3.12, FastAPI, `uvicorn[standard]`, `pymongo`, `certifi`, `httpx`; dev: `pytest`, `pytest-asyncio`, `respx`, `ruff`, `pyright`. `template/web`: Vite React-TS, Tailwind, React Router, TanStack Query, D3, Vitest, ESLint. `template/package.json` (npm workspace `web`): `dev` = `concurrently "uv run --directory api uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload" "npm -w web run dev"`; Vite proxies `/api` → `:8000`. Scripts `build`, `test`, `lint`, `gen:types`. `.gitignore`: `api/config/settings.json`, `.venv/`, `node_modules/`, `dist/`, `.env` | — | In `template/`: `npm i && npm run dev` serves the Vite page and `GET /api/health` → `{ "ok": true }`. `npm test` runs pytest + Vitest (0 tests). `npm run build` succeeds |
| T02 | **Spike** (`scripts/spike/*.py`, kept for reference). On an M10 9.0 cluster confirm: `AsyncMongoClient` with `tlsCAFile=certifi.where()`; `create_search_indexes` + polling `list_search_indexes` until `queryable`; `$rankFusion` combining `$search` + `$vectorSearch` with `scoreDetails`; `$vectorSearch` pre-filters on `token`/`number` fields; `$graphLookup` with `restrictSearchWithMatch` + `depthField`. Confirm Voyage on `https://ai.mongodb.com` (paths, payloads, `input_type`, max batch, `voyage-4` dims, `rerank-3`) and on `https://api.voyageai.com`; OpenAI `text-embedding-3-small` dims and batch limits. Confirm `openapi-typescript` output from FastAPI's `/openapi.json` | T01 | Findings in `docs/spike-notes.md`. Any wrong design assumption is flagged and the design doc updated before Phase 1. Already confirmed from Voyage docs: `voyage-4` = 1024 dims default, max 1,000 texts / 320K tokens per request, `rerank-3` exists, paths `/v1/embeddings` and `/v1/rerank` |

## Phase 1 — Template API core

| ID | Task | Depends | Done when |
|---|---|---|---|
| T03 | `app/core/settings.py`: Pydantic model `{ mongo_uri, db_name, provider: voyage\|openai, model, api_key, voyage_base_url }`. Load/save `api/config/settings.json` (atomic temp-file + rename, mode `0600`). First run prefills from `.env`. `masked()` returns URI with `••••` password and key last 4 + `has_key`. `save(partial)`: blank secret keeps the stored one. Model registry `{ model: dims }` | T01 | Unit tests: round-trip; masking for `+srv`, URL-encoded passwords, no-password URIs; blank keeps secret; invalid `db_name` rejected; file mode `0600` |
| T04 | `app/core/db.py`: one cached `AsyncMongoClient` (`appName="mongodb-demo-kit"`, `serverSelectionTimeoutMS=5000`, `tlsCAFile=certifi.where()` for TLS/SRV), rebuilt when settings change. `get_db()` dependency. Close on shutdown | T03 | Unit: saving settings invalidates the cached client. `-m atlas`: `ping` succeeds |
| T05 | `app/core/embeddings.py`: `EmbeddingProvider` protocol `embed(texts, input_type) -> list[list[float]]`, `dims`, `supports_rerank`. `VoyageProvider` (`embed`, `rerank(query, docs, top_k)` with `rerank-3`) and `OpenAIProvider` over `httpx`: 15 s timeout, batching to API max, 3 retries with backoff on 429/5xx. Typed errors `EmbeddingAuthError`, `EmbeddingRateLimitError`, `EmbeddingUnavailableError` | T02, T03 | Unit (`respx`): 429 then success retries; 401 → `EmbeddingAuthError`, no retry; batching splits correctly; timeout fires. Integration (keys set): dims match registry; rerank orders a relevant doc first |
| T06 | `app/core/errors.py`: `AppError(code, message, hint, status)` and handlers producing `{ error: { code, message, hint } }`. Maps `ServerSelectionTimeoutError` → `ATLAS_UNREACHABLE`, auth `OperationFailure` → `AUTH_FAILED`, embedding errors → `EMBEDDING_AUTH` / `EMBEDDING_UNAVAILABLE`. Logging filter masks URIs (`user:pass@`) and bearer/API keys | T03, T05 | Unit: each mapped exception yields the right code + hint; a logged settings object and a driver error with credentials contain no secret text |
| T07 | `app/core/meta.py`: read/write `_demo_meta { provider, model, dims, seeded_at, indexed_at, modules }`. Dependency `require_ready()` raises `NOT_SEEDED`, `RESEED_REQUIRED` (settings provider/model ≠ meta) or `INDEX_NOT_READY` (all `409`) | T03, T04, T06 | Unit with mocked DB: each state → correct code. Ready state passes |
| T08 | `app/core/jobs.py`: in-memory registry `{ id, type, status, progress, steps[], error }` run as `asyncio` tasks. `GET /api/setup/jobs/{id}`. One job per type at a time (`409` otherwise) | T01 | Unit: fake job progresses 0→100 and ends `done`; failing job ends `error` with code; second concurrent job of same type → `409` |
| T09 | Module contract + discovery. Each module: `router.py` (`router`, prefix `/api/<name>`), `seed.py` (`collections()`, `generate(rng) -> dict[str, list[doc]]`, `embed_fields: dict[str, list[str]]`), `indexes.py` (`regular()`, `search()`, `vector(dims)`). `app/main.py` discovers `app/modules/*/` via `importlib` and mounts routers; `app/core/registry.py` exposes seeds/indexes | T01 | Unit with a fake module folder: router mounted, seed/index hooks listed; missing `router.py` logs a warning and skips. Importing `app.main` and `GET /openapi.json` work with no settings file and no Atlas |
| T10 | `app/core/query.py`: generic `QueryResponse[T] { results, pipeline, timings: { server_ms, embed_ms? }, explain? }` and a `run_pipeline(coll, pipeline, explain=False)` helper that times execution and optionally returns `explain("executionStats")` | T04 | Unit: helper returns the exact pipeline passed in and a non-negative timing. `-m atlas`: `explain=True` returns stats |
| T11 | Setup routes: `GET /api/setup` (masked), `PUT /api/setup`, `GET /api/setup/status` (`seeded`, `indexed`, `reseed_required`). `POST /api/setup/test` returns rows `{ id, label, status: ok\|warn\|fail, message, hint, ms }`: URI parse, ping + version + tier, Search available, `$rankFusion` supported, write permission (temp collection), test embedding (dims, latency). Uses form values with stored-secret fallback and a **temporary** client. `POST /api/setup/seed` (job): drop/recreate module collections, generate, embed in batches, insert, write `_demo_meta`. `POST /api/setup/indexes` (job): create regular, Search and Vector indexes with `numDimensions` from meta, poll until queryable, per-index status | T03–T09 | Route tests (temp config dir): no response contains a secret; bad scheme fails row 1; unreachable host fails within ~6 s with access-list hint. `-m atlas`: seed then indexes on a fake module completes; `_demo_meta` written; switching provider → `status.reseed_required = true` |

## Phase 2 — Template web core

| ID | Task | Depends | Done when |
|---|---|---|---|
| T12 | `npm run gen:types`: start API without Atlas, fetch `/openapi.json`, write `web/src/core/api-types.ts` (committed). `web/src/core/api.ts`: typed fetch wrapper that parses the error envelope into `ApiError { code, message, hint }` | T11 | Generated file compiles under `tsc`; Vitest: error envelope parsed; non-JSON 500 handled |
| T13 | App shell: layout, nav built from `import.meta.glob('./modules/*/index.tsx', { eager: true })` (`{ route, navItem }`). Module nav disabled until `status.seeded && status.indexed`. "Re-seed required" banner. Toasts for `ApiError.hint` | T12 | Vitest: a fake module appears in nav; disabled when not ready; banner shows on `reseed_required` |
| T14 | Setup page: URI and API key as `type=password` with show/hide and `autocomplete="off"`; DB name; provider select; model select (dims shown, read-only); Advanced → Voyage base URL. Buttons: **Save**, **Test Connections** (status rows with hints), **Seed Database** (confirm dialog, per-collection progress via job polling), **Create Indexes** (per-index status until ready) | T11, T13 | Vitest: blank secret field sends no value; provider change updates model options and dims. Manual: full flow against Atlas succeeds |
| T15 | `QueryDrawer` component: pretty pipeline JSON with copy button, `server_ms`/`embed_ms`, "Explain" toggle that re-runs with `explain=true` and shows stats | T12 | Vitest: copy writes the exact JSON; explain toggle triggers a request with `explain=true` |

## Phase 3 — Scaffolding scripts

| ID | Task | Depends | Done when |
|---|---|---|---|
| T16 | `module.json` schema (`name`, `requires`, `python`, `npm`, `collections`, `minServerVersion`, `codeMap: [{ feature, file, docsUrl }]`) and a validator in `scripts/lib/module.mjs` | T09 | Validator rejects missing `name`, unknown `requires`, and duplicate collection names across selected modules |
| T17 | `scripts/new-demo.mjs` (`npm run new -- <name> --modules a,b [--out ../]`): copy `template/`, copy each module's `api/` → `api/app/modules/<name>/` and `web/` → `web/src/modules/<name>/`, run `uv add` and `npm i -w web` with declared deps, render README "Where's the MongoDB code?" from `codeMap`, `git init`. Refuses if target exists | T16 | Generated demo with both modules: `npm i && npm run dev` works; `npm test` and `npm run build` pass; README table lists each module's files |
| T18 | `scripts/add-module.mjs <module> [--kit <path>]` run inside a demo: same copy + deps + README table update. Idempotent check: refuses if module folder exists | T17 | Adding `graph-view` to a `search-lab`-only demo yields the same tree as generating both at once (diff ignoring lockfiles) |

## Phase 4 — `search-lab` module

| ID | Task | Depends | Done when |
|---|---|---|---|
| T19 | `seed.py`: ~2,000 synthetic products `{ title, description, category, price, brand, tags }` from seeded RNG with curated vocab (no Faker). `embed_fields = { products: ["title", "description"] }` → field `embedding` | T09 | Unit: same seed → identical docs; category/price distributions within bounds |
| T20 | `indexes.py`: Search index (`title`/`description` `lucene.english` with highlights, `category`/`brand` `token`, `price` `number`); Vector index on `embedding` with `numDimensions=dims`, `similarity: cosine`, filters `category`, `price` | T19 | Unit: vector definition uses passed dims (1024 and 1536 cases) |
| T21 | `pipelines.py` (pure): `text(q, filters)` (`$search` compound, fuzzy, highlight), `vector(qvec, filters, k)`, `hybrid(q, qvec, filters, weights)` (`$rankFusion` with both, `scoreDetails`) | T20 | Unit: pipeline shapes snapshot-tested; filters appear in both `$search` and `$vectorSearch` pre-filter |
| T22 | `router.py`: `POST /api/search-lab/query { q, filters, weights, explain? }` → `{ text, vector, hybrid, rerank? }` each a `QueryResponse`. Query embedded once with `input_type=query`. Rerank uses `rerank-3` over hybrid top 20 when provider is Voyage; otherwise `rerank: null` with reason. Guarded by `require_ready()` | T05, T07, T10, T21 | Route tests with mocked DB/provider: OpenAI → `rerank` null with reason; not ready → `409`. `-m atlas`: all columns return results for a seeded query; filters respected |
| T23 | `web/`: query box, category/price chips, weight slider, four columns (rank, score, latency, highlights). Hovering a result highlights it in the other columns. Each column opens `QueryDrawer`. Rerank column disabled with tooltip on OpenAI. `module.json` with `codeMap` | T15, T22 | Vitest: cross-highlight maps `_id` across columns; disabled rerank column renders tooltip. Manual: visual check |

## Phase 5 — `graph-view` module

| ID | Task | Depends | Done when |
|---|---|---|---|
| T24 | `seed.py`: ~500-node supply chain in `nodes { _id, type: supplier\|part\|product\|customer, name, description, out_supplies[], out_component_of[], out_sold_to[], out_all[] }` from seeded RNG. Embed `name` + `description` | T09 | Unit: determinism; no dangling references; every product reachable from at least one supplier |
| T25 | `indexes.py`: Vector index on `embedding` with filter `type`. Regular index on `type` | T24 | Unit: dims passed through |
| T26 | `pipelines.py` + `router.py`: `POST /api/graph-view/explore { query? \| start_ids?, max_depth, edge_type, restrict_types?, explain? }`. `query` → `$vectorSearch` top 3 start nodes; then `$graphLookup` on `nodes` with `connectFromField: out_<edge_type>` (or `out_all`), `depthField: depth`, `restrictSearchWithMatch` on `type`. Returns `{ nodes, links }` in `QueryResponse` | T07, T10, T25 | Unit: pipeline shape per edge type. `-m atlas`: `max_depth=0` returns only direct neighbours; `restrict_types` excludes other types |
| T27 | `web/`: D3 force-directed graph colored by `depth`, node shape/label by `type`, zoom/drag, click-to-expand (calls explore with `start_ids=[id], max_depth=0` and merges). Controls for query, depth, edge type, type filter. `QueryDrawer`. `module.json` with `codeMap` | T15, T26 | Vitest: API → D3 transform; merge de-duplicates nodes/links. Manual: expand keeps layout stable |

## Phase 6 — Quality, CI, docs

| ID | Task | Depends | Done when |
|---|---|---|---|
| T28 | Template README (What it demonstrates, Mermaid architecture, Prerequisites: Node 22+ + uv + Atlas 9.0 M10+, 3-step quick start, "Where's the MongoDB code?" placeholder, screenshot slot), `LICENSE` (Apache-2.0), `.env.example`, `.pre-commit-config.yaml` with `gitleaks` | T17 | `pre-commit run --all-files` passes; a fake key in a test file is blocked |
| T29 | Kit CI (`.github/workflows/ci.yml`): generate a demo with all modules to a temp dir, then `ruff`, `pyright`, `eslint`, `tsc`, pytest (unit), Vitest, `npm run build`, and `gen:types` diff check (fails if `api-types.ts` is stale) | T17, T23, T27 | CI green on main; deliberately stale `api-types.ts` fails the job |
| T30 | End-to-end smoke (manual checklist in `docs/smoke.md`): fresh generate → `npm i` → `npm run dev` → Setup with Voyage → Test → Seed → Indexes → both modules work → switch to OpenAI → banner + `409` → Seed + Indexes → works, rerank disabled. Record GIF for README | T23, T27, T28 | Checklist passes on a clean machine; GIF committed |

## Milestones

1. **Template runs** — T01–T15: Setup-only template usable for a demo today.
2. **Kit works** — T16–T18: `npm run new` generates standalone demos.
3. **Catalog v1** — T19–T27: `search-lab` and `graph-view`.
4. **Shareable** — T28–T30: CI, README standards, smoke test.
