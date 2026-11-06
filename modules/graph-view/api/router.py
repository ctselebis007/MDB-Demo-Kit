"""POST /api/graph-view/explore: vector search for start nodes, then `$graphLookup`."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import get_db
from app.core.embeddings import make_provider
from app.core.errors import AppError
from app.core.meta import DemoMeta, require_ready
from app.core.models import ApiModel
from app.core.query import QueryResponse, Timings, run_pipeline
from app.core.settings import get_settings

from . import pipelines
from .pipelines import LINK_FIELDS, EdgeType, NodeType

router = APIRouter(prefix="/api/graph-view", tags=["graph-view"])

LINK_TYPES = {
    "out_supplies": "supplies",
    "out_component_of": "component_of",
    "out_sold_to": "sold_to",
}


class ExploreRequest(BaseModel):
    query: str | None = Field(default=None, max_length=200)
    start_ids: list[str] | None = Field(default=None, max_length=50)
    max_depth: int = Field(default=1, ge=0, le=5)
    edge_type: EdgeType = "all"
    restrict_types: list[NodeType] | None = None
    explain: bool = False


class GraphNode(ApiModel):
    id: str
    type: str
    name: str
    description: str
    depth: int
    start: bool
    score: float | None = None


class GraphLink(ApiModel):
    source: str
    target: str
    type: str


class ExploreResponse(QueryResponse[GraphNode]):
    links: list[GraphLink]


def build_graph(
    docs: list[dict[str, Any]], edge_type: str
) -> tuple[list[GraphNode], list[GraphLink]]:
    """`depth` is hops from a start node (start = 0, direct neighbour = 1)."""
    nodes: dict[str, GraphNode] = {}
    raw: dict[str, dict[str, Any]] = {}

    def add(doc: dict[str, Any], depth: int, start: bool, score: float | None = None) -> None:
        nid = str(doc["_id"])
        raw.setdefault(nid, doc)
        existing = nodes.get(nid)
        if existing and (existing.start or existing.depth <= depth):
            return
        nodes[nid] = GraphNode(
            id=nid,
            type=doc.get("type", ""),
            name=doc.get("name", nid),
            description=doc.get("description", ""),
            depth=depth,
            start=start,
            score=score,
        )

    for doc in docs:
        add(doc, 0, True, doc.get("score"))
    for doc in docs:
        for r in doc.get("reach", []):
            add(r, int(r.get("depth", 0)) + 1, False)

    fields = LINK_FIELDS if edge_type == "all" else [pipelines.EDGE_FIELDS[edge_type]]
    links = [
        GraphLink(source=nid, target=t, type=LINK_TYPES[f])
        for nid, doc in raw.items()
        for f in fields
        for t in doc.get(f, [])
        if t in nodes
    ]
    order = sorted(nodes.values(), key=lambda n: (n.depth, n.id))
    return order, links


@router.post("/explore", response_model=ExploreResponse)
async def explore(
    req: ExploreRequest,
    _: DemoMeta = Depends(require_ready),
    db: AsyncDatabase = Depends(get_db),
) -> ExploreResponse:
    if not req.start_ids and not (req.query and req.query.strip()):
        raise AppError(
            "VALIDATION_ERROR",
            "Provide a query or start_ids.",
            "Type a question or click a node.",
            422,
        )
    qvec = None
    embed_ms = None
    if not req.start_ids:
        assert req.query is not None
        t = time.perf_counter()
        qvec = (await make_provider(get_settings()).embed([req.query.strip()], "query"))[0]
        embed_ms = round((time.perf_counter() - t) * 1000, 2)

    pipeline = pipelines.explore(
        qvec=qvec,
        start_ids=req.start_ids,
        max_depth=req.max_depth,
        edge_type=req.edge_type,
        restrict_types=req.restrict_types,
    )
    run = await run_pipeline(db["nodes"], pipeline, explain=req.explain)
    nodes, links = build_graph(run.results, req.edge_type)
    return ExploreResponse(
        results=nodes,
        links=links,
        pipeline=run.pipeline,
        timings=Timings(server_ms=run.server_ms, embed_ms=embed_ms),
        explain=run.explain,
    )
