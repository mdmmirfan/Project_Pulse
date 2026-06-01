"""
pulse_core — the reusable engine for Project Pulse.

Everything that does real work lives here so the notebook, a Colab, or a future
web backend can all `import pulse_core` instead of copy-pasting code.

Two kinds of features are produced for every track:
  1. The 768-D AST neural embedding  -> the "how it really sounds" space.
  2. Eight named interpretable features -> the "here's WHY it sits here" space.

The reference space (UMAP) is fit ONCE on a corpus and frozen to disk, so new
songs can be projected into the *same* coordinates later. That frozen space is
what makes "drop your songs onto my map and compare" possible.
"""
from __future__ import annotations

import os
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent

NEURAL_CSV        = ROOT / "project_pulse_neural_data.csv"          # 768-D + X/Y/Z
INTERPRETABLE_CSV = ROOT / "project_pulse_interpretable_features.csv"
ARTIFACT_DIR      = ROOT / "artifacts"                              # frozen models

LIKED_DIR    = ROOT / "data" / "cluster_a_love"
DISLIKED_DIR = ROOT / "data" / "cluster_b_dislike"

SAMPLE_RATE  = 22050
EMBED_DIM    = 768
RANDOM_STATE = 42

# Human-readable features and the plain-English meaning of each.
INTERPRETABLE_FEATURES = [
    "brightness_centroid",   # darker (low) -> brighter (high)
    "percussiveness_zcr",    # smooth (low) -> percussive / noisy (high)
    "tempo_bpm",             # slow (low)   -> fast (high)
    "rms_variance",          # flat (low)   -> dynamic, lots of peaks/valleys (high)
    "peak_to_trough_ratio",  # compressed   -> wide quiet/loud contrast (high)
    "energy_gradient",       # gradual      -> abrupt volume changes (high)
    "chroma_variance",       # atonal/shifting (low) -> stays in a clear key (high)
    "melody_to_drum_ratio",  # drum-driven (low)     -> melody-driven (high)
]

FEATURE_LABELS = {
    "brightness_centroid":  "Brightness",
    "percussiveness_zcr":   "Percussiveness",
    "tempo_bpm":            "Tempo",
    "rms_variance":         "Dynamic Range",
    "peak_to_trough_ratio": "Loud/Quiet Contrast",
    "energy_gradient":      "Abruptness",
    "chroma_variance":      "Tonal Stability",
    "melody_to_drum_ratio": "Melody vs Drums",
}


# ---------------------------------------------------------------------------
# 1. Interpretable acoustic features (named, explainable)
# ---------------------------------------------------------------------------
def extract_interpretable_features(y: np.ndarray, sr: int) -> dict:
    """Compute the 8 named, human-readable acoustic features for one waveform."""
    import librosa

    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(tempo[0]) if isinstance(tempo, np.ndarray) else float(tempo)

    rms = librosa.feature.rms(y=y)[0]
    trough, peak = np.percentile(rms, 10), np.percentile(rms, 90)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_variance = float(np.var(np.mean(chroma, axis=1)))

    y_harmonic, y_percussive = librosa.effects.hpss(y)
    h_energy = float(np.sum(y_harmonic ** 2))
    p_energy = float(np.sum(y_percussive ** 2))

    return {
        "brightness_centroid":  centroid,
        "percussiveness_zcr":   zcr,
        "tempo_bpm":            tempo,
        "rms_variance":         float(np.var(rms)),
        "peak_to_trough_ratio": float(peak / (trough + 1e-6)),
        "energy_gradient":      float(np.mean(np.abs(np.diff(rms)))),
        "chroma_variance":      chroma_variance,
        "melody_to_drum_ratio": float(h_energy / (p_energy + 1e-6)),
    }


def build_interpretable_dataset(
    liked_dir: Path = LIKED_DIR,
    disliked_dir: Path = DISLIKED_DIR,
    save_to: Path | None = INTERPRETABLE_CSV,
    verbose: bool = True,
) -> pd.DataFrame:
    """Scan the audio folders and compute interpretable features for every track.

    `Track` is the filename without extension, matching the neural CSV so the two
    feature tables can be joined later.
    """
    import librosa

    rows = []
    for folder, label in [(Path(liked_dir), "Liked"), (Path(disliked_dir), "Disliked")]:
        if not folder.exists():
            if verbose:
                print(f"  (skipping missing folder: {folder})")
            continue
        files = sorted(f for f in os.listdir(folder) if f.lower().endswith((".wav", ".mp3")))
        for i, fn in enumerate(files, 1):
            track = os.path.splitext(fn)[0]
            try:
                y, sr = librosa.load(folder / fn, sr=SAMPLE_RATE)
                feats = extract_interpretable_features(y, sr)
                feats.update({"Track": track, "Preference": label})
                rows.append(feats)
                if verbose:
                    print(f"  [{label}] {i}/{len(files)}: {track[:50]}")
            except Exception as e:
                print(f"  ! failed on {fn}: {e}")

    df = pd.DataFrame(rows)
    cols = ["Track", "Preference"] + INTERPRETABLE_FEATURES
    df = df[cols]
    if save_to is not None:
        df.to_csv(save_to, index=False)
        if verbose:
            print(f"\nSaved {len(df)} rows -> {save_to}")
    return df


# ---------------------------------------------------------------------------
# 2. Deep neural embedding (AST) — lazy loaded so importing this module is cheap
# ---------------------------------------------------------------------------
_AST_CACHE: dict = {}
_AST_MODEL_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"


def _load_ast():
    """Load + cache the AST processor/model (downloads ~hundreds of MB once).

    Uses a GPU automatically if one is available (e.g. on Colab), else CPU.
    """
    if "model" not in _AST_CACHE:
        import torch
        from transformers import AutoProcessor, ASTModel

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _AST_CACHE["device"] = device
        _AST_CACHE["processor"] = AutoProcessor.from_pretrained(_AST_MODEL_ID)
        _AST_CACHE["model"] = ASTModel.from_pretrained(_AST_MODEL_ID).to(device).eval()
    return _AST_CACHE["processor"], _AST_CACHE["model"], _AST_CACHE["device"]


def extract_neural_embedding(y: np.ndarray, sr: int) -> np.ndarray:
    """Return the 768-D AST embedding for one waveform."""
    import torch
    import librosa

    processor, model, device = _load_ast()
    y_16k = librosa.resample(y, orig_sr=sr, target_sr=16000) if sr != 16000 else y
    inputs = processor(y_16k, sampling_rate=16000, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    return torch.mean(outputs.last_hidden_state, dim=1).squeeze().cpu().numpy()


def load_snippet(path, seconds: float = 30.0, sr: int = SAMPLE_RATE):
    """Load a `seconds`-long clip from the MIDDLE of a track (skips misleading intros).

    Matches the MIR convention used by datasets like FMA/GTZAN. Returns (y, sr).
    """
    import librosa

    total = librosa.get_duration(path=str(path))
    offset = max(0.0, (total - seconds) / 2.0) if total > seconds else 0.0
    y, sr = librosa.load(str(path), sr=sr, offset=offset, duration=seconds)
    return y, sr


# ---------------------------------------------------------------------------
# 3. The frozen reference space (UMAP) — fit once, reuse forever
# ---------------------------------------------------------------------------
def _embedding_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c.startswith("dim_")]


def fit_reference_space(
    neural_csv: Path = NEURAL_CSV,
    artifact_dir: Path = ARTIFACT_DIR,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
) -> dict:
    """Fit StandardScaler + 3D UMAP on the corpus embeddings and freeze to disk.

    Unlike t-SNE, the saved UMAP reducer has a .transform(), so new songs can be
    placed into these exact coordinates later without refitting.
    """
    import joblib
    import umap
    from sklearn.preprocessing import StandardScaler

    df = pd.read_csv(neural_csv)
    dim_cols = _embedding_columns(df)
    X = df[dim_cols].values

    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)

    reducer = umap.UMAP(
        n_components=3, n_neighbors=n_neighbors, min_dist=min_dist,
        random_state=RANDOM_STATE,
    ).fit(X_scaled)

    # Use the actual fitted coordinates for the reference points. (reducer.transform
    # is only an *approximate* re-embedding and is reserved for brand-new songs.)
    df[["UX", "UY", "UZ"]] = reducer.embedding_

    artifact_dir = Path(artifact_dir)
    artifact_dir.mkdir(exist_ok=True)
    joblib.dump(scaler, artifact_dir / "scaler.joblib")
    joblib.dump(reducer, artifact_dir / "umap_reducer.joblib")
    joblib.dump(dim_cols, artifact_dir / "dim_cols.joblib")
    df.to_csv(artifact_dir / "reference_with_umap.csv", index=False)

    return {"reference_df": df, "scaler": scaler, "reducer": reducer}


def load_reference_space(artifact_dir: Path = ARTIFACT_DIR) -> dict:
    """Load the frozen scaler + UMAP reducer + reference coordinates."""
    import joblib

    artifact_dir = Path(artifact_dir)
    return {
        "scaler":  joblib.load(artifact_dir / "scaler.joblib"),
        "reducer": joblib.load(artifact_dir / "umap_reducer.joblib"),
        "dim_cols": joblib.load(artifact_dir / "dim_cols.joblib"),
        "reference_df": pd.read_csv(artifact_dir / "reference_with_umap.csv"),
    }


def project_embeddings(embeddings: np.ndarray, space: dict) -> np.ndarray:
    """Project new 768-D embeddings into the frozen 3D reference coordinates."""
    embeddings = np.atleast_2d(embeddings)
    X_scaled = space["scaler"].transform(embeddings)
    return space["reducer"].transform(X_scaled)


# ---------------------------------------------------------------------------
# 4. Taste type — the shareable, MBTI-style label (built from real features)
# ---------------------------------------------------------------------------
def assign_taste_type(features: dict, reference_stats: pd.DataFrame) -> str:
    """Turn interpretable features into a human label by comparing to the corpus.

    `reference_stats` is the interpretable dataframe; we compare a song (or a
    listener's average) to the corpus median on each axis. Honest and explainable.
    """
    med = reference_stats[INTERPRETABLE_FEATURES].median()

    bright = "Bright" if features["brightness_centroid"] >= med["brightness_centroid"] else "Warm"
    texture = "Percussive" if features["percussiveness_zcr"] >= med["percussiveness_zcr"] else "Smooth"
    dynamics = "Dynamic" if features["rms_variance"] >= med["rms_variance"] else "Steady"
    melody = "Melodic" if features["melody_to_drum_ratio"] >= med["melody_to_drum_ratio"] else "Beat-Driven"

    return f"{bright} · {texture} · {dynamics} · {melody}"


# ---------------------------------------------------------------------------
# 5. The reusable entry point: place new songs onto the frozen map
# ---------------------------------------------------------------------------
def place_audio_files(
    file_paths: list[str | Path],
    space: dict | None = None,
    interpretable_ref: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Given audio files, return their 3D coordinates on the frozen map + a taste type.

    This is the single function a Colab / website backend calls. It:
      1. extracts the AST embedding for each file,
      2. projects it into the frozen UMAP reference coordinates,
      3. computes interpretable features + a human-readable taste type,
      4. returns one tidy row per song.
    """
    import librosa

    if space is None:
        space = load_reference_space()
    if interpretable_ref is None and INTERPRETABLE_CSV.exists():
        interpretable_ref = pd.read_csv(INTERPRETABLE_CSV)

    rows = []
    for path in file_paths:
        path = Path(path)
        try:
            y, sr = librosa.load(path, sr=SAMPLE_RATE)
            embedding = extract_neural_embedding(y, sr)
            coord = project_embeddings(embedding, space)[0]
            feats = extract_interpretable_features(y, sr)
            taste = (assign_taste_type(feats, interpretable_ref)
                     if interpretable_ref is not None else None)
            rows.append({
                "Track": path.stem,
                "UX": coord[0], "UY": coord[1], "UZ": coord[2],
                "taste_type": taste,
                **feats,
            })
        except Exception as e:
            print(f"  ! failed on {path.name}: {e}")
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# 6. Presentation helpers (used by the Colab tool and the future web app)
# ---------------------------------------------------------------------------
def nearest_reference(placed: pd.DataFrame, reference_df: pd.DataFrame) -> pd.DataFrame:
    """For each placed song, find its nearest reference track on the frozen map."""
    ref_xyz = reference_df[["UX", "UY", "UZ"]].values
    out = []
    for _, row in placed.iterrows():
        d = np.linalg.norm(ref_xyz - np.array([row["UX"], row["UY"], row["UZ"]]), axis=1)
        j = int(np.argmin(d))
        out.append({
            "your_song": row["Track"],
            "nearest_reference": reference_df.iloc[j]["Track"],
            "i_marked_it": reference_df.iloc[j]["Preference"],
            "distance": float(d[j]),
        })
    return pd.DataFrame(out)


def build_overlay_map(reference_df: pd.DataFrame, placed: pd.DataFrame | None = None,
                      title: str = "Where your songs land on the Pulse map"):
    """3D map of the reference corpus with the user's songs overlaid (if provided)."""
    import plotly.graph_objects as go

    palette = {"Liked": "#00ffcc", "Disliked": "#ff3366"}
    fig = go.Figure()
    for pref, color in palette.items():
        sub = reference_df[reference_df["Preference"] == pref]
        fig.add_trace(go.Scatter3d(
            x=sub["UX"], y=sub["UY"], z=sub["UZ"], mode="markers",
            name=f"My {pref}", text=sub["Track"],
            marker=dict(size=4, color=color, opacity=0.45),
        ))
    if placed is not None and len(placed):
        fig.add_trace(go.Scatter3d(
            x=placed["UX"], y=placed["UY"], z=placed["UZ"], mode="markers",
            name="Your songs", text=placed["Track"],
            marker=dict(size=9, color="#ffd166", symbol="diamond",
                        line=dict(width=1, color="white")),
        ))
    fig.update_layout(template="plotly_dark", title=title,
                      margin=dict(l=0, r=0, b=0, t=40))
    return fig
