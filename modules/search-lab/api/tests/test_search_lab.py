from __future__ import annotations

import random
import time
import zlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import get_db
from app.core.embeddings import OpenAIProvider, VoyageProvider
from app.core.meta import DemoMeta, now, require_ready
from app.main import create_app
from app.modules.search_lab import indexes, pipelines, seed
from app.modules.search_lab import router as router_mod
from app.modules.search_lab.pipelines import Filters


def bow(text: str, dims: int) -> list[float]:
    """Deterministic bag-of-words vector so Atlas tests don't need an embedding key."""
    v = [0.0] * dims
    for w in text.lower().split():
        v[zlib.crc32(w.strip(".,").encode()) % dims] += 1.0
    norm = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / norm for x in v]


class FakeVoyage(VoyageProvider):
    def __init__(self, dims: int = 1024):
        super().__init__("pa-fake-key-0000", "voyage-4", dims, "https://voyage.test")

    async def embed(self, texts: list[str], input_type: str) -> list[list[float]]:  # type: ignore[override]
        return [bow(t, self.dims) for t in texts]

    async def rerank(self, query, documents, top_k=None, model="rerank-3"):  # type: ignore[override]
        order = list(reversed(range(len(documents))))[: top_k or len(documents)]
        return [{"index": i, "relevance_score": 1 - n / 10} for n, i in enumerate(order)]


class FakeOpenAI(OpenAIProvider):
    def __init__(self):
        super().__init__("sk-fake-key-0000", "text-embedding-3-small", 1536, "https://openai.test")

    async def embed(self, texts: list[str], input_type: str) -> list[list[float]]:  # type: ignore[override]
        return [[0.1] * self.dims for _ in texts]


# ---------- seed ----------


def test_seed_is_deterministic():
    a = seed.generate(random.Random(seed.SEED))["products"]
    b = seed.generate(random.Random(seed.SEED))["products"]
    assert a == b
    assert len(a) == seed.N_PRODUCTS


def test_seed_distributions_within_bounds():
    products = seed.generate(random.Random(seed.SEED))["products"]
    counts: dict[str, int] = {}
    for p in products:
        lo, hi = seed.CATEGORIES[p["category"]]["price"]
        assert lo <= p["price"] <= hi
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    assert set(counts) == set(seed.CATEGORIES)
    expected = len(products) / len(seed.CATEGORIES)
    assert all(0.75 * expected < c < 1.25 * expected for c in counts.values())
    assert len({p["_id"] for p in products}) == len(products)


# ---------- indexes ----------


@pytest.mark.parametrize("dims", [1024, 1536])
def test_vector_index_uses_dims(dims: int):
    (idx,) = indexes.vector(dims)
    vector_field = next(f for f in idx["definition"]["fields"] if f["type"] == "vector")
    assert vector_field["numDimensions"] == dims
    assert {f["path"] for f in idx["definition"]["fields"] if f["type"] == "filter"} == {
        "category",
        "price",
    }


# ---------- pipelines ----------

FILTERS = Filters(categories=["footwear"], price_min=50, price_max=150)


def test_text_pipeline_shape():
    p = pipelines.text("trail shoe", FILTERS)
    search = p[0]["$search"]
    assert search["index"] == indexes.SEARCH_INDEX
    assert search["compound"]["must"][0]["text"]["fuzzy"] == {"maxEdits": 1}
    assert search["compound"]["filter"] == [
        {"in": {"path": "category", "value": ["footwear"]}},
        {"range": {"path": "price", "gte": 50, "lte": 150}},
    ]
    assert p[-1]["$project"]["highlights"] == {"$meta": "searchHighlights"}


def test_vector_pipeline_prefilter():
    p = pipelines.vector([0.1, 0.2], FILTERS, k=5)
    vs = p[0]["$vectorSearch"]
    assert vs["limit"] == 5 and vs["numCandidates"] == 75
    assert vs["filter"] == {
        "$and": [
            {"category": {"$in": ["footwear"]}},
            {"price": {"$gte": 50}},
            {"price": {"$lte": 150}},
        ]
    }


def test_no_filters_omits_filter_keys():
    assert "filter" not in pipelines.text("x", Filters())[0]["$search"]["compound"]
    assert "filter" not in pipelines.vector([0.1], Filters())[0]["$vectorSearch"]


def test_hybrid_pipeline_has_both_inputs_with_filters():
    p = pipelines.hybrid("trail shoe", [0.1], FILTERS, text_weight=0.7)
    rf = p[0]["$rankFusion"]
    inputs = rf["input"]["pipelines"]
    assert "filter" in inputs["text"][0]["$search"]["compound"]
    assert "filter" in inputs["vector"][0]["$vectorSearch"]
    assert rf["combination"]["weights"] == {"text": 0.7, "vector": 0.3}
    assert rf["scoreDetails"] is True


# ---------- router (mocked DB + provider) ----------

DOCS = [
    {
        "_id": f"p{i}",
        "title": f"Shoe {i}",
        "description": "d",
        "category": "footwear",
        "brand": "B",
        "price": 10.0 * i,
        "score": 1 - i / 10,
    }
    for i in range(12)
]


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]):
        self.docs = docs

    async def to_list(self) -> list[dict[str, Any]]:
        return self.docs


class FakeColl:
    def __init__(self, docs: list[dict[str, Any]] | None = None, meta: dict | None = None):
        self.docs = docs or []
        self.meta = meta
        self.pipelines: list[list[dict[str, Any]]] = []

    async def aggregate(self, pipeline: list[dict[str, Any]]) -> FakeCursor:
        self.pipelines.append(pipeline)
        limit = next((s["$limit"] for s in pipeline if "$limit" in s), 10)
        return FakeCursor(self.docs[:limit])

    async def find_one(self, *_: Any, **__: Any) -> dict | None:
        return self.meta


class FakeDb(dict):
    pass


def _client(
    monkeypatch: pytest.MonkeyPatch, provider: Any, ready: bool = True, db: FakeDb | None = None
) -> TestClient:
    app = create_app()
    db = db if db is not None else FakeDb(products=FakeColl(DOCS))
    app.dependency_overrides[get_db] = lambda: db
    if ready:
        app.dependency_overrides[require_ready] = lambda: DemoMeta(
            provider="voyage", model="voyage-4", dims=1024, seeded_at=now(), indexed_at=now()
        )
    monkeypatch.setattr(router_mod, "make_provider", lambda _s: provider)
    return TestClient(app)


def test_query_openai_has_no_rerank(monkeypatch: pytest.MonkeyPatch):
    c = _client(monkeypatch, FakeOpenAI())
    body = c.post("/api/search-lab/query", json={"q": "shoe"}).json()
    assert body["rerank"] is None
    assert "Voyage" in body["rerank_reason"]
    assert len(body["text"]["results"]) == 10
    assert len(body["hybrid"]["results"]) == 10
    assert body["vector"]["timings"]["embed_ms"] is not None
    assert body["text"]["pipeline"][0]["$search"]["index"] == indexes.SEARCH_INDEX


def test_query_voyage_reranks_hybrid_candidates(monkeypatch: pytest.MonkeyPatch):
    c = _client(monkeypatch, FakeVoyage())
    body = c.post("/api/search-lab/query", json={"q": "shoe"}).json()
    rerank = body["rerank"]["results"]
    assert [r["id"] for r in rerank[:2]] == ["p11", "p10"]
    assert [r["rank"] for r in rerank] == list(range(1, 11))
    assert body["rerank"]["timings"]["rerank_ms"] is not None


def test_only_and_explain_flags(monkeypatch: pytest.MonkeyPatch):
    coll = FakeColl(DOCS)
    c = _client(monkeypatch, FakeVoyage(), db=FakeDb(products=coll))
    body = c.post("/api/search-lab/query", json={"q": "shoe", "only": "text"}).json()
    assert body["vector"] is None and body["hybrid"] is None and body["text"] is not None
    assert len(coll.pipelines) == 1


def test_not_ready_returns_409(monkeypatch: pytest.MonkeyPatch, store):
    db = FakeDb(products=FakeColl(DOCS), _demo_meta=FakeColl(meta=None))
    c = _client(monkeypatch, FakeVoyage(), ready=False, db=db)
    r = c.post("/api/search-lab/query", json={"q": "shoe"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "NOT_SEEDED"


def test_empty_query_rejected(monkeypatch: pytest.MonkeyPatch):
    c = _client(monkeypatch, FakeVoyage())
    assert c.post("/api/search-lab/query", json={"q": ""}).status_code == 422


# ---------- Atlas integration ----------


@pytest.mark.atlas
def test_atlas_all_columns(atlas_uri: str, monkeypatch: pytest.MonkeyPatch):
    import asyncio

    from app.core.db import make_client
    from app.core.jobs import Job
    from app.core.registry import discover
    from app.core.seeding import build_indexes, seed_all
    from app.core.settings import SettingsUpdate, get_store

    db_name = f"demokit_test_{int(time.time() * 1000)}"
    get_store().save(
        SettingsUpdate(
            mongo_uri=atlas_uri, db_name=db_name, provider="voyage", api_key="pa-fake-key-0000"
        )
    )
    provider = FakeVoyage()
    monkeypatch.setattr(seed, "N_PRODUCTS", 300)
    modules = [m for m in discover() if m.name == "search_lab"]

    async def prepare() -> None:
        client = make_client(atlas_uri)
        db = client[db_name]
        settings = get_store().load()
        await seed_all(db, provider, settings, modules, Job(type="seed"))
        await build_indexes(db, modules, 1024, Job(type="indexes"))
        await client.close()

    try:
        asyncio.run(prepare())
        with TestClient(create_app()) as c:
            monkeypatch.setattr(router_mod, "make_provider", lambda _s: provider)
            body = c.post(
                "/api/search-lab/query",
                json={
                    "q": "waterproof hiking boot",
                    "filters": {"categories": ["footwear"], "price_max": 200},
                },
            ).json()
            for col in ("text", "vector", "hybrid", "rerank"):
                assert body[col] and body[col]["results"], (col, body.get("errors"))
                for hit in body[col]["results"]:
                    assert hit["category"] == "footwear" and hit["price"] <= 200
    finally:
        import certifi
        from pymongo import MongoClient

        MongoClient(atlas_uri, tlsCAFile=certifi.where()).drop_database(db_name)
