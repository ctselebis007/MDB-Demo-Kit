"""Pure pipeline builders. The exact pipelines run are returned to the UI's Query Drawer."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .indexes import SEARCH_INDEX, VECTOR_INDEX

Pipeline = list[dict[str, Any]]

PROJECT = {"_id": 1, "title": 1, "description": 1, "category": 1, "brand": 1, "price": 1}
SEARCH_PATHS = ["title", "description", "tags"]


class Filters(BaseModel):
    categories: list[str] = Field(default_factory=list)
    price_min: float | None = None
    price_max: float | None = None


def _search_filters(f: Filters) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    if f.categories:
        clauses.append({"in": {"path": "category", "value": f.categories}})
    if f.price_min is not None or f.price_max is not None:
        rng: dict[str, Any] = {"path": "price"}
        if f.price_min is not None:
            rng["gte"] = f.price_min
        if f.price_max is not None:
            rng["lte"] = f.price_max
        clauses.append({"range": rng})
    return clauses


def _vector_filter(f: Filters) -> dict[str, Any] | None:
    clauses: list[dict[str, Any]] = []
    if f.categories:
        clauses.append({"category": {"$in": f.categories}})
    if f.price_min is not None:
        clauses.append({"price": {"$gte": f.price_min}})
    if f.price_max is not None:
        clauses.append({"price": {"$lte": f.price_max}})
    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _search_stage(q: str, f: Filters, highlight: bool) -> dict[str, Any]:
    compound: dict[str, Any] = {
        "must": [{"text": {"query": q, "path": SEARCH_PATHS, "fuzzy": {"maxEdits": 1}}}],
        "should": [{"text": {"query": q, "path": "title", "score": {"boost": {"value": 2}}}}],
    }
    filters = _search_filters(f)
    if filters:
        compound["filter"] = filters
    stage: dict[str, Any] = {"index": SEARCH_INDEX, "compound": compound}
    if highlight:
        stage["highlight"] = {"path": ["title", "description"]}
    return {"$search": stage}


def _vector_stage(qvec: list[float], f: Filters, k: int) -> dict[str, Any]:
    stage: dict[str, Any] = {
        "index": VECTOR_INDEX,
        "path": "embedding",
        "queryVector": qvec,
        "numCandidates": k * 15,
        "limit": k,
    }
    vf = _vector_filter(f)
    if vf:
        stage["filter"] = vf
    return {"$vectorSearch": stage}


def text(q: str, f: Filters, limit: int = 10) -> Pipeline:
    return [
        _search_stage(q, f, highlight=True),
        {"$limit": limit},
        {
            "$project": {
                **PROJECT,
                "score": {"$meta": "searchScore"},
                "highlights": {"$meta": "searchHighlights"},
            }
        },
    ]


def vector(qvec: list[float], f: Filters, k: int = 10) -> Pipeline:
    return [
        _vector_stage(qvec, f, k),
        {"$project": {**PROJECT, "score": {"$meta": "vectorSearchScore"}}},
    ]


def hybrid(
    q: str,
    qvec: list[float],
    f: Filters,
    text_weight: float = 0.5,
    limit: int = 10,
    candidates: int = 20,
) -> Pipeline:
    """Reciprocal rank fusion of full-text and vector results."""
    return [
        {
            "$rankFusion": {
                "input": {
                    "pipelines": {
                        "text": [_search_stage(q, f, highlight=False), {"$limit": candidates}],
                        "vector": [_vector_stage(qvec, f, candidates)],
                    }
                },
                "combination": {
                    "weights": {"text": round(text_weight, 3), "vector": round(1 - text_weight, 3)}
                },
                "scoreDetails": True,
            }
        },
        {"$limit": limit},
        {
            "$project": {
                **PROJECT,
                "score": {"$meta": "score"},
                "scoreDetails": {"$meta": "scoreDetails"},
            }
        },
    ]
