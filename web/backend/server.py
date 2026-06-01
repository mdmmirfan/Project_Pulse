"""
server.py — FastAPI backend for the Pulse web app prototype.

Serves the static frontend AND the API:
  GET  /api/atlas              -> the frozen atlas points + reference overlay
  GET  /api/search?q=...       -> iTunes autocomplete (free, no key)
  POST /api/place {previewUrl} -> place a song into both lenses

Run (dev):  pulse_env/bin/uvicorn web.backend.server:app --reload --port 8000
Then open:  http://localhost:8000
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import engine

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

app = FastAPI(title="Pulse")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    engine.init()


class PlaceRequest(BaseModel):
    previewUrl: str
    name: str = "Untitled"
    artist: str = ""
    artwork: str = ""


@app.get("/api/atlas")
def get_atlas():
    return engine.atlas_payload()


@app.get("/api/search")
def search(q: str = ""):
    try:
        return {"results": engine.itunes_search(q)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"search failed: {e}")


@app.post("/api/place")
def place(req: PlaceRequest):
    try:
        return engine.place_from_preview(req.previewUrl, req.name, req.artist, req.artwork)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"place failed: {e}")


# Static frontend (mounted last so /api/* wins). html=True serves index.html at /.
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
