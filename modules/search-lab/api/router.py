"""POST /api/search-lab/query runs four strategies side by side for one query."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from pymongo.asynchronous.database import AsyncDatabase

from app.core.db import get_db
from app.core.embeddings import VoyageProvider, make_provider
from app.core.errors import to_app_error
from app.core.meta import DemoMeta, require_ready
from app.core.models import ApiModel
from app.core.query import Pipeline, QueryResponse, Timings, run_pipeline, to_json
from app.core.settings import RERANK_MODEL, get_settings

from . import pipelines
from .pipelines import Filters

router = APIRouter(prefix="/api/search-lab", tags=["search-lab"])

Column = Literal["text", "vector", "hybrid", "rerank"]
RERANK_CANDIDATES = 20
LIMIT = 10


class QueryRequest(BaseModel):
    q: str = Field(min_length=1, max_length=200)
    filters: Filters = Field(default_factory=Filters)
    text_weight: float = Field(default=0.5, ge=0, le=1)
    explain: bool = False
    only: Column | None = None


class ProductHit(ApiModel):
    id: str
    rank: int
    score: float
    title: str
    description: str
    category: str
    brand: str
    price: float
    highlights: list[dict[str, Any]] = []
    score_details: dict[str, Any] | None = None


class ColumnError(ApiModel):
    code: str
    message: str
    hint: str


class SearchLabResponse(ApiModel):
    text: QueryResponse[ProductHit] | None
    vector: QueryResponse[ProductHit] | None
    hybrid: QueryResponse[ProductHit] | None
    rerank: QueryResponse[ProductHit] | None
    rerank_reason: str | None = None
    errors: dict[str, ColumnError] = {}


class Facets(ApiModel):
    categories: list[str]
    price_min: float
    price_max: float


def _hits(docs: list[dict[str, Any]]) -> list[ProductHit]:
    return [
        ProductHit(
            id=str(d["_id"]),
            rank=i + 1,
            score=float(d.get("score") or 0),
            title=d.get("title", ""),
            description=d.get("description", ""),
            category=d.get("category", ""),
            brand=d.get("brand", ""),
            price=float(d.get("price") or 0),
            highlights=to_json(d.get("highlights") or []),
            score_details=to_json(d["scoreDetails"]) if d.get("scoreDetails") else None,
        )
        for i, d in enumerate(docs)
    ]


@router.get("/facets", response_model=Facets)
async def facets(
    _: DemoMeta = Depends(require_ready), db: AsyncDatabase = Depends(get_db)
) -> Facets:
    coll = db["products"]
    stats = await (
        await coll.aggregate(
            [{"$group": {"_id": None, "min": {"$min": "$price"}, "max": {"$max": "$price"}}}]
        )
    ).to_list()
    s = stats[0] if stats else {"min": 0, "max": 0}
    return Facets(
        categories=sorted(await coll.distinct("category")), price_min=s["min"], price_max=s["max"]
    )


@router.post("/query", response_model=SearchLabResponse)
async def query(
    req: QueryRequest,
    _: DemoMeta = Depends(require_ready),
    db: AsyncDatabase = Depends(get_db),
) -> SearchLabResponse:
    settings = get_settings()
    provider = make_provider(settings)
    coll = db["products"]
    wanted = {req.only} if req.only else {"text", "vector", "hybrid", "rerank"}
    errors: dict[str, ColumnError] = {}

    qvec: list[float] = []
    embed_ms = None
    if wanted - {"text"}:
        t = time.perf_counter()
        qvec = (await provider.embed([req.q], "query"))[0]
        embed_ms = round((time.perf_counter() - t) * 1000, 2)

    async def run(name: str, pipeline: Pipeline, uses_embedding: bool):
        try:
            r = await run_pipeline(coll, pipeline, explain=req.explain)
        except Exception as exc:
            err = to_app_error(exc)
            errors[name] = ColumnError(code=err.code, message=err.message, hint=err.hint)
            return None
        return QueryResponse[ProductHit](
            results=_hits(r.results),
            pipeline=r.pipeline,
            timings=Timings(server_ms=r.server_ms, embed_ms=embed_ms if uses_embedding else None),
            explain=r.explain,
        )

    tasks: dict[str, Any] = {}
    if "text" in wanted:
        tasks["text"] = run("text", pipelines.text(req.q, req.filters, LIMIT), False)
    if "vector" in wanted:
        tasks["vector"] = run("vector", pipelines.vector(qvec, req.filters, LIMIT), True)
    if wanted & {"hybrid", "rerank"}:
        tasks["hybrid"] = run(
            "hybrid",
            pipelines.hybrid(req.q, qvec, req.filters, req.text_weight, limit=RERANK_CANDIDATES),
            True,
        )
    done = dict(zip(tasks, await asyncio.gather(*tasks.values()), strict=True))

    hybrid_all: QueryResponse[ProductHit] | None = done.get("hybrid")
    hybrid = None
    if hybrid_all and "hybrid" in wanted:
        hybrid = hybrid_all.model_copy(update={"results": hybrid_all.results[:LIMIT]})

    rerank = None
    rerank_reason = None
    if "rerank" in wanted:
        if not isinstance(provider, VoyageProvider):
            rerank_reason = (
                f"Reranking uses Voyage {RERANK_MODEL}. Switch the provider to Voyage AI on Setup."
            )
        elif hybrid_all is None:
            rerank_reason = "Hybrid search failed, so there is nothing to rerank."
        elif hybrid_all.results:
            candidates = hybrid_all.results
            t = time.perf_counter()
            try:
                ranked = await provider.rerank(
                    req.q,
                    [f"{h.title}. {h.description}" for h in candidates],
                    top_k=LIMIT,
                    model=RERANK_MODEL,
                )
            except Exception as exc:
                err = to_app_error(exc)
                errors["rerank"] = ColumnError(code=err.code, message=err.message, hint=err.hint)
            else:
                results = [
                    candidates[r["index"]].model_copy(
                        update={"rank": i + 1, "score": r["relevance_score"], "score_details": None}
                    )
                    for i, r in enumerate(ranked)
                ]
                rerank = QueryResponse[ProductHit](
                    results=results,
                    pipeline=hybrid_all.pipeline,
                    timings=Timings(
                        server_ms=hybrid_all.timings.server_ms,
                        embed_ms=embed_ms,
                        rerank_ms=round((time.perf_counter() - t) * 1000, 2),
                    ),
                    explain=hybrid_all.explain,
                )
        else:
            rerank = hybrid_all

    return SearchLabResponse(
        text=done.get("text"),
        vector=done.get("vector"),
        hybrid=hybrid,
        rerank=rerank,
        rerank_reason=rerank_reason,
        errors=errors,
    )
