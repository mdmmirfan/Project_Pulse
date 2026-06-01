# Pulse — web app (Phase 1 prototype)

A free site: add songs by name → see them mapped through two lenses (Sound + Feature)
on a 320-track atlas → get a shareable **Pulse Card**.

- **Frontend** (`frontend/`): static HTML/CSS/JS + Plotly. Dark/light mode. → later Vercel.
- **Backend** (`backend/`): FastAPI. Searches the free iTunes API for autocomplete +
  30-second previews, runs the AST embedding + interpretable features (via `pulse_core`),
  and places songs into the frozen atlas (`../atlas_artifacts/`) with numba-free kNN.
  → later HuggingFace Spaces.

## Run locally

```bash
# from the project root, with pulse_env active deps installed
pulse_env/bin/uvicorn web.backend.server:app --port 8000
# then open http://localhost:8000
```

Needs `ffmpeg` on PATH (to decode the .m4a previews). The AST model downloads once
(~350 MB) on first use, then is cached.

## Notes / honest caveats
- Song placement uses inverse-distance-weighted kNN among atlas tracks (a numba-free
  stand-in for `umap.transform`) — approximate but stable.
- iTunes previews are 30s clips; the personal "compare" overlay uses full-track
  embeddings, so that overlay is approximate.
- No data is stored. The public gallery + usernames come in Phase 2 (Supabase).
