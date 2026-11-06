"""Index definitions for Search Lab. `numDimensions` comes from `_demo_meta.dims`."""

from __future__ import annotations

from app.core.registry import RegularIndex, SearchIndex

SEARCH_INDEX = "products_search"
VECTOR_INDEX = "products_vector"


def regular() -> list[RegularIndex]:
    return [
        {
            "collection": "products",
            "name": "category_price",
            "keys": [("category", 1), ("price", 1)],
        }
    ]


def search() -> list[SearchIndex]:
    return [
        {
            "collection": "products",
            "name": SEARCH_INDEX,
            "definition": {
                "mappings": {
                    "dynamic": False,
                    "fields": {
                        "title": {"type": "string", "analyzer": "lucene.english"},
                        "description": {"type": "string", "analyzer": "lucene.english"},
                        "tags": {"type": "string"},
                        "category": {"type": "token"},
                        "brand": {"type": "token"},
                        "price": {"type": "number"},
                    },
                }
            },
        }
    ]


def vector(dims: int) -> list[SearchIndex]:
    return [
        {
            "collection": "products",
            "name": VECTOR_INDEX,
            "definition": {
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": dims,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "category"},
                    {"type": "filter", "path": "price"},
                ]
            },
        }
    ]
