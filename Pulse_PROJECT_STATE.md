# Project Pulse — Working State / Handoff Note

> Purpose: lets a fresh chat (or future-me) resume instantly. In a new conversation,
> say: **"Read PROJECT_STATE.md and let's continue."**

## ▶️ START HERE NEXT SESSION
**Goal: nail the Pulse Card header image, then deploy (or playlist input).**
1. **Pulse Card header** — user still not happy with the top “constellation image.” Stats
   section is closer (morphic glow path, Gemini stars, uppercase labels) but header needs
   another pass — aim for reference specimen / Strava-route aesthetic (see assets in
   `.cursor/.../assets/`). Code: `renderSignatureArt()` / `drawConstellationImage()` in
   `web/frontend/app.js`.
2. **Still open polish:** true KDE/grain heatmap on map, mock public gallery, playlist import.
3. **Deploy** when ready: frontend → Vercel, backend → HuggingFace Spaces (free CPU).
   GitHub repo exists but user **disconnected GitHub locally** (2026-06-07) for other
   research — push/deploy when ready; not blocking local dev.
4. **Optional Phase 1b:** Spotify playlist read → iTunes preview per track.
5. **Still open:** rotate Genius API key on genius.com if lyrics features are used again.

> **Run the local site:** from project root:
> `pulse_env/bin/uvicorn web.backend.server:app --port 8000` → open http://localhost:8000
> **Stop it:** `pkill -f "uvicorn web.backend.server"` (or Ctrl+C in the terminal).
> Site only works while the server is running; localhost = your machine only until deployed.


## What this project is
An unsupervised audio-analysis pipeline that maps my musical taste by **how songs
sound** (deep acoustic features), not by listening behavior/metadata the way Spotify
does. Culminates in an interactive 3D map of a 768-D neural audio embedding (AST),
made **interpretable** (named features) and **reusable** (others can drop songs onto
the same frozen map).

Honest scope: personal case study — 1 listener, 99 songs, Like/Dislike labels. The AST
model is itself Western-trained; we do NOT claim to de-bias it. Our honest edge: the
space is defined by *sound* not *behavior*, with a deliberately cross-cultural corpus.

## Key files
| File | What it is |
|---|---|
| `pulse_pipeline.ipynb` | Main notebook, 7 sections + disabled appendix. Runs from saved data in seconds. |
| `pulse_core.py` | The reusable engine (all real functions live here). |
| `project_pulse_neural_data.csv` | 99 songs × 768 AST dims + original t-SNE X/Y/Z. |
| `project_pulse_interpretable_features.csv` | 99 songs × 8 named features. |
| `artifacts/` | Frozen reference space: `scaler.joblib`, `umap_reducer.joblib`, `dim_cols.joblib`, `reference_with_umap.csv`. |
| `Project_Pulse_Sound_Map.html` | Interactive 3D AST→UMAP map. |
| `Project_Pulse_Interpretable_Map.html` | Interactive 3D named-axis map. |
| `README.md` | Portfolio README (story, findings, how-to-run, roadmap). |
| `requirements.txt` | Core deps; heavy audio deps commented. |
| `.gitignore`, `.env.example` | Repo hygiene + key template. |
| `data/cluster_a_love/`, `data/cluster_b_dislike/` | The 99 source `.wav` files. |
| `atlas_artifacts/` | Frozen Music Atlas (sound+feature UMAP reducers/scalers + `atlas.csv`, 320 FMA tracks). |
| `make_atlas_maps.py` | Renders labelled standalone Atlas HTML maps from `atlas_artifacts/` (~2s, no rebuild). |
| `Project_Pulse_Atlas_*Map.html` | Labelled interactive Atlas maps (Sound + Feature lenses). |
| `web/` | **Pulse web app** — FastAPI backend + frontend SPA. See WEB APP section. |
| `web/README.md` | How to run the local site. |

## Environment
- venv: `pulse_env/` (Python 3.13). Has pandas, numpy, librosa, torch, transformers,
  scikit-learn, plotly, seaborn, umap-learn, joblib, ipykernel.
- Jupyter kernel registered as **"Python (pulse_env)"** — select it in the notebook
  kernel picker (top-right). Running on system Python causes `No module named 'plotly'`.

## Engine API (`pulse_core.py`)
- `build_interpretable_dataset()` — extract 8 named features from audio → CSV (~17 min).
- `extract_neural_embedding(y, sr)` — 768-D AST embedding (lazy-loads model).
- `fit_reference_space()` — fit + freeze StandardScaler + 3D UMAP to `artifacts/`.
- `load_reference_space()` — load frozen scaler/reducer/coords.
- `project_embeddings(emb, space)` — place new embeddings into frozen coords.
- `place_audio_files(paths, space, interpretable_ref)` — **the reusable entry point**:
  audio → embedding → 3D coords + taste type. (Validated end-to-end.)
- `assign_taste_type(features, ref)` — human-readable label.

## Honest findings (do NOT spin these)
- **Likes/Dislikes overlap heavily in sound.** Blind K-Means clusters are only ~57%
  pure; silhouette ≈ 0.11. No clean acoustic wall between like/dislike.
- **Taste predictability from sound ≈ 68%** vs ~51% baseline — real but modest signal.
- **Shallow features (~69%) ≈ deep 768-D (~68%)** for separability. Deep map's value is
  STRUCTURE + ability to place any new song, not a higher score. (Small-n caveat noted.)
- **My taste type:** `Warm · Smooth · Steady · Melodic`.
- Takeaway: taste = sound **+** culture/language/context. Sound explains part, not most.

## Spotify context (verified, with citations in chat)
Spotify blends collaborative filtering (behavior) + NLP + audio CNNs, mixed by BaRT.
The audio CNN is trained to predict the *behavior* latent factors (Dieleman & van den
Oord, NIPS 2013), mainly to solve cold-start. Recommenders show documented popularity
+ cultural/country bias (arXiv:2408.11565). Spotify `audio-features` API deprecated for
new apps (Nov 2024). We compare a clearly-labeled *surface proxy* vs deep sound — never
claim it IS Spotify's model.

## Decisions locked
- Projection: **UMAP** (not t-SNE) — needed so new songs project into a frozen space.
- Spotify overlap comparison: **option (a)** proxy-vs-soundspace, honestly labeled.
- Maps: **both** AST (hero) + interpretable (named axes).
- Hard rule: **simple, clean, honest — no overpromising or faking how Spotify works.**

## PIVOT (2026-05-31) — public tool decoupled from personal taste
- **Problem:** mapping strangers' songs relative to a personal n=1 taste map isn't
  compelling/authoritative. So the public-facing thing must use **generic, grounded
  labels**, not "my likes."
- **New framing:** the personal Like/Dislike work = the **origin story / motivation**
  (taste is multi-factor & finicky). The public product = **"The Music Atlas"**: an
  open, genre-grounded map viewed through multiple **lenses**.
- **Lenses (agreed):** Genre (colour) + Sound (AST→UMAP) + Feature (brightness/tempo/
  texture→UMAP). The "aha" = a genre scatters across the sound map (genre ≠ sound).
- **Grounding dataset (agreed):** **FMA (Free Music Archive)**, `fma_small` — 8 genres,
  30s clips, CC-licensed/redistributable. Use a **balanced SUBSET** (N per genre).
- **Snippets (agreed):** 30-second clips from the MIDDLE of each track (MIR standard;
  ~10x faster than full-song). Added `pulse_core.load_snippet()`.
- **Demo overlay (agreed):** project the 99 personal songs into the atlas via the same
  fitted lenses (uses saved CSV embeddings; full-vs-30s caveat noted).
- **Prior art (honest):** *Every Noise at Once* (Glenn McDonald, Spotify/Echo Nest) maps
  GENRES by sound. Our differentiator: open-source, song-level drop-in, multi-lens,
  reproducible, cross-cultural emphasis. Don't claim total novelty.
- **Honest limit:** FMA itself skews Western/indie/electronic — not a complete global
  picture. That bias is part of the story.
- **Engine upgrades:** AST is now GPU-aware (`_load_ast` uses cuda if available).

## Progress
- **v0 — analysis engine:** ✅ done (clean notebook, frozen UMAP map, honest findings).
- **(a) README + repo cleanup:** ✅ done — README.md, requirements.txt, .gitignore,
  .env.example written; Genius token scrubbed from backup; interpretable map exported
  to HTML.
- **(b) Colab "drop your songs" tool:** ✅ BUILT — `Project_Pulse_Colab.ipynb`.
  Installs deps, clones repo, loads frozen map, user uploads audio or pastes YouTube
  links, places songs via `place_audio_files`, shows overlay map + taste type + reveals
  (nearest reference song, your two closest songs). Engine helpers added to pulse_core:
  `nearest_reference()`, `build_overlay_map()`. Validated end-to-end locally.
  ⚠ ACTION NEEDED: set `REPO_URL` in the Colab to the real GitHub repo AFTER publishing,
  and verify the pinned versions let the UMAP pickle load on Colab (if not, may need a
  re-fit fallback).
- **Atlas Colab:** ✅ BUILT + ✅ RAN FOR REAL (2026-05-31). `Project_Pulse_Atlas_Colab.ipynb`
  ran on Colab GPU: 8 genres × 40 = 320 FMA tracks, AST + interpretable features on 30s
  clips, fit Sound + Feature UMAP lenses, overlaid the 99 personal songs. First real
  Atlas build succeeded. `REPO_URL` already set to mdmmirfan/Project_Pulse.
  HOW TO RUN: colab.research.google.com → File → Open notebook → GitHub → mdmmirfan/
  Project_Pulse → Run all (GPU runtime).
- **Atlas artifacts:** ✅ SAVED + committed to `atlas_artifacts/` (sound+feature
  scaler/reducer joblibs + `atlas.csv` with both lenses' coords). The expensive build
  is now frozen + reproducible; no need to rebuild.
- **Labelled Atlas maps:** ✅ `make_atlas_maps.py` renders standalone interactive HTML
  from `atlas_artifacts/` (NO GPU/rebuild): `Project_Pulse_Atlas_Sound_Map.html` +
  `Project_Pulse_Atlas_Feature_Map.html`. Every dot has a HOVER label (song/FMA id +
  genre + Like/Dislike + named features). Run: `pulse_env/bin/python make_atlas_maps.py`.
  ⚠ LOCAL NUMBA CAVEAT: pulse_env's numba 0.65.1 + numpy 2.4 won't JIT on Python 3.13,
  so `umap.reducer.transform()` crashes locally. Workaround used in make_atlas_maps.py:
  place the 99 personal songs via inverse-distance-weighted kNN among the atlas tracks
  (sklearn, numba-free) — an approximate overlay, honestly noted. The canonical
  reducer.transform path still works fine on Colab.

- **(c) Web app — PHASE 1 LOCAL PROTOTYPE:** ✅ BUILT + user-tested (2026-05-31). See
  WEB APP section below. User loves the iTunes Search API flow (autocomplete + previews).
  Feedback notes pending for next polish pass.

## GitHub + repo (2026-05-31, updated 2026-06-07)
- **Public repo:** https://github.com/mdmmirfan/Project_Pulse (branch `main`) — may be
  ahead/behind local; user disconnected GitHub from local workflow for other research.
- Local changes in `web/` (frontend polish) may be **uncommitted** — check `git status` before push.
- Gitignored (not committed): pulse_env/, data/ audio, .env, cookies.txt, *.pkg, zip.

## WEB APP — "Pulse" (Phase 1 plan, design locked 2026-05-31)
**One-liner:** a free site where anyone adds songs (search by name, or later a playlist),
sees them plotted in BOTH lenses (Sound + Feature) side by side, reads what their pattern
means, compares to a reference, and downloads a shareable **Pulse Card**.

### Architecture (the key constraint)
The site is TWO pieces because AST needs torch (too heavy for browser / Vercel serverless):
- **Frontend** (pages, maps, card): local for dev → **Vercel free "Hobby" tier** in prod.
  Vercel = free, sign up with GitHub, NOT template-locked (full free reign), auto-deploys
  from a connected GitHub repo on push.
- **ML backend** (30s clip → AST embedding + interpretable features → project onto atlas):
  local **FastAPI in pulse_env** for dev → **HuggingFace Spaces free CPU** in prod.
  AST on a 30s clip is a few seconds on CPU = feasible free. Loads `atlas_artifacts/`.
  Projection uses the **numba-free kNN placement** (see make_atlas_maps.py) so it's robust.

### Audio + search source (DECIDED)
- **iTunes Search API** (FREE, no key, still active) powers BOTH the type-a-name
  autocomplete dropdown AND the 30-second preview clip we feed to AST. This is the core.
  Caveat: ~20 req/min/IP (proxy + cache via backend); coverage broad but not 100%.
- **Apple Music API / MusicKit** (read an Apple Music *playlist*) needs a PAID Apple dev
  account ($99/yr) → NOT free → out of scope for Phase 1.
- **Spotify playlist**: reading tracks is free (free Spotify dev app, client-credentials);
  Spotify's own 30s preview is largely deprecated, so match track names → iTunes preview.
  → This is the only viable FREE playlist path = **Phase 1b**.
- **YouTube link**: yt-dlp works but YouTube blocks server IPs / ToS-gray → fragile,
  secondary/best-effort only.

### Phase 1 scope (free, achievable)
- Add songs by name (iTunes autocomplete), one-by-one or several at once.
- Plot in BOTH lenses side by side, interactive on site.
- Plain-English explanations of each map + "what your pattern says about you"
  (reuse `assign_taste_type`).
- Compare your pattern vs a reference = for now MY Liked-songs pattern (we have it).
- Download: each lens as an image + a combined **Pulse Card** (both patterns, 2 colours).
- Dark / light mode.
- MOCK public gallery (fake cards) to show the vision.

### Phase 2 (needs storage)
- Real public gallery: user-chosen usernames + saved cards → **Supabase free tier**.
- Playlist import (Spotify-read → iTunes-preview).

### Aesthetic direction (from user's reference images, saved in
`.cursor/.../assets/`)
- **Pulse Card** = "specimen card" style (ref img 5): abstract shape on a colour gradient
  (generated from sound fingerprint) + made-up name/username + 8-feature stat table with
  tick-slider marks.
- **Feature lens** = bipolar-axis "glowing path" (ref img 2) — our 8 features are already
  bipolar (Warm↔Bright, Smooth↔Percussive, Steady↔Dynamic, Beat-driven↔Melodic, …).
- **2D map / density** = soft grainy KDE heatmap, dotted grid, labelled axes (ref img 3).
- **Compare** = translucent overlapping shapes / radial (ref img 4).
- **Public gallery + per-card dot arrangement** = constellation/star-map (ref img 1),
  i.e. the user's "astrology sign" idea.
- Sharing: NO direct-from-site share needed; users screenshot / download the card/image.

### Build order
1. ✅ DONE — LOCAL prototype BUILT + validated end-to-end (2026-05-31), in `web/`:
   - `web/backend/engine.py` (load atlas, iTunes search, AST embed + features, kNN place,
     taste type, reference overlay) + `web/backend/server.py` (FastAPI: /api/atlas,
     /api/search, /api/place, serves the frontend).
   - `web/frontend/` (index.html + styles.css + app.js): polished SPA, dark/light mode,
     Plotly two-lens maps with the genre atlas cloud, YouTube-style autocomplete, song
     list w/ taste type, specimen-style **Pulse Card** (bipolar signature sliders),
     compare-with-my-taste toggle, image/card downloads.
   - RUN: `pulse_env/bin/uvicorn web.backend.server:app --port 8000` → http://localhost:8000
   - Needs ffmpeg (present) for .m4a previews; AST model cached locally.
   - Verified in browser: searched + placed real songs (e.g. Bohemian Rhapsody → "Warm ·
     Smooth · Steady · Melodic"), both lenses + Pulse Card render, dark+light both work.
   - Added deps to pulse_env: fastapi, uvicorn[standard]. See `web/requirements.txt`.
   - User tested locally (2026-05-31 evening): loved iTunes autocomplete; will send
     written notes next session for polish.
2. ✅ **User feedback polish (2026-06-01 → 2026-06-07)** — mostly done; Pulse Card header TBD:
   Round 1 (done): add/delete songs, 2D clouds, side legends, About tab, loading, split compare,
   gradient logo, constellation card, 6-song minimum.
   Round 2 — **ONE MAP simplification** (user-approved):
   - Single 3D interactive sound map (removed dual Sound/Feature lens UI)
   - Genre-coloured regional clouds; hover = genre mix + acoustic profile
   - Removed compare vs avg liked/disliked toggles entirely
   - About tab = raw point map + FMA/Spotify honesty
   Round 3 (2026-06-07) — **constellation + card + UX** (session with user):
   - ✅ 3D map: user songs = **Gemini star** markers (theme-aware: white/dark)
   - ✅ 3D map: **MST constellation connections** (dashed curved lines between songs)
   - ✅ Map nav: Reset / Top / Side / Front chips; `aspectmode: data`; double-click reset
   - ✅ Loader: compact ring **beside legend** (not full-map overlay)
   - ✅ Pulse Card stats: morphic glow path through 8 bipolar sliders; **uppercase** both poles
   - ✅ Pulse Card stats: Gemini **stars** on sliders (not squares)
   - ✅ Pulse Card header: static canvas constellation (MST edges + route + stars) — **works
     but user wants better art; revisit next session**
   - ⬜ Still TODO: Pulse Card header aesthetic (user), KDE/grain heatmap, mock gallery,
     playlist import, deploy

   **User confusion documented (teach in UI, don't implement wrong):**
   - Sound map ≠ Spotify behaviour. Spotify = collaborative filtering (crowd streams).
     Pulse Sound = AST neural fingerprint of actual audio. Close = sounds alike.
   - Atlas = FMA research dataset (Western skew acknowledged in About tab).
3. ⬜ Deploy: backend → HF Spaces, frontend → Vercel.
4. ⬜ Phase 2: Supabase storage → gallery + usernames + playlist import (Spotify→iTunes).

### Open / not-yet-decided
- Frontend stack: plain static HTML+JS for the prototype, likely **Next.js** for the
  polished Vercel app (TBD — confirm with user).
- HF Spaces cold-start latency + iTunes preview coverage to be validated in step 1.

## Still TODO before publishing publicly
- **Rotate the Genius key on genius.com** — it was exposed earlier, so scrubbing the
  file isn't enough; generate a new token if lyrics features are used again.
- Confirm `node-v24.15.0.pkg` (91 MB) and `cookies.txt` are not committed (gitignored).
