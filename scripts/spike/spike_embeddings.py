"""T02 spike: verify embedding/rerank provider assumptions.

    TEST_VOYAGE_KEY=... [TEST_VOYAGE_BASE_URL=https://api.voyageai.com] TEST_OPENAI_KEY=... \
    uv run --directory template/api python ../../scripts/spike/spike_embeddings.py
"""

from __future__ import annotations

import os
import sys
import time

import httpx


def post(base: str, path: str, key: str, payload: dict) -> tuple[int, dict, float]:
    t = time.perf_counter()
    r = httpx.post(f"{base}{path}", json=payload, headers={"Authorization": f"Bearer {key}"},
                   timeout=30)
    return r.status_code, (r.json() if r.content else {}), (time.perf_counter() - t) * 1000


def main() -> int:
    ok = True
    voyage = os.environ.get("TEST_VOYAGE_KEY")
    if voyage:
        bases = [os.environ.get("TEST_VOYAGE_BASE_URL") or "https://ai.mongodb.com"]
        for base in bases:
            code, body, ms = post(base, "/v1/embeddings", voyage,
                                  {"input": ["hello"] * 3, "model": "voyage-4", "input_type": "query"})
            dims = len(body["data"][0]["embedding"]) if code == 200 else None
            print(f"{base} voyage-4 embed: HTTP {code}, dims={dims}, {ms:.0f} ms")
            ok &= code == 200 and dims == 1024
            code, body, ms = post(base, "/v1/rerank", voyage, {
                "query": "vector database", "model": "rerank-3", "top_k": 2,
                "documents": ["bananas are yellow", "MongoDB Atlas Vector Search"]})
            top = body["data"][0]["index"] if code == 200 else None
            print(f"{base} rerank-3: HTTP {code}, top index={top}, {ms:.0f} ms")
            ok &= code == 200 and top == 1
            code, _, _ = post(base, "/v1/embeddings", voyage,
                              {"input": ["x"] * 1000, "model": "voyage-4", "input_type": "document"})
            print(f"{base} batch of 1000: HTTP {code}")
    else:
        print("skip voyage (TEST_VOYAGE_KEY not set)")

    openai = os.environ.get("TEST_OPENAI_KEY")
    if openai:
        code, body, ms = post("https://api.openai.com", "/v1/embeddings", openai,
                              {"input": ["hello"], "model": "text-embedding-3-small"})
        dims = len(body["data"][0]["embedding"]) if code == 200 else None
        print(f"openai text-embedding-3-small: HTTP {code}, dims={dims}, {ms:.0f} ms")
        ok &= code == 200 and dims == 1536
    else:
        print("skip openai (TEST_OPENAI_KEY not set)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
