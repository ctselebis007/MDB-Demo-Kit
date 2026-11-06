from __future__ import annotations

import random
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.db import get_db
from app.core.meta import DemoMeta, now, require_ready
from app.main import create_app
from app.modules.graph_view import indexes, pipelines, seed
from app.modules.graph_view import router as router_mod


def generate() -> list[dict[str, Any]]:
    return seed.generate(random.Random(seed.SEED))["nodes"]


# ---------- seed ----------


def test_seed_is_deterministic_and_sized():
    a, b = generate(), generate()
    assert a == b
    assert len(a) == sum(seed.COUNTS.values()) == 500


def test_no_dangling_references():
    nodes = generate()
    ids = {n["_id"] for n in nodes}
    for n in nodes:
        for f in [*pipelines.LINK_FIELDS, "out_all"]:
            assert set(n[f]) <= ids, (n["_id"], f)


def test_every_product_reachable_from_a_supplier():
    nodes = {n["_id"]: n for n in generate()}
    reached: set[str] = set()
    frontier = [i for i, n in nodes.items() if n["type"] == "supplier"]
    while frontier:
        nxt = []
        for i in frontier:
            for t in nodes[i]["out_all"]:
                if t not in reached:
                    reached.add(t)
                    nxt.append(t)
        frontier = nxt
    products = {i for i, n in nodes.items() if n["type"] == "product"}
    assert products <= reached


# ---------- indexes ----------


@pytest.mark.parametrize("dims", [1024, 1536])
def test_vector_index_dims(dims: int):
    (idx,) = indexes.vector(dims)
    assert idx["definition"]["fields"][0]["numDimensions"] == dims
    assert idx["definition"]["fields"][1] == {"type": "filter", "path": "type"}


# ---------- pipelines ----------


@pytest.mark.parametrize(
    ("edge", "field"),
    [
        ("all", "out_all"),
        ("supplies", "out_supplies"),
        ("component_of", "out_component_of"),
        ("sold_to", "out_sold_to"),
    ],
)
def test_pipeline_per_edge_type(edge: pipelines.EdgeType, field: str):
    p = pipelines.explore(start_ids=["sup-000"], max_depth=2, edge_type=edge)
    gl = p[1]["$graphLookup"]
    assert gl["startWith"] == f"${field}" and gl["connectFromField"] == field
    assert gl["maxDepth"] == 2 and gl["depthField"] == "depth"
    assert "restrictSearchWithMatch" not in gl
    assert p[0] == {"$match": {"_id": {"$in": ["sup-000"]}}}


def test_pipeline_with_query_and_type_restriction():
    p = pipelines.explore(qvec=[0.1, 0.2], restrict_types=["part", "product"])
    assert p[0]["$vectorSearch"]["limit"] == 3
    assert p[1]["$graphLookup"]["restrictSearchWithMatch"] == {"type": {"$in": ["part", "product"]}}
    assert p[2]["$project"]["score"] == {"$meta": "vectorSearchScore"}


# ---------- graph building ----------


def test_build_graph_depths_and_links():
    docs = [
        {
            "_id": "sup-1",
            "type": "supplier",
            "name": "S",
            "out_supplies": ["par-1"],
            "out_component_of": [],
            "out_sold_to": [],
            "reach": [
                {
                    "_id": "par-1",
                    "type": "part",
                    "name": "P",
                    "depth": 0,
                    "out_supplies": [],
                    "out_component_of": ["pro-1"],
                    "out_sold_to": [],
                },
                {
                    "_id": "pro-1",
                    "type": "product",
                    "name": "X",
                    "depth": 1,
                    "out_supplies": [],
                    "out_component_of": [],
                    "out_sold_to": ["cus-9"],
                },
            ],
        }
    ]
    nodes, links = router_mod.build_graph(docs, "all")
    assert [(n.id, n.depth, n.start) for n in nodes] == [
        ("sup-1", 0, True),
        ("par-1", 1, False),
        ("pro-1", 2, False),
    ]
    assert {(link.source, link.target, link.type) for link in links} == {
        ("sup-1", "par-1", "supplies"),
        ("par-1", "pro-1", "component_of"),
    }


# ---------- router (mocked) ----------


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]):
        self.docs = docs

    async def to_list(self) -> list[dict[str, Any]]:
        return self.docs


class FakeColl:
    def __init__(self):
        self.pipelines: list[Any] = []

    async def aggregate(self, pipeline: list[dict[str, Any]]) -> FakeCursor:
        self.pipelines.append(pipeline)
        return FakeCursor(
            [{"_id": "sup-1", "type": "supplier", "name": "S", "out_supplies": [], "reach": []}]
        )


def test_explore_requires_query_or_ids(monkeypatch: pytest.MonkeyPatch):
    app = create_app()
    coll = FakeColl()
    app.dependency_overrides[get_db] = lambda: {"nodes": coll}
    app.dependency_overrides[require_ready] = lambda: DemoMeta(
        provider="voyage", model="voyage-4", dims=1024, seeded_at=now(), indexed_at=now()
    )
    c = TestClient(app)
    r = c.post("/api/graph-view/explore", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = c.post("/api/graph-view/explore", json={"start_ids": ["sup-1"], "max_depth": 0})
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["id"] == "sup-1" and body["links"] == []
    assert coll.pipelines[0][1]["$graphLookup"]["maxDepth"] == 0


# ---------- Atlas integration ----------


@pytest.mark.atlas
def test_atlas_graph_lookup(atlas_uri: str):
    import asyncio

    from app.core.db import make_client
    from app.core.query import run_pipeline

    db_name = f"demokit_test_{int(time.time() * 1000)}"

    async def go() -> None:
        client = make_client(atlas_uri)
        db = client[db_name]
        nodes = generate()
        await db.nodes.insert_many(nodes)
        sup = next(n for n in nodes if n["type"] == "supplier")

        run = await run_pipeline(db.nodes, pipelines.explore(start_ids=[sup["_id"]], max_depth=0))
        g_nodes, _ = router_mod.build_graph(run.results, "all")
        assert {n.id for n in g_nodes if not n.start} == set(sup["out_all"])

        run = await run_pipeline(
            db.nodes,
            pipelines.explore(start_ids=[sup["_id"]], max_depth=3, restrict_types=["part"]),
        )
        g_nodes, _ = router_mod.build_graph(run.results, "all")
        assert {n.type for n in g_nodes if not n.start} == {"part"}

        await client.drop_database(db_name)
        await client.close()

    asyncio.run(go())
