"""T02 spike: verify Atlas assumptions against a real 9.0 cluster.

Run from the kit root (uses the template's Python env):
    MONGODB_URI_TEST='mongodb+srv://...' \
    uv run --directory template/api python ../../scripts/spike/spike_atlas.py

Creates and drops a `demokit_spike_<ts>` database. Prints PASS/FAIL per check.
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
import time

import certifi
from pymongo import AsyncMongoClient
from pymongo.operations import SearchIndexModel

DIMS = 8


def vec(rng: random.Random) -> list[float]:
    return [rng.uniform(-1, 1) for _ in range(DIMS)]


async def wait_queryable(coll, name: str, timeout: float = 600) -> float:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        info = await (await coll.list_search_indexes(name)).to_list()
        if info and info[0].get("queryable") and info[0].get("status") == "READY":
            return time.monotonic() - start
        await asyncio.sleep(3)
    raise TimeoutError(name)


async def main() -> int:
    uri = os.environ.get("MONGODB_URI_TEST")
    if not uri:
        print("Set MONGODB_URI_TEST")
        return 2
    client = AsyncMongoClient(uri, tlsCAFile=certifi.where(), appName="demokit-spike")
    db = client[f"demokit_spike_{int(time.time())}"]
    results: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

    try:
        info = await client.admin.command("buildInfo")
        record("AsyncMongoClient + certifi ping", True, f"MongoDB {info['version']}")

        rng = random.Random(1)
        products = db.products
        await products.insert_many([
            {"_id": i, "title": f"red shoe {i}" if i % 2 else f"blue hat {i}",
             "category": "shoes" if i % 2 else "hats", "price": i * 10, "embedding": vec(rng)}
            for i in range(40)
        ])
        await products.create_search_indexes([
            SearchIndexModel(name="s", type="search", definition={"mappings": {"dynamic": False, "fields": {
                "title": {"type": "string"}, "category": {"type": "token"}, "price": {"type": "number"}}}}),
            SearchIndexModel(name="v", type="vectorSearch", definition={"fields": [
                {"type": "vector", "path": "embedding", "numDimensions": DIMS, "similarity": "cosine"},
                {"type": "filter", "path": "category"}, {"type": "filter", "path": "price"}]}),
        ])
        for name in ("s", "v"):
            secs = await wait_queryable(products, name)
            record(f"create_search_indexes + poll queryable ({name})", True, f"{secs:.0f}s")

        q = vec(rng)
        res = await (await products.aggregate([
            {"$vectorSearch": {"index": "v", "path": "embedding", "queryVector": q, "numCandidates": 40,
                               "limit": 5, "filter": {"category": "shoes", "price": {"$lte": 300}}}},
        ])).to_list()
        record("$vectorSearch pre-filter (token + number)",
               bool(res) and all(d["category"] == "shoes" and d["price"] <= 300 for d in res))

        res = await (await products.aggregate([
            {"$rankFusion": {
                "input": {"pipelines": {
                    "text": [{"$search": {"index": "s", "text": {"query": "shoe", "path": "title"}}},
                             {"$limit": 10}],
                    "vector": [{"$vectorSearch": {"index": "v", "path": "embedding", "queryVector": q,
                                                  "numCandidates": 40, "limit": 10}}],
                }},
                "combination": {"weights": {"text": 1, "vector": 1}},
                "scoreDetails": True,
            }},
            {"$limit": 5},
            {"$project": {"title": 1, "scoreDetails": {"$meta": "scoreDetails"}}},
        ])).to_list()
        record("$rankFusion($search + $vectorSearch) with scoreDetails",
               bool(res) and "scoreDetails" in res[0])

        nodes = db.nodes
        await nodes.insert_many([
            {"_id": "s1", "type": "supplier", "out": ["p1"]},
            {"_id": "p1", "type": "part", "out": ["x1"]},
            {"_id": "x1", "type": "product", "out": ["c1"]},
            {"_id": "c1", "type": "customer", "out": []},
        ])
        res = await (await nodes.aggregate([
            {"$match": {"_id": "s1"}},
            {"$graphLookup": {"from": "nodes", "startWith": "$out", "connectFromField": "out",
                              "connectToField": "_id", "as": "reach", "maxDepth": 3,
                              "depthField": "depth", "restrictSearchWithMatch": {"type": {"$ne": "customer"}}}},
        ])).to_list()
        reach = {d["_id"]: d["depth"] for d in res[0]["reach"]}
        record("$graphLookup restrictSearchWithMatch + depthField",
               reach == {"p1": 0, "x1": 1}, str(reach))
    except Exception as exc:
        record("unexpected error", False, repr(exc))
    finally:
        await client.drop_database(db.name)
        await client.close()
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
