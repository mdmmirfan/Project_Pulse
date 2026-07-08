// ===== Pulse — one map edition =====
const MIN_SONGS = 6;
const N_CLUSTERS = 11;
const GENRE_COLORS = {
  Electronic: "#22d3ee", Experimental: "#a78bfa", Folk: "#f59e0b",
  "Hip-Hop": "#ef4444", Instrumental: "#10b981", International: "#ec4899",
  Pop: "#f472b6", Rock: "#64748b",
};
const CLOUD_SIZE = 30;
const CLOUD_OPACITY = 0.055;

const state = {
  atlas: null,
  clusters: null,
  songs: [],
  nextId: 1,
  mappingCount: 0,
  modelWarmed: false,
  toggles: { atlas: true, labels: true },
  tab: "explore",
  aboutRendered: false,
  theme: localStorage.getItem("pulse-theme") || "dark",
};

const $ = (id) => document.getElementById(id);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const toast = (msg) => {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
};

function setMapping(delta, songName = "") {
  state.mappingCount = Math.max(0, state.mappingCount + delta);
  const on = state.mappingCount > 0;
  $("loaderAside")?.classList.toggle("hidden", !on);
  if ($("loaderSub")) {
    $("loaderSub").textContent = state.modelWarmed
      ? (songName ? `Listening to “${songName}”…` : "Mapping…")
      : "First song ~10s — warming up";
  }
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  $("themeToggle").textContent = state.theme === "dark" ? "☀️ Light" : "🌙 Dark";
  if (state.atlas) {
    renderMainMap();
    if (state.aboutRendered) renderAboutMap();
    renderPulseCard();
    renderMeaning();
  }
}
$("themeToggle").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("pulse-theme", state.theme);
  applyTheme();
};

function themeColors() {
  return state.theme === "dark"
    ? { font: "#9a96a8", grid: "rgba(255,255,255,0.07)", zero: "rgba(255,255,255,0.12)" }
    : { font: "#6b6678", grid: "rgba(20,20,30,0.1)", zero: "rgba(20,20,30,0.18)" };
}

function userColors() {
  return state.theme === "dark"
    ? { fill: "#ffffff", stroke: "rgba(180,220,255,0.95)", glow: "rgba(180,220,255,0.35)", line: "rgba(255,255,255,0.45)", text: "#ffffff", legend: "#ffffff" }
    : { fill: "#1a1030", stroke: "rgba(45,27,78,0.85)", glow: "rgba(139,92,246,0.35)", line: "rgba(45,27,78,0.35)", text: "#1c1830", legend: "#1a1030" };
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mstEdges(points) {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < n) {
    let best = null, bestD = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < n; j++) {
        if (inTree.has(j)) continue;
        const d = dist3(points[i], points[j]);
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
    }
    if (best) { edges.push(best); inTree.add(best[1]); }
  }
  return edges;
}

function geminiStarPath(cx, cy, cz, scale) {
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    const a2 = a + Math.PI / 4;
    xs.push(cx + Math.cos(a) * scale, cx + Math.cos(a2) * scale * 0.32);
    ys.push(cy + Math.sin(a) * scale, cy + Math.sin(a2) * scale * 0.32);
    zs.push(cz, cz);
  }
  xs.push(xs[0]); ys.push(ys[0]); zs.push(zs[0]);
  return { x: xs, y: ys, z: zs };
}

function drawGeminiStar(ctx, x, y, r, fill, glow) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    const a2 = a + Math.PI / 4;
    const ox = x + Math.cos(a) * r;
    const oy = y + Math.sin(a) * r;
    const ix = x + Math.cos(a2) * r * 0.32;
    const iy = y + Math.sin(a2) * r * 0.32;
    if (i === 0) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.shadowColor = glow;
  ctx.shadowBlur = r * 0.9;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = glow;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function cardTheme() {
  return state.theme === "dark"
    ? {
        topBg0: "#07070b", topBg1: "#120818", grid: "rgba(255,255,255,0.06)",
        bodyBg: "#14121f", bodyText: "#ece9f1", bodyDim: "#9a96a8",
        tick: "#ece9f1", track: "rgba(255,255,255,0.12)", meta: "rgba(255,255,255,0.72)",
      }
    : {
        topBg0: "#e8e2f0", topBg1: "#dce8ef", grid: "rgba(20,20,30,0.08)",
        bodyBg: "#faf8f4", bodyText: "#14121f", bodyDim: "#6b6678",
        tick: "#1a1030", track: "#e7e4ee", meta: "rgba(20,20,30,0.55)",
      };
}

function paintGrain(ctx, w, h, alpha = 0.08) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = (Math.random() * alpha * 255) | 0;
  }
  ctx.putImageData(img, 0, 0);
}

function catmullRomSpline(pts, segs = 10) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < segs; t++) {
      const u = t / segs;
      const u2 = u * u;
      const u3 = u2 * u;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function songSoundPts(placed) {
  return placed.map((s) => ({
    x: s.data.sound.x,
    y: s.data.sound.y,
    z: s.data.sound.z,
  }));
}

function projectSoundToCanvas(raw, w, h, pad = 24) {
  if (!raw.length) return [];
  let minX = Math.min(...raw.map((p) => p.x)), maxX = Math.max(...raw.map((p) => p.x));
  let minY = Math.min(...raw.map((p) => p.y)), maxY = Math.max(...raw.map((p) => p.y));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const minSpan = 0.12;
  if (maxX - minX < minSpan) { minX = cx - minSpan / 2; maxX = cx + minSpan / 2; }
  if (maxY - minY < minSpan) { minY = cy - minSpan / 2; maxY = cy + minSpan / 2; }
  return raw.map((p) => ({
    x: pad + ((p.x - minX) / (maxX - minX)) * (w - pad * 2),
    y: pad + ((1 - (p.y - minY) / (maxY - minY)) * (h - pad * 2)),
  }));
}

function constellationRoute(placed, w, h, pad = 24) {
  const n = placed.length;
  if (n === 0) return [];
  const raw = songSoundPts(placed);
  const canvasPts = projectSoundToCanvas(raw, w, h, pad);
  if (n === 1) return canvasPts;

  const cx = raw.reduce((s, p) => s + p.x, 0) / n;
  const cy = raw.reduce((s, p) => s + p.y, 0) / n;
  const edges = mstEdges(raw);
  const adj = Array.from({ length: n }, () => []);
  edges.forEach(([i, j]) => { adj[i].push(j); adj[j].push(i); });
  let start = 0, bestD = Infinity;
  raw.forEach((p, i) => {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    if (d < bestD) { bestD = d; start = i; }
  });
  const order = [];
  const seen = new Set();
  (function walk(u) {
    order.push(u);
    seen.add(u);
    adj[u].slice().sort((a, b) => {
      const da = (raw[a].x - raw[u].x) ** 2 + (raw[a].y - raw[u].y) ** 2;
      const db = (raw[b].x - raw[u].x) ** 2 + (raw[b].y - raw[u].y) ** 2;
      return da - db;
    }).forEach((v) => { if (!seen.has(v)) walk(v); });
  })(start);
  for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i);
  return order.map((i) => canvasPts[i]);
}

function drawDotGrid(ctx, w, h, color, step = 18) {
  ctx.fillStyle = color;
  for (let x = step; x < w; x += step) {
    for (let y = step; y < h; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawScanlines(ctx, w, h, alpha = 0.04) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

function drawMorphicRoute(ctx, pts, palette, mode = "stats") {
  if (pts.length < 2) return;
  const smooth = catmullRomSpline(pts, mode === "card" ? 16 : 12);
  const wobble = mode === "card" ? 2.4 : 1.1;
  const noisy = smooth.map((p, i) => ({
    x: p.x + Math.sin(i * 0.63) * wobble,
    y: p.y + Math.cos(i * 0.51) * wobble,
  }));
  const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts.at(-1).x, pts.at(-1).y);
  if (mode === "card") {
    grad.addColorStop(0, "#fdf2b3");
    grad.addColorStop(0.45, palette[0] || "#22d3ee");
    grad.addColorStop(0.75, palette[1] || "#8b5cf6");
    grad.addColorStop(1, palette[2] || "#ff4d8d");
  } else {
    palette.forEach((c, i) => grad.addColorStop(i / Math.max(1, palette.length - 1), c));
  }

  const layers = mode === "card"
    ? [[32, 0.22, 24], [16, 0.45, 14], [7, 0.78, 7], [3, 1, 0]]
    : [[7, 0.1, 10], [3, 0.28, 4], [1.2, 0.75, 0]];

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  layers.forEach(([width, alpha, blur]) => {
    ctx.save();
    ctx.shadowColor = (mode === "card" ? palette[1] : palette[0]) + "aa";
    ctx.shadowBlur = blur;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(noisy[0].x, noisy[0].y);
    for (let i = 1; i < noisy.length; i++) ctx.lineTo(noisy[i].x, noisy[i].y);
    ctx.stroke();
    ctx.restore();
  });
}

function cardConstellationEdges(raw, coords) {
  return mstEdges(raw).map(([i, j]) => {
    const a = coords[i], b = coords[j];
    return {
      a, b,
      mx: (a.x + b.x) / 2 + (a.y - b.y) * 0.06,
      my: (a.y + b.y) / 2 + (b.x - a.x) * 0.06,
    };
  });
}

function drawConstellationImage(ctx, placed, w, h, palette, theme) {
  const ct = cardTheme();
  const pad = 20;
  const raw = songSoundPts(placed);
  const coords = projectSoundToCanvas(raw, w, h, pad);
  const uc = userColors();

  const bg = ctx.createLinearGradient(0, 0, w, h * 0.9);
  if (theme === "dark") {
    bg.addColorStop(0, "#2a1845");
    bg.addColorStop(0.35, "#14121f");
    bg.addColorStop(1, "#07070b");
  } else {
    bg.addColorStop(0, "#f0c4a8");
    bg.addColorStop(0.5, "#e8dff0");
    bg.addColorStop(1, "#dce8ef");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  drawScanlines(ctx, w, h, theme === "dark" ? 0.04 : 0.02);
  drawDotGrid(ctx, w, h, ct.grid, 16);

  if (coords.length >= 2) {
    cardConstellationEdges(raw, coords).forEach(({ a, b, mx, my }) => {
      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.35)" : "rgba(26,16,48,0.28)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const route = constellationRoute(placed, w, h, pad);
    drawMorphicRoute(ctx, route, palette, "card");

    coords.forEach((c) => drawGeminiStar(ctx, c.x, c.y, 12, uc.fill, uc.glow));
  } else if (coords.length === 1) {
    drawGeminiStar(ctx, coords[0].x, coords[0].y, 14, uc.fill, uc.glow);
  }
}

const MAP_CAMERAS = {
  default: { eye: { x: 1.45, y: 1.45, z: 1.05 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  top: { eye: { x: 0.01, y: 0.01, z: 2.4 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  side: { eye: { x: 2.35, y: 0.15, z: 0.35 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  front: { eye: { x: 0.15, y: 2.35, z: 0.35 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
};

function setMapCamera(preset) {
  Plotly.relayout("mainPlot", { "scene.camera": MAP_CAMERAS[preset] || MAP_CAMERAS.default });
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
    $("tabExplore").classList.toggle("active", state.tab === "explore");
    $("tabAbout").classList.toggle("active", state.tab === "about");
    if (state.tab === "about" && !state.aboutRendered && state.atlas) {
      renderAboutMap();
      state.aboutRendered = true;
    }
  };
});

// ---------- clustering (sound space only) ----------
function xyz(p) {
  return [p.sound.x, p.sound.y, p.sound.z];
}

function kMeans(points, k) {
  k = Math.min(k, points.length);
  let centroids = points.slice(0, k).map(xyz);
  let assign = new Array(points.length).fill(0);
  for (let iter = 0; iter < 18; iter++) {
    for (let i = 0; i < points.length; i++) {
      const v = xyz(points[i]);
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = centroids[c].reduce((s, x, j) => s + (x - v[j]) ** 2, 0);
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const cnt = new Array(k).fill(0);
    for (let i = 0; i < points.length; i++) {
      const v = xyz(points[i]);
      const c = assign[i];
      cnt[c]++;
      sums[c] = sums[c].map((x, j) => x + v[j]);
    }
    for (let c = 0; c < k; c++) {
      if (cnt[c]) centroids[c] = sums[c].map((x) => x / cnt[c]);
    }
  }
  const clusters = Array.from({ length: k }, () => []);
  points.forEach((p, i) => clusters[assign[i]].push(p));
  return clusters.filter((cl) => cl.length > 0);
}

function genreBreakdown(pts) {
  const counts = {};
  pts.forEach((p) => { counts[p.genre] = (counts[p.genre] || 0) + 1; });
  const total = pts.length;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [dom, n] = sorted[0];
  const pct = Math.round((n / total) * 100);
  const rest = sorted.slice(1).map(([g, c]) => `${Math.round((c / total) * 100)}% ${g}`).join("<br>");
  return { dominant: dom, pct, rest };
}

function acousticProfile(pts, topN = 3) {
  const keys = state.atlas.feature_keys;
  const med = state.atlas.feat_medians;
  const poles = state.atlas.feature_poles;
  const avgs = {};
  keys.forEach((k) => {
    avgs[k] = pts.reduce((s, p) => s + p.feats[k], 0) / pts.length;
  });
  return keys.map((k) => ({
    label: avgs[k] >= med[k] ? poles[k].high : poles[k].low,
    dev: Math.abs(avgs[k] - med[k]),
  })).sort((a, b) => b.dev - a.dev).slice(0, topN).map((s) => cap(s.label)).join(" · ");
}

function clusterHover(pts) {
  const { dominant, pct, rest } = genreBreakdown(pts);
  const sounds = acousticProfile(pts);
  return `<b>${pct}% ${dominant}</b>${rest ? "<br>" + rest : ""}<br><br>Sounds: ${sounds}<extra></extra>`;
}

function buildClusters() {
  if (!state.atlas) return;
  state.clusters = kMeans(state.atlas.points, N_CLUSTERS);
}

function renderLegend() {
  if (!state.atlas) return;
  const uc = userColors();
  const items = state.atlas.genres.map((g) =>
    `<div class="legend-item"><span class="legend-swatch" style="background:${GENRE_COLORS[g]}"></span>${g}</div>`
  ).join("");
  $("mapLegend").innerHTML = items + `
    <div class="legend-item" style="margin-top:8px"><span class="legend-swatch legend-star" style="background:${uc.legend};box-shadow:0 0 8px ${uc.glow}"></span>Your constellation</div>`;
}

function cloudTraces() {
  const traces = [];
  if (!state.toggles.atlas || !state.clusters) return traces;

  state.clusters.forEach((pts) => {
    if (!pts.length) return;
    const { dominant } = genreBreakdown(pts);
    const color = GENRE_COLORS[dominant] || "#888";
    const hover = clusterHover(pts);

    traces.push({
      type: "scatter3d", mode: "markers",
      x: pts.map((p) => p.sound.x), y: pts.map((p) => p.sound.y), z: pts.map((p) => p.sound.z),
      marker: { size: CLOUD_SIZE, color, opacity: CLOUD_OPACITY, line: { width: 0 } },
      hovertemplate: hover, showlegend: false,
    });
    traces.push({
      type: "scatter3d", mode: "markers",
      x: pts.map((p) => p.sound.x), y: pts.map((p) => p.sound.y), z: pts.map((p) => p.sound.z),
      marker: { size: CLOUD_SIZE * 0.55, color, opacity: CLOUD_OPACITY * 1.7, line: { width: 0 } },
      hoverinfo: "skip", showlegend: false,
    });
    traces.push({
      type: "scatter3d", mode: "markers",
      x: pts.map((p) => p.sound.x), y: pts.map((p) => p.sound.y), z: pts.map((p) => p.sound.z),
      marker: { size: CLOUD_SIZE * 1.35, color, opacity: CLOUD_OPACITY * 0.45, line: { width: 0 } },
      hoverinfo: "skip", showlegend: false,
    });
  });
  return traces;
}

function constellationTraces() {
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  if (placed.length < 2) return [];
  const pts = placed.map((s) => ({ x: s.data.sound.x, y: s.data.sound.y, z: s.data.sound.z }));
  const uc = userColors();
  return mstEdges(pts).map(([i, j]) => {
    const a = pts[i], b = pts[j];
    const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.06;
    const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.06;
    const mz = (a.z + b.z) / 2;
    return {
      type: "scatter3d", mode: "lines",
      x: [a.x, mx, b.x], y: [a.y, my, b.y], z: [a.z, mz, b.z],
      line: { color: uc.line, width: 2, dash: "dot" },
      opacity: 0.75, hoverinfo: "skip", showlegend: false,
    };
  });
}

function userSongTraits(song) {
  const sig = song.data.signature;
  const top = [...sig].sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5)).slice(0, 3);
  return top.map((s) => cap(s.value >= 0.5 ? s.high : s.low)).join(" · ");
}

function userTraces() {
  const pts = state.songs.filter((s) => s.placed);
  if (!pts.length) return [];
  const uc = userColors();
  const traces = [];
  const scale = 0.045;

  traces.push({
    type: "scatter3d", mode: "markers", name: "Glow",
    x: pts.map((s) => s.data.sound.x), y: pts.map((s) => s.data.sound.y), z: pts.map((s) => s.data.sound.z),
    marker: { size: 18, color: uc.glow, opacity: 0.55, line: { width: 0 } },
    hoverinfo: "skip", showlegend: false,
  });

  pts.forEach((s) => {
    const { x, y, z } = s.data.sound;
    const star = geminiStarPath(x, y, z, scale);
    traces.push({
      type: "scatter3d", mode: "lines",
      x: star.x, y: star.y, z: star.z,
      line: { color: uc.stroke, width: 4 },
      hoverinfo: "skip", showlegend: false,
    });
    traces.push({
      type: "scatter3d", mode: "lines",
      x: star.x, y: star.y, z: star.z,
      line: { color: uc.fill, width: 2.5 },
      hoverinfo: "skip", showlegend: false,
    });
  });

  const hovers = pts.map((s) => {
    const store = s.hit.genre ? `Store label: ${esc(s.hit.genre)}<br>` : "";
    return `<b>${esc(s.data.name)}</b><br>${esc(s.data.artist)}<br>${store}Placed by audio<br>Sounds: ${userSongTraits(s)}<br>${esc(s.data.taste_type)}<extra></extra>`;
  });

  traces.push({
    type: "scatter3d",
    mode: state.toggles.labels ? "markers+text" : "markers",
    name: "Your songs",
    x: pts.map((s) => s.data.sound.x),
    y: pts.map((s) => s.data.sound.y),
    z: pts.map((s) => s.data.sound.z),
    text: pts.map((s) => s.data.name),
    textposition: "top center",
    textfont: { size: 10, color: uc.text },
    marker: { size: 4, color: uc.fill, opacity: 1, line: { width: 0 } },
    hovertemplate: hovers,
  });
  return traces;
}

function mainLayout() {
  const tc = themeColors();
  const ax = {
    showticklabels: false, showbackground: false,
    gridcolor: tc.grid, zerolinecolor: tc.zero, color: tc.font,
    showgrid: true, gridwidth: 1, nticks: 8,
  };
  return {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 0, r: 0, t: 8, b: 0 }, showlegend: false,
    uirevision: "pulse-map",
    scene: {
      xaxis: { ...ax, title: { text: "Sound →", font: { size: 10, color: tc.font } } },
      yaxis: { ...ax, title: { text: "↑ Sound", font: { size: 10, color: tc.font } } },
      zaxis: { ...ax, title: { text: "Depth ↕", font: { size: 10, color: tc.font } } },
      camera: { ...MAP_CAMERAS.default },
      aspectmode: "data",
      dragmode: "orbit",
    },
    font: { color: tc.font },
  };
}

function renderMainMap() {
  if (!state.atlas) return;
  renderLegend();
  Plotly.react("mainPlot", [...cloudTraces(), ...constellationTraces(), ...userTraces()], mainLayout(), {
    displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: "reset",
  });
}

function renderAboutMap() {
  if (!state.atlas) return;
  const byGenre = {};
  state.atlas.points.forEach((p) => { (byGenre[p.genre] ||= []).push(p); });
  const traces = state.atlas.genres.map((g) => {
    const pts = byGenre[g] || [];
    return {
      type: "scatter3d", mode: "markers", name: g,
      x: pts.map((p) => p.sound.x), y: pts.map((p) => p.sound.y), z: pts.map((p) => p.sound.z),
      marker: { size: 3.5, color: GENRE_COLORS[g] || "#888", opacity: 0.8 },
      text: pts.map((p) => `FMA #${p.id}`),
      hovertemplate: `<b>${g}</b><br>%{text}<br>Sounds: ${acousticProfile(pts, 2)}<extra></extra>`,
    };
  });
  const tc = themeColors();
  const ax = { showticklabels: false, title: "", showbackground: false,
    gridcolor: tc.grid, zerolinecolor: tc.zero, color: tc.font };
  Plotly.react("aboutPlot", traces, {
    paper_bgcolor: "rgba(0,0,0,0)", margin: { l: 0, r: 0, t: 24, b: 0 },
    showlegend: true,
    legend: { font: { size: 10, color: tc.font }, bgcolor: "rgba(0,0,0,0)" },
    scene: { xaxis: ax, yaxis: ax, zaxis: ax, camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } } },
    font: { color: tc.font },
  }, { displayModeBar: false, responsive: true });
}

// ---------- search ----------
let searchTimer = null;
$("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (!q) { $("dropdown").innerHTML = ""; return; }
  searchTimer = setTimeout(() => doSearch(q), 280);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) $("dropdown").innerHTML = "";
});

async function doSearch(q) {
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const { results } = await r.json();
    const dd = $("dropdown");
    if (!results.length) { dd.innerHTML = `<div class="row"><span class="meta"><span>No matches</span></span></div>`; return; }
    dd.innerHTML = results.map((s, i) => `
      <div class="row" data-i="${i}">
        <img src="${s.artwork}" onerror="this.style.visibility='hidden'"/>
        <span class="meta"><b>${esc(s.name)}</b><span>${esc(s.artist)} · ${esc(s.genre || "—")}</span></span>
      </div>`).join("");
    [...dd.querySelectorAll(".row")].forEach((row) => {
      if (row.dataset.i !== undefined) row.onclick = () => addSong(results[row.dataset.i]);
    });
  } catch { toast("Search failed"); }
}
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- songs ----------
async function addSong(hit) {
  $("dropdown").innerHTML = "";
  $("searchInput").value = "";
  const song = { id: state.nextId++, hit, placed: false, data: null };
  state.songs.push(song);
  renderSongList();
  setMapping(+1, hit.name);
  try {
    const r = await fetch("/api/place", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewUrl: hit.previewUrl, name: hit.name, artist: hit.artist, artwork: hit.artwork }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "place failed");
    song.data = await r.json();
    song.placed = true;
    state.modelWarmed = true;
    renderAll();
    toast(`Placed by sound`);
  } catch {
    state.songs = state.songs.filter((s) => s.id !== song.id);
    renderSongList();
    toast("Couldn't map that one — try another.");
  } finally {
    setMapping(-1);
  }
}

function deleteSong(id) {
  state.songs = state.songs.filter((s) => s.id !== id);
  renderAll();
  toast("Song removed");
}

function renderSongList() {
  const el = $("songList");
  const placed = state.songs.filter((s) => s.placed).length;
  const countEl = $("songCount");
  if (placed === 0) countEl.textContent = "";
  else if (placed < MIN_SONGS) countEl.textContent = `${placed} song${placed === 1 ? "" : "s"} · ${MIN_SONGS - placed} more for Pulse Card`;
  else countEl.textContent = `${placed} songs mapped`;
  countEl.classList.toggle("ready", placed >= MIN_SONGS);

  if (!state.songs.length) {
    el.innerHTML = `<div class="empty">Search above to add your first song.</div>`;
    return;
  }
  el.innerHTML = state.songs.map((s) => `
    <div class="song">
      <img src="${s.hit.artwork}" onerror="this.style.visibility='hidden'" alt=""/>
      <div class="info">
        <b>${esc(s.hit.name)}</b>
        <span>${esc(s.hit.artist)}</span>
        ${s.hit.genre ? `<span class="store-tag">Store: <em>${esc(s.hit.genre)}</em> · placed by audio</span>` : ""}
        ${s.placed ? `<span class="taste">${esc(s.data.taste_type)}</span>` : `<span><span class="loader"></span> mapping…</span>`}
      </div>
      <button class="song-del" title="Remove" data-del="${s.id}">×</button>
    </div>`).join("");
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); deleteSong(Number(btn.dataset.del)); };
  });
}

// ---------- pulse card ----------
const SIG_COLORS = ["#22d3ee", "#8b5cf6", "#ff4d8d", "#f59e0b", "#10b981", "#ec4899", "#a78bfa", "#00ffcc"];

function signaturePalette(sig) {
  const ranked = [...sig].sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5)).slice(0, 3);
  return ranked.map((s, i) => SIG_COLORS[i % SIG_COLORS.length]);
}

function projectSongCoords(placed, w, h, pad = 44) {
  return constellationRoute(placed, w, h, pad);
}

function renderSignatureArt() {
  const canvas = $("pcSignature");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const sig = aggregateSignature();
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  const ct = cardTheme();
  const palette = sig ? signaturePalette(sig) : ["#22d3ee", "#8b5cf6", "#ff4d8d"];

  ctx.clearRect(0, 0, w, h);

  if (placed.length >= 2) {
    drawConstellationImage(ctx, placed, w, h, palette, state.theme);
  } else if (placed.length === 1) {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, ct.topBg1);
    bg.addColorStop(1, ct.topBg0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    drawGeminiStar(ctx, w / 2, h / 2, 14, state.theme === "dark" ? "#fff" : "#1a1030", palette[0]);
    paintGrain(ctx, w, h, 0.05);
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, ct.topBg1);
    bg.addColorStop(1, ct.topBg0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    paintGrain(ctx, w, h, 0.05);
    ctx.fillStyle = ct.meta;
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("constellation appears with 2+ songs", w / 2, h / 2);
  }

  const topEl = canvas.closest(".pc-top");
  if (topEl) {
    topEl.style.background = state.theme === "dark"
      ? `linear-gradient(135deg, ${palette[0]}28, ${palette[1]}18, #07070b)`
      : `linear-gradient(135deg, #f0c4a8, ${palette[0]}22, #dce8ef)`;
  }
  document.querySelectorAll(".pc-year, .pc-id").forEach((el) => {
    el.style.color = state.theme === "dark" ? "rgba(255,255,255,0.72)" : "rgba(20,20,30,0.55)";
  });
}

function drawSignatureGlowCanvas(sig, palette) {
  const canvas = $("pcGlowCanvas");
  const wrap = $("pcRows");
  if (!canvas || !wrap || !sig || sig.length < 2) {
    if (canvas) canvas.style.display = "none";
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w < 10 || h < 10) return;
  canvas.style.display = "block";
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rows = [...wrap.querySelectorAll(".pc-row")];
  const track = rows[0]?.querySelector(".track");
  const trackLeft = track ? track.offsetLeft : 98;
  const trackW = track ? track.clientWidth : w - 178;
  const pts = sig.map((s, i) => {
    const row = rows[i];
    const y = row ? row.offsetTop + row.offsetHeight / 2 : ((i + 0.5) / sig.length) * h;
    return { x: trackLeft + trackW * s.value, y };
  });
  drawMorphicRoute(ctx, pts, palette, "stats");
  const uc = userColors();
  pts.forEach(({ x, y }) => drawGeminiStar(ctx, x, y, 4.5, uc.fill, uc.glow));
}

function assignPulseName(sig) {
  const g = (k) => sig.find((s) => s.key === k)?.value ?? 0.5;
  if (g("brightness_centroid") < 0.42 && g("percussiveness_zcr") < 0.42) return "Soothing Pulse";
  if (g("brightness_centroid") > 0.58 && g("percussiveness_zcr") > 0.58) return "Electric Pulse";
  if (g("brightness_centroid") > 0.58 && g("tempo_bpm") > 0.55) return "Radiant Pulse";
  if (g("percussiveness_zcr") > 0.58 && g("energy_gradient") > 0.55) return "Erratic Pulse";
  if (g("melody_to_drum_ratio") > 0.58 && g("percussiveness_zcr") < 0.5) return "Melodic Pulse";
  if (g("brightness_centroid") < 0.45 && g("chroma_variance") < 0.42) return "Drifting Pulse";
  if (g("rms_variance") < 0.42 && g("melody_to_drum_ratio") > 0.5) return "Gentle Pulse";
  return "Balanced Pulse";
}

function aggregateSignature() {
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  if (placed.length < MIN_SONGS) return null;
  return placed[0].data.signature.map((meta, idx) => ({
    ...meta,
    value: placed.reduce((sum, s) => sum + s.data.signature[idx].value, 0) / placed.length,
  }));
}

function renderPulseCard() {
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  const ct = cardTheme();
  $("pcId").textContent = placed.length >= MIN_SONGS ? `PULSE · ${placed.length}` : "PULSE";
  renderSignatureArt();
  const sig = aggregateSignature();
  const card = $("pulseCard");
  if (card) {
    card.style.setProperty("--pc-body-bg", ct.bodyBg);
    card.style.setProperty("--pc-body-text", ct.bodyText);
    card.style.setProperty("--pc-body-dim", ct.bodyDim);
    card.style.setProperty("--pc-tick", ct.tick);
    card.style.setProperty("--pc-track", ct.track);
  }
  if (!sig) {
    $("pcName").textContent = placed.length ? "Almost There" : "Add Songs";
    $("pcType").textContent = "signature unlocks at 6+ songs";
    $("pcRows").innerHTML = placed.length ? `<div class="pc-locked">Keep adding songs — your signature is forming.</div>` : "";
    const gc = $("pcGlowCanvas");
    if (gc) gc.style.display = "none";
    return;
  }
  $("pcName").textContent = assignPulseName(sig);
  $("pcType").textContent = "your acoustic signature";
  const palette = signaturePalette(sig);

  $("pcRows").innerHTML = sig.map((s, idx) => `
    <div class="pc-row" data-idx="${idx}">
      <span class="lab">${cap(s.low).toUpperCase()}</span>
      <span class="track"><span class="tick" style="left:${(s.value * 100).toFixed(0)}%"></span></span>
      <span class="hi">${cap(s.high).toUpperCase()}</span>
    </div>`).join("");

  requestAnimationFrame(() => drawSignatureGlowCanvas(sig, palette));
}

function std(vals) {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
}

function userInsight() {
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  if (placed.length < MIN_SONGS) return null;

  const storeGenres = new Set(placed.map((s) => s.hit.genre).filter(Boolean));
  const genreDiverse = storeGenres.size >= 3;
  const sx = placed.map((s) => s.data.sound.x);
  const sy = placed.map((s) => s.data.sound.y);
  const spread = std(sx) + std(sy);
  const atlasSpread = std(state.atlas.points.map((p) => p.sound.x)) * 2;
  const soundsSimilar = spread < atlasSpread * 0.35;
  const soundsVaried = spread > atlasSpread * 0.55;
  const genreSame = storeGenres.size <= 2;

  if (genreDiverse && soundsSimilar)
    return "Different store genres, but your songs <strong>cluster by sound</strong> — labels differ, acoustics agree.";
  if (genreSame && soundsVaried)
    return "Similar store labels, but your songs <strong>spread across the map</strong> — same shelf, different sounds.";
  if (genreDiverse && soundsVaried)
    return "Wide genre labels <strong>and</strong> wide acoustic spread — your taste doesn't sit in one box.";
  if (genreSame && soundsSimilar)
    return "Focused store genres with a <strong>tight acoustic cluster</strong>.";
  return "Your pattern is mixed — add more songs to sharpen it.";
}

function renderMeaning() {
  const placed = state.songs.filter((s) => s.placed && s.data?.sound);
  if (placed.length < MIN_SONGS) {
    const need = MIN_SONGS - placed.length;
    $("meaning").innerHTML = placed.length
      ? `<strong>${placed.length}</strong> song${placed.length === 1 ? "" : "s"} mapped. Add <strong>${need} more</strong> for your Pulse name and a plain-English read.`
      : `Add <strong>${MIN_SONGS} songs</strong> for your Pulse name (like "Soothing Pulse") and a summary of your pattern.`;
    return;
  }
  $("meaning").innerHTML = `You're a <strong>${assignPulseName(aggregateSignature())}</strong>. ${userInsight()}`;
}

function renderAll() {
  renderSongList();
  renderMainMap();
  renderPulseCard();
  renderMeaning();
}

document.querySelector("[data-dl]").onclick = () => {
  Plotly.downloadImage("mainPlot", { format: "png", width: 1400, height: 1000, filename: "pulse_map" });
};
$("downloadCard").onclick = () => {
  html2canvas($("pulseCard"), { backgroundColor: null, scale: 2 }).then((canvas) => {
    const a = document.createElement("a");
    a.download = "pulse_card.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  });
};

$("toggleAtlas").onclick = (e) => { state.toggles.atlas = !state.toggles.atlas; e.target.classList.toggle("active"); renderMainMap(); };
$("toggleLabels").onclick = (e) => { state.toggles.labels = !state.toggles.labels; e.target.classList.toggle("active"); renderMainMap(); };
document.querySelectorAll("[data-camera]").forEach((btn) => {
  btn.onclick = () => setMapCamera(btn.dataset.camera);
});

async function boot() {
  applyTheme();
  $("pcYear").textContent = new Date().getFullYear();
  try {
    const r = await fetch("/api/atlas");
    state.atlas = await r.json();
    buildClusters();
    renderAll();
  } catch {
    toast("Couldn't load the atlas — is the server running?");
  }
}
boot();
