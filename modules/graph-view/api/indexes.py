"""Index definitions for Graph View. `numDimensions` comes from `_demo_meta.dims`."""

from __future__ import annotations

from app.core.registry import RegularIndex, SearchIndex

VECTOR_INDEX = "nodes_vector"


def regular() -> list[RegularIndex]:
    return [{"collection": "nodes", "name": "type_1", "keys": [("type", 1)]}]


def search() -> list[SearchIndex]:
    return []


def vector(dims: int) -> list[SearchIndex]:
    return [
        {
            "collection": "nodes",
            "name": VECTOR_INDEX,
            "definition": {
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": dims,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "type"},
                ]
            },
        }
    ]
