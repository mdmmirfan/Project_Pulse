# Project Pulse 🎧

**Mapping musical taste by how songs *sound* — not by how crowds behave.**

Project Pulse is an unsupervised audio-analysis pipeline that explores a simple
question: *can the real, acoustic reasons behind my musical taste be measured —
and visualised — directly from sound?* It turns 99 songs into a **768-dimensional
neural audio fingerprint**, projects them into an **interactive 3D map**, and makes
that map both **interpretable** (brightness, tempo, texture…) and **reusable**
(anyone can drop their own songs onto the same map).

![The sound map of taste](result%20assets/t-sne.png)

---

## Why I built this

Streaming recommenders (Spotify's Discover Weekly / AI DJ) lean heavily on
**collaborative filtering** — they learn from *collective listening behavior*
(co-listens, skips, saves). That works well for mainstream taste, but it carries
documented **popularity bias** and **cultural/country bias**: it under-serves
listeners whose taste spans languages and cultures, where co-listening data is thin
and skewed toward Western catalogs.

I listen across many cultures and languages, and the AI DJ kept missing. So instead
of asking *"what do similar people stream?"*, Project Pulse asks *"what does this song
actually sound like?"* and builds a taste-map from the audio itself.

## What I found (honestly)

This is a personal case study — **1 listener, 99 songs, Like/Dislike labels** — so the
findings are about me, not a universal claim.

- **My likes and dislikes overlap heavily in sound.** Blind clustering can't cleanly
  separate them (clusters ~57% pure; silhouette ≈ 0.11). There is no neat acoustic wall.
- **Sound predicts my taste ~68%** vs a ~50% baseline — meaningful, but far from total.
- **Simple features (~69%) did about as well as the deep 768-D embedding (~68%)** at
  separating like/dislike. The deep map's value isn't a higher score — it's the
  *structure* (neighborhoods) and the ability to place *any* new song.
- **My taste type:** `Warm · Smooth · Steady · Melodic`.

**Takeaway:** taste = sound **+** culture/language/context. Sound explains part of it,
not most of it. A recommender tuned for the mainstream crowd naturally struggles with
a cross-cultural listener.

> A hypothesis I *raise but do not prove* here: because these systems optimise for
> collective behavior, they may nudge listeners toward more generic, popular taste.
> Testing that would need many listeners — out of scope for this personal project.

## How it works

```
raw audio (.wav)
   │
   ├─ AST neural model ─────────►  768-D sound embedding   ─► UMAP ─► 3D "Sound Map"
   │
   └─ librosa features ─────────►  8 named features        ─────────► "Interpretable Map"
                                   (brightness, tempo, texture, dynamics, tonality…)
```

- **Sound Map** — the deep acoustic fingerprint (the "wow").
- **Interpretable Map** — the same songs on human-readable axes (the "aha").
- **Frozen reference space (UMAP)** — fit once and saved, so new songs can be projected
  into the *same* coordinates later. (This is why UMAP replaced t-SNE — t-SNE can't
  place new points.)

## See the maps

Open these in a browser (interactive, drag to rotate):

- `Project_Pulse_Sound_Map.html` — the deep sound map
- `Project_Pulse_Interpretable_Map.html` — the named-axis map

## Run it yourself

```bash
# 1. Create + activate a virtual environment, then install core deps
python3 -m venv pulse_env
source pulse_env/bin/activate
pip install -r requirements.txt

# 2. Register the kernel so Jupyter/VS Code can find it
python -m ipykernel install --user --name pulse_env --display-name "Python (pulse_env)"
```

Then open `pulse_pipeline.ipynb`, **select the "Python (pulse_env)" kernel**, and
Run All. It runs from the saved data in seconds — no audio processing required.

> To project *new* songs (the `place_audio_files` function) you also need the heavier
> audio engine: uncomment `librosa`, `torch`, `transformers` in `requirements.txt`.

## Repository structure

| Path | What it is |
|---|---|
| `pulse_pipeline.ipynb` | Main notebook — 7 sections, runs from saved data |
| `pulse_core.py` | Reusable engine (extract, embed, project, taste type) |
| `artifacts/` | Frozen reference space (scaler + UMAP + coordinates) |
| `project_pulse_neural_data.csv` | 99 songs × 768 AST dims + 3D coords |
| `project_pulse_interpretable_features.csv` | 99 songs × 8 named features |
| `Project_Pulse_*Map.html` | Interactive 3D maps |
| `result assets/` | Static charts from the analysis |

## Roadmap

- **v0 — analysis engine** ✅ clean notebook, frozen reusable map, honest findings.
- **v1 — "drop your songs" Colab** ⬜ a shareable, MBTI-style tool: paste songs, see
  where they land + your taste type, and fun discoveries ("same genre, opposite ends
  of the map").
- **v2 — web app** ⬜ a hosted site (Vercel + storage) where the map fills up over time
  and people compare. Add **map "lenses"** (genre vs sound vs texture) so you can see a
  song move between views.

## Honest limitations

- n = 1 listener, 99 songs — a personal case study, not a population claim.
- The AST model is itself Western-trained; this project does **not** de-bias it. The
  honest edge is that the space is defined by *sound* (not behavior) and anchored on a
  deliberately cross-cultural corpus.
- The "surface proxy" comparison is a clearly-labelled illustration — it is **not**
  Spotify's actual (proprietary) algorithm.

## References

- Dieleman & van den Oord, *Deep content-based music recommendation*, NIPS 2013.
- *Analyzing popularity/country bias in music recommenders*, arXiv:2408.11565.
- *Music for All: representational bias in music models*, NAACL Findings 2025.
- UK IPO, *Impact of algorithmically driven recommendation systems on music* (2023).
