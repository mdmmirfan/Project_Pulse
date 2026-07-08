"""
engine.py — the brain of the Pulse web app.

Loads the frozen Music Atlas (atlas_artifacts/) once, then for any new song:
  audio (30s) -> AST embedding + interpretable features -> placed into BOTH frozen
  lenses (Sound + Feature) via numba-free kNN -> taste type + feature percentiles.

It reuses the project engine (pulse_core) so the science stays in one place. The
kNN placement mirrors make_atlas_maps.py (an approximate, stable stand-in for
umap.transform that doesn't need numba — robust on every machine).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from sklearn.neighbors import NearestNeighbors

# Make the project root importable so we can `import pulse_core`.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pulse_core as pc  # noqa: E402
from pulse_core import (  # noqa: E402
    INTERPRETABLE_FEATURES,
    FEATURE_LABELS,
    assign_taste_type,
)

ART = ROOT / "atlas_artifacts"
ITUNES_SEARCH = "https://itunes.apple.com/search"
K_NEIGHBORS = 12

# Bipolar names for each feature (low pole -> high pole) for the "signature" UI.
FEATURE_POLES = {
    "brightness_centroid":  ("Warm", "Bright"),
    "percussiveness_zcr":   ("Smooth", "Percussive"),
    "tempo_bpm":            ("Slow", "Fast"),
    "rms_variance":         ("Steady", "Dynamic"),
    "peak_to_trough_ratio": ("Compressed", "Wide contrast"),
    "energy_gradient":      ("Gradual", "Abrupt"),
    "chroma_variance":      ("Shifting", "Tonal"),
    "melody_to_drum_ratio": ("Beat-driven", "Melodic"),
}

_STATE: dict = {}


# ---------------------------------------------------------------------------
# Startup: load the frozen atlas + fit the kNN placers once.
# ---------------------------------------------------------------------------
def init() -> None:
    if _STATE:
        return

    atlas = pd.read_csv(ART / "atlas.csv")
    sound_scaler = joblib.load(ART / "sound_scaler.joblib")
    feat_scaler = joblib.load(ART / "feat_scaler.joblib")
    dim_cols = [c for c in atlas.columns if c.startswith("dim_")]

    ref_sound = sound_scaler.transform(atlas[dim_cols].values)
    ref_feat = feat_scaler.transform(atlas[INTERPRETABLE_FEATURES].values)

    nn_sound = NearestNeighbors(n_neighbors=min(K_NEIGHBORS, len(atlas))).fit(ref_sound)
    nn_feat = NearestNeighbors(n_neighbors=min(K_NEIGHBORS, len(atlas))).fit(ref_feat)

    # Taste-type reference = the personal interpretable corpus (keeps labels consistent
    # with the original project). Fall back to the atlas if it's missing.
    interp_path = ROOT / "project_pulse_interpretable_features.csv"
    taste_ref = pd.read_csv(interp_path) if interp_path.exists() else atlas

    _STATE.update(
        atlas=atlas,
        dim_cols=dim_cols,
        sound_scaler=sound_scaler,
        feat_scaler=feat_scaler,
        nn_sound=nn_sound,
        nn_feat=nn_feat,
        sound_coords=atlas[["SX", "SY", "SZ"]].values,
        feat_coords=atlas[["FX", "FY", "FZ"]].values,
        feat_matrix=atlas[INTERPRETABLE_FEATURES].values,  # for percentiles
        taste_ref=taste_ref,
    )
    _STATE["reference_me"] = _project_personal_corpus()


def _knn_place(nn, coords, new_scaled):
    dist, idx = nn.kneighbors(new_scaled)
    w = 1.0 / (dist + 1e-9)
    w /= w.sum(axis=1, keepdims=True)
    return np.einsum("nk,nkc->nc", w, coords[idx])


def _percentiles(feats: dict) -> dict:
    """Where each feature sits vs the whole atlas, as 0..1 (for the tick sliders)."""
    fm = _STATE["feat_matrix"]
    out = {}
    for i, key in enumerate(INTERPRETABLE_FEATURES):
        out[key] = float((fm[:, i] < feats[key]).mean())
    return out


# ---------------------------------------------------------------------------
# Place one song (from a loaded waveform).
# ---------------------------------------------------------------------------
def place_waveform(y, sr, name: str, artist: str = "", artwork: str = "") -> dict:
    emb = pc.extract_neural_embedding(y, sr)
    feats = pc.extract_interpretable_features(y, sr)

    s_scaled = _STATE["sound_scaler"].transform(emb.reshape(1, -1))
    sx, sy, sz = _knn_place(_STATE["nn_sound"], _STATE["sound_coords"], s_scaled)[0]

    fvec = np.array([[feats[k] for k in INTERPRETABLE_FEATURES]])
    f_scaled = _STATE["feat_scaler"].transform(fvec)
    fx, fy, fz = _knn_place(_STATE["nn_feat"], _STATE["feat_coords"], f_scaled)[0]

    taste = assign_taste_type(feats, _STATE["taste_ref"])
    pct = _percentiles(feats)

    return {
        "name": name,
        "artist": artist,
        "artwork": artwork,
        "taste_type": taste,
        "sound": {"x": float(sx), "y": float(sy), "z": float(sz)},
        "feature": {"x": float(fx), "y": float(fy), "z": float(fz)},
        "features": {
            FEATURE_LABELS[k]: round(float(feats[k]), 3) for k in INTERPRETABLE_FEATURES
        },
        "signature": [
            {
                "key": k,
                "label": FEATURE_LABELS[k],
                "low": FEATURE_POLES[k][0],
                "high": FEATURE_POLES[k][1],
                "value": pct[k],  # 0..1 position along the axis
            }
            for k in INTERPRETABLE_FEATURES
        ],
    }


# ---------------------------------------------------------------------------
# iTunes Search API (free, no key) — autocomplete + 30s preview source.
# ---------------------------------------------------------------------------
def itunes_search(query: str, limit: int = 8) -> list[dict]:
    if not query.strip():
        return []
    r = requests.get(
        ITUNES_SEARCH,
        params={"term": query, "media": "music", "entity": "song", "limit": limit},
        timeout=12,
    )
    r.raise_for_status()
    out = []
    for hit in r.json().get("results", []):
        if not hit.get("previewUrl"):
            continue
        out.append({
            "id": hit.get("trackId"),
            "name": hit.get("trackName"),
            "artist": hit.get("artistName"),
            "album": hit.get("collectionName"),
            "genre": hit.get("primaryGenreName"),
            "artwork": (hit.get("artworkUrl100") or "").replace("100x100", "200x200"),
            "previewUrl": hit.get("previewUrl"),
        })
    return out


def place_from_preview(preview_url: str, name: str, artist: str = "",
                       artwork: str = "") -> dict:
    data = requests.get(preview_url, timeout=25).content
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as f:
        f.write(data)
        path = f.name
    try:
        y, sr = pc.load_snippet(path, seconds=30)
        return place_waveform(y, sr, name, artist, artwork)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Payloads for the frontend.
# ---------------------------------------------------------------------------
def _project_personal_corpus() -> list[dict]:
    """Project the 99 personal Liked/Disliked songs once (for the 'compare' overlay).
    Uses the saved CSV embeddings (full-track) — approximate vs 30s clips, noted in UI.
    """
    neural_path = ROOT / "project_pulse_neural_data.csv"
    interp_path = ROOT / "project_pulse_interpretable_features.csv"
    if not (neural_path.exists() and interp_path.exists()):
        return []
    neural = pd.read_csv(neural_path)
    interp = pd.read_csv(interp_path)
    me = neural.merge(interp, on=["Track", "Preference"], how="inner")
    dim_cols = _STATE["dim_cols"]

    s = _STATE["sound_scaler"].transform(me[dim_cols].values)
    sc = _knn_place(_STATE["nn_sound"], _STATE["sound_coords"], s)
    f = _STATE["feat_scaler"].transform(me[INTERPRETABLE_FEATURES].values)
    fc = _knn_place(_STATE["nn_feat"], _STATE["feat_coords"], f)

    rows = []
    for i, r in me.reset_index(drop=True).iterrows():
        rows.append({
            "name": r["Track"],
            "preference": r["Preference"],
            "sound": {"x": float(sc[i, 0]), "y": float(sc[i, 1]), "z": float(sc[i, 2])},
            "feature": {"x": float(fc[i, 0]), "y": float(fc[i, 1]), "z": float(fc[i, 2])},
        })
    return rows


def atlas_payload() -> dict:
    a = _STATE["atlas"]
    medians = {k: float(a[k].median()) for k in INTERPRETABLE_FEATURES}
    points = []
    for _, r in a.iterrows():
        points.append({
            "id": int(r["track_id"]),
            "genre": r["genre"],
            "sound": {"x": float(r["SX"]), "y": float(r["SY"]), "z": float(r["SZ"])},
            "feature": {"x": float(r["FX"]), "y": float(r["FY"]), "z": float(r["FZ"])},
            "feats": {k: float(r[k]) for k in INTERPRETABLE_FEATURES},
        })
    return {
        "genres": sorted(a["genre"].unique().tolist()),
        "points": points,
        "reference_me": _STATE["reference_me"],
        "feature_labels": FEATURE_LABELS,
        "feature_keys": INTERPRETABLE_FEATURES,
        "feat_medians": medians,
        "feature_poles": {
            k: {"low": FEATURE_POLES[k][0], "high": FEATURE_POLES[k][1]}
            for k in INTERPRETABLE_FEATURES
        },
    }
