"""Pure pipeline builders for Graph View."""

from __future__ import annotations

from typing import Any, Literal

from .indexes import VECTOR_INDEX

Pipeline = list[dict[str, Any]]
EdgeType = Literal["all", "supplies", "component_of", "sold_to"]
NodeType = Literal["supplier", "part", "product", "customer"]

EDGE_FIELDS: dict[str, str] = {
    "supplies": "out_supplies",
    "component_of": "out_component_of",
    "sold_to": "out_sold_to",
    "all": "out_all",
}
LINK_FIELDS = ["out_supplies", "out_component_of", "out_sold_to"]
NODE_FIELDS = ["_id", "type", "name", "description", *LINK_FIELDS]


def start_stage(
    qvec: list[float] | None, start_ids: list[str] | None, k: int = 3
) -> dict[str, Any]:
    if start_ids:
        return {"$match": {"_id": {"$in": start_ids}}}
    assert qvec is not None
    return {
        "$vectorSearch": {
            "index": VECTOR_INDEX,
            "path": "embedding",
            "queryVector": qvec,
            "numCandidates": k * 30,
            "limit": k,
        }
    }


def explore(
    *,
    qvec: list[float] | None = None,
    start_ids: list[str] | None = None,
    max_depth: int = 1,
    edge_type: EdgeType = "all",
    restrict_types: list[NodeType] | None = None,
    k: int = 3,
) -> Pipeline:
    field = EDGE_FIELDS[edge_type]
    lookup: dict[str, Any] = {
        "from": "nodes",
        "startWith": f"${field}",
        "connectFromField": field,
        "connectToField": "_id",
        "as": "reach",
        "maxDepth": max_depth,
        "depthField": "depth",
    }
    if restrict_types:
        lookup["restrictSearchWithMatch"] = {"type": {"$in": list(restrict_types)}}
    project: dict[str, Any] = {f: 1 for f in NODE_FIELDS}
    project.update({f"reach.{f}": 1 for f in NODE_FIELDS})
    project["reach.depth"] = 1
    if not start_ids:
        project["score"] = {"$meta": "vectorSearchScore"}
    return [start_stage(qvec, start_ids, k), {"$graphLookup": lookup}, {"$project": project}]
