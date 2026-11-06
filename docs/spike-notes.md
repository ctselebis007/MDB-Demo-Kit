# Spike notes (T02)

Status: **documentation checks done; live Atlas/provider runs pending** (no `MONGODB_URI_TEST` / keys were available when the kit was built).

## Run the spike

```bash
# Atlas 9.0 M10+ cluster
MONGODB_URI_TEST='mongodb+srv://...' uv run --directory template/api python ../../scripts/spike/spike_atlas.py

# Providers
TEST_VOYAGE_KEY=... TEST_OPENAI_KEY=... uv run --directory template/api python ../../scripts/spike/spike_embeddings.py
```

Both print `PASS`/`FAIL` per check and exit non-zero on failure. Paste the output below.

## Confirmed from documentation (2026-11-06)

| Assumption | Result | Source |
|---|---|---|
| `voyage-4` default dims | 1024 (also 256/512/2048 via `output_dimension`) | docs.voyageai.com/docs/embeddings |
| Voyage embed limits | ≤ 1,000 texts and ≤ 320K tokens per request for `voyage-4` → kit batches 128 | same |
| `input_type` | `query` / `document` / null | same |
| `rerank-3` | Exists; current recommended reranker. Response `data[] {index, relevance_score}` | docs.voyageai.com/docs/reranker |
| Voyage REST paths | `POST /v1/embeddings`, `POST /v1/rerank`, `Authorization: Bearer` | same |
| Atlas model API keys | Created in Atlas → AI Model APIs; base URL `https://ai.mongodb.com` | mongodb.com/docs/voyageai/quickstart |
| `openapi-typescript` from FastAPI schema | Works; `json_schema_serialization_defaults_required` makes response fields required | verified locally (`npm run gen:types`) |
| `AsyncMongoClient` + `tlsCAFile=certifi.where()` | Construction verified locally; Atlas ping pending | `tests/test_db.py` |

## Pending live checks (`spike_atlas.py`)

- [ ] `AsyncMongoClient` + certifi ping on Atlas 9.0
- [ ] `create_search_indexes` + polling `list_search_indexes` until `queryable`
- [ ] `$vectorSearch` pre-filters on `token`/`number` fields
- [ ] `$rankFusion` combining `$search` + `$vectorSearch` with `scoreDetails`
- [ ] `$graphLookup` with `restrictSearchWithMatch` + `depthField`
- [ ] Voyage on `https://ai.mongodb.com` and `https://api.voyageai.com` (paths, `rerank-3`, batch of 1,000)
- [ ] OpenAI `text-embedding-3-small` = 1536 dims

## Findings

_None yet._ Flag any wrong assumption here and update [the design](../demo-kit-standard-design.md).
