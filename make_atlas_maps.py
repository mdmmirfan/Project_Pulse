"""
make_atlas_maps.py — render LABELLED, interactive 3D Atlas maps from saved artifacts.

No GPU, no audio, no 20-minute rebuild. It loads the frozen atlas
(`atlas_artifacts/`), projects the 99 personal Liked/Disliked songs into the SAME
two lenses, and writes standalone .html files you can open by double-clicking.

The point of this script (vs the raw Colab plots): every dot now has a HOVER label —
song name / FMA id, its genre, your Like/Dislike, and its named acoustic features —
so the map is actually readable instead of abstract "math soup".

Run:  pulse_env/bin/python make_atlas_maps.py
"""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px

from pulse_core import INTERPRETABLE_FEATURES, FEATURE_LABELS

ROOT = Path(__file__).resolve().parent
ART = ROOT / "atlas_artifacts"

# A few of the most intuitive features to surface in the hover tooltip.
HOVER_FEATURES = [
    "brightness_centroid",
    "tempo_bpm",
    "percussiveness_zcr",
    "rms_variance",
    "melody_to_drum_ratio",
]


def _knn_place(new_scaled, ref_scaled, ref_coords, k=15):
    """Place new points at the inverse-distance-weighted centroid of their k nearest
    reference neighbours. A numba-free stand-in for umap.transform that's stable and
    good enough for an overlay (exact placement isn't the point here).
    """
    from sklearn.neighbors import NearestNeighbors

    k = min(k, len(ref_scaled))
    nn = NearestNeighbors(n_neighbors=k).fit(ref_scaled)
    dist, idx = nn.kneighbors(new_scaled)
    w = 1.0 / (dist + 1e-9)
    w /= w.sum(axis=1, keepdims=True)
    out = np.einsum("nk,nkc->nc", w, ref_coords[idx])
    return out


def _load_everything():
    atlas = pd.read_csv(ART / "atlas.csv")
    sound_scaler = joblib.load(ART / "sound_scaler.joblib")
    feat_scaler = joblib.load(ART / "feat_scaler.joblib")

    neural = pd.read_csv(ROOT / "project_pulse_neural_data.csv")
    interp = pd.read_csv(ROOT / "project_pulse_interpretable_features.csv")
    me = neural.merge(interp, on=["Track", "Preference"], how="inner")

    dim_cols = [c for c in atlas.columns if c.startswith("dim_")]

    # Sound lens: place the personal songs among the atlas tracks (scaled AST space).
    ref_sound = sound_scaler.transform(atlas[dim_cols].values)
    me_sound = sound_scaler.transform(me[dim_cols].values)
    me[["SX", "SY", "SZ"]] = _knn_place(
        me_sound, ref_sound, atlas[["SX", "SY", "SZ"]].values
    )

    # Feature lens: same idea in the named-feature space.
    ref_feat = feat_scaler.transform(atlas[INTERPRETABLE_FEATURES].values)
    me_feat = feat_scaler.transform(me[INTERPRETABLE_FEATURES].values)
    me[["FX", "FY", "FZ"]] = _knn_place(
        me_feat, ref_feat, atlas[["FX", "FY", "FZ"]].values
    )
    return atlas, me


def _hover_block(df: pd.DataFrame):
    """Build customdata + a hovertemplate showing the named acoustic features."""
    customdata = df[HOVER_FEATURES].values
    lines = ["<b>%{text}</b>"]
    for i, feat in enumerate(HOVER_FEATURES):
        lines.append(f"{FEATURE_LABELS[feat]}: %{{customdata[{i}]:.2f}}")
    template = "<br>".join(lines) + "<extra></extra>"
    return customdata, template


def _make_map(atlas, me, xcol, ycol, zcol, title, out_path):
    genres = sorted(atlas["genre"].unique())
    palette = px.colors.qualitative.Set2 + px.colors.qualitative.Set1
    color_for = {g: palette[i % len(palette)] for i, g in enumerate(genres)}

    fig = go.Figure()

    # Atlas dots, one trace per genre (so the legend lets you toggle genres).
    for g in genres:
        sub = atlas[atlas["genre"] == g]
        cdata, template = _hover_block(sub)
        fig.add_trace(go.Scatter3d(
            x=sub[xcol], y=sub[ycol], z=sub[zcol], mode="markers",
            name=g,
            text=[f"FMA #{int(t)} · {g}" for t in sub["track_id"]],
            customdata=cdata, hovertemplate=template,
            marker=dict(size=3.5, color=color_for[g], opacity=0.65),
        ))

    # Personal songs overlaid as big diamonds (the part you care about labelling).
    pref_color = {"Liked": "#00ffcc", "Disliked": "#ff3366"}
    for pref, color in pref_color.items():
        sub = me[me["Preference"] == pref]
        if not len(sub):
            continue
        cdata, template = _hover_block(sub)
        fig.add_trace(go.Scatter3d(
            x=sub[xcol], y=sub[ycol], z=sub[zcol], mode="markers",
            name=f"\u2605 My {pref}",
            text=[f"{t}  (you: {pref})" for t in sub["Track"]],
            customdata=cdata, hovertemplate=template,
            marker=dict(size=7, color=color, symbol="diamond",
                        line=dict(width=1, color="white"), opacity=0.95),
        ))

    fig.update_layout(
        template="plotly_dark", title=title,
        margin=dict(l=0, r=0, b=0, t=50),
        legend=dict(itemsizing="constant"),
    )
    fig.write_html(out_path, include_plotlyjs="cdn")
    print(f"  wrote {out_path.name}  ({out_path.stat().st_size // 1024} KB)")


def main():
    atlas, me = _load_everything()
    print(f"Atlas: {len(atlas)} FMA tracks across {atlas['genre'].nunique()} genres.")
    print(f"Personal overlay: {len(me)} songs "
          f"({(me['Preference'] == 'Liked').sum()} liked / "
          f"{(me['Preference'] == 'Disliked').sum()} disliked).")

    _make_map(
        atlas, me, "SX", "SY", "SZ",
        "The Music Atlas \u2014 SOUND lens (AST embedding). Colour = genre; \u2605 = my taste. "
        "Hover any dot for its named features.",
        ROOT / "Project_Pulse_Atlas_Sound_Map.html",
    )
    _make_map(
        atlas, me, "FX", "FY", "FZ",
        "The Music Atlas \u2014 FEATURE lens (brightness/tempo/texture). Colour = genre; "
        "\u2605 = my taste. Hover any dot for its named features.",
        ROOT / "Project_Pulse_Atlas_Feature_Map.html",
    )
    print("Done. Open the two .html files in your browser (drag to rotate).")


if __name__ == "__main__":
    main()
