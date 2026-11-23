# Project Guidelines

This is a MongoDB Atlas demo / POC generated from the MongoDB Demo Kit. It may start as a blank starter (Setup page only) or with kit modules already installed. New features are added as **modules**.

## Brainstorming Workflow

This project uses a structured brainstorming-to-design workflow. Use the `/brainstorm` command or the `brainstorming` skill when starting a new demo, a new module, or exploring ideas. See "Design with AI agents" in `README.md`.

## Design Documents

- All design docs go in `docs/plans/` with the naming pattern `YYYY-MM-DD-<topic>-design.md`
- Implementation plans go next to them as `YYYY-MM-DD-<topic>-implementation.md`
- Designs should be validated incrementally with the user before finalizing
- Keep designs concise — prefer clarity over completeness

## Conventions

- Ask one question at a time during brainstorming sessions
- Always propose 2-3 approaches with trade-offs before committing to a direction
- Apply YAGNI — remove unnecessary features from designs
- Synthetic data only: never put real customer data, names or secrets in seed data, docs or commits

## Stack

- **API:** FastAPI + PyMongo async, managed with uv (`api/`)
- **Web:** React + TypeScript + Vite + Tailwind + D3 (`web/`), calls the API via `/api/*`
- **Data:** MongoDB Atlas 9.0 — collections, Atlas Search, Vector Search, `$rankFusion`, `$graphLookup`
- **Embeddings:** Voyage AI or OpenAI, selected on the Setup page
- `npm run dev` runs both; `npm test`, `npm run lint`, `npm run typecheck` must pass

## Module contract

A module is auto-discovered from two folders. Design and plan new features in these terms:

```
api/app/modules/<name_with_underscores>/
  router.py      router = APIRouter(prefix="/api/<name-with-dashes>")   required
  seed.py        collections(), generate(rng), embed_fields              optional
  indexes.py     regular(), search(), vector(dims)                       optional
  pipelines.py   pure functions that build aggregation pipelines
  tests/
web/src/modules/<name-with-dashes>/
  index.tsx      export const route = { path, element }; export const navItem = { label, order }
```

- `seed.py` generates deterministic data from the given `random.Random`; fields in `embed_fields` are embedded into `embedding`.
- Endpoints use `Depends(require_ready)` (`app.core.meta`), run pipelines with `run_pipeline()` and return `QueryResponse` (`app.core.query`) so the UI's Query Drawer shows the exact pipeline, timings and `explain()`.
- Web code calls `api.post()` from `web/src/core/api.ts` and types responses with `Schemas['...']`; run `npm run gen:types` after changing API models.
- Collection names must be unique across modules.
- After adding a module: restart `npm run dev`, then on Setup **Test Connections** (the Database Status panel lists what is expected vs. present), **Seed Database** and **Create Indexes**.
