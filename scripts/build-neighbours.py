"""Precompute similar poems for every interest poem.

Reads Ganjoor's published embeddings from .data/ (git-excluded, ~530MB):
  .data/embeddings.f32         float32 [count x dimension], L2-normalized
  .data/embeddings-index.json  {"dimension", "count", "ids": [...]} row order
and writes public/data/neighbours.json: {poemId: [nearest poemIds]}.

Run from the repo root: python3 scripts/build-neighbours.py
"""

import glob
import json
import os

import numpy as np

TOP_K = 10
CHUNK = 256
# Ganjoor holds some poems twice (other editions); near-identical vectors are not useful picks.
DUPLICATE_SIMILARITY = 0.995
OUT = "public/data/neighbours.json"

index = json.load(open(".data/embeddings-index.json"))
ids = np.asarray(index["ids"], dtype=np.int64)
emb = np.fromfile(".data/embeddings.f32", dtype=np.float32).reshape(
    index["count"], index["dimension"]
)
assert len(ids) == emb.shape[0]
# Vectors are published normalized, so the dot product is the cosine similarity.
assert abs(float(np.linalg.norm(emb[0])) - 1) < 1e-3

row_of = {int(pid): row for row, pid in enumerate(ids)}
wanted = sorted(
    {
        pid
        for path in glob.glob("public/data/interests/*.json")
        for pid in json.load(open(path))["poemIds"]
    }
)
missing = [pid for pid in wanted if pid not in row_of]
wanted = [pid for pid in wanted if pid in row_of]
print(f"interest poems: {len(wanted)} (without embedding: {len(missing)})")

neighbours = {}
for start in range(0, len(wanted), CHUNK):
    chunk = wanted[start : start + CHUNK]
    rows = np.array([row_of[pid] for pid in chunk])
    sims = emb[rows] @ emb.T
    sims[np.arange(len(rows)), rows] = -1  # never recommend the poem itself
    sims[sims >= DUPLICATE_SIMILARITY] = -1
    top = np.argpartition(-sims, TOP_K, axis=1)[:, :TOP_K]
    for i, pid in enumerate(chunk):
        best = top[i][np.argsort(-sims[i, top[i]])]
        neighbours[str(pid)] = [int(ids[r]) for r in best]
    print(f"  {start + len(chunk)}/{len(wanted)}", flush=True)

for pid, near in neighbours.items():
    assert int(pid) not in near and len(near) == TOP_K and len(set(near)) == TOP_K

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(neighbours, fh, separators=(",", ":"))
print(f"wrote {OUT}: {len(neighbours)} poems, {os.path.getsize(OUT) / 1024:.0f} KB")
