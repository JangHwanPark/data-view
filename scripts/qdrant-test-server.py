"""Qdrant 시험 서버(33단계 개발용). 실제 Qdrant를 띄울 수 없는 PC에서 앱의 벡터 DB 화면을 시험한다.

qdrant-client의 로컬 모드(Qdrant의 검색 엔진을 파이썬으로 옮긴 것)를 Qdrant REST API와 같은 모양으로 감싼다.
앱이 쓰는 것만 있다: 컬렉션 목록, 컬렉션 정보, points/scroll, points/query. 회사 데이터와 상관없는 지어낸 데이터를 넣는다.

    python -m venv qvenv && qvenv/bin/pip install qdrant-client fastapi uvicorn
    QDRANT_TEST_KEY=test-key qvenv/bin/python scripts/qdrant-test-server.py   # http://127.0.0.1:6333

앱의 .env.local: QDRANT_URL=http://127.0.0.1:6333, QDRANT_API_KEY=test-key
"""

import os
import random
import time

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from qdrant_client import QdrantClient, models

KEY = os.environ.get("QDRANT_TEST_KEY", "")
client = QdrantClient(":memory:")
random.seed(20261107)


def unit(v):
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]


def clustered(center, spread):
    return unit([c + random.gauss(0, spread) for c in center])


# 아이템 600개: 종류 3가지마다 벡터가 모이도록 중심을 둔다(산점도에서 무리가 보여야 한다).
DIM = 32
TYPES = {"EQUIP": 0, "CONSUMABLE": 1, "MATERIAL": 2}
centers = {t: unit([random.gauss(0, 1) for _ in range(DIM)]) for t in TYPES}
client.create_collection("game_items", vectors_config=models.VectorParams(size=DIM, distance=models.Distance.COSINE))
points = []
for i in range(600):
    item_type = list(TYPES)[i % 3]
    grade = 1 + (i * 7) % 6
    points.append(
        models.PointStruct(
            id=100001 + i,
            vector=clustered(centers[item_type], 0.35),
            payload={
                "item_id": 100001 + i,
                "name": f"ITEM_{100001 + i}",
                "item_type": item_type,
                "grade": grade,
                "tags": ["sell"] if grade > 3 else [],
                "stats": {"atk": (i * 13) % 200 if item_type == "EQUIP" else None, "weight": round(0.1 * (i % 50), 1)},
            },
        )
    )
client.upsert("game_items", points)

# 대사 120줄: NPC 4명
client.create_collection("dialog_lines", vectors_config=models.VectorParams(size=16, distance=models.Distance.DOT))
npcs = ["Guard", "Merchant", "Farmer", "Sage"]
ncenters = {n: unit([random.gauss(0, 1) for _ in range(16)]) for n in npcs}
client.upsert(
    "dialog_lines",
    [
        models.PointStruct(id=i + 1, vector=clustered(ncenters[npcs[i % 4]], 0.5), payload={"npc": npcs[i % 4], "line_no": i + 1, "text": f"line {i + 1}"})
        for i in range(120)
    ],
)

app = FastAPI()


def check(api_key):
    if KEY and api_key != KEY:
        raise HTTPException(status_code=401, detail="Invalid api-key")


def ok(result, started):
    return {"result": result, "status": "ok", "time": time.time() - started}


@app.get("/collections")
def collections(api_key: str | None = Header(default=None)):
    started = time.time()
    check(api_key)
    return ok({"collections": [{"name": c.name} for c in client.get_collections().collections]}, started)


@app.get("/collections/{name}")
def collection(name: str, api_key: str | None = Header(default=None)):
    started = time.time()
    check(api_key)
    if not client.collection_exists(name):
        raise HTTPException(status_code=404, detail=f"Collection `{name}` doesn't exist!")
    info = client.get_collection(name)
    params = info.config.params.vectors
    return ok(
        {
            "status": "green",
            "optimizer_status": "ok",
            "points_count": client.count(name).count,
            "indexed_vectors_count": 0,
            "segments_count": 1,
            "config": {"params": {"vectors": {"size": params.size, "distance": params.distance.value}}},
            "payload_schema": {},
        },
        started,
    )


@app.post("/collections/{name}/points/scroll")
def scroll(name: str, body: dict, api_key: str | None = Header(default=None)):
    started = time.time()
    check(api_key)
    pts, nxt = client.scroll(name, limit=int(body.get("limit", 10)), offset=body.get("offset"), with_payload=body.get("with_payload", True), with_vectors=body.get("with_vector", False))
    return ok({"points": [{"id": p.id, "payload": p.payload, **({"vector": p.vector} if p.vector is not None else {})} for p in pts], "next_page_offset": nxt}, started)


@app.post("/collections/{name}/points/query")
def query(name: str, body: dict, api_key: str | None = Header(default=None)):
    started = time.time()
    check(api_key)
    q = body.get("query")
    res = client.query_points(name, query=q, limit=int(body.get("limit", 10)), with_payload=body.get("with_payload", True))
    return ok({"points": [{"id": p.id, "version": 0, "score": p.score, "payload": p.payload} for p in res.points]}, started)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=6333, log_level="warning")
