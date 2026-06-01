// ===== Pulse frontend logic =====
const GENRE_COLORS = {
  Electronic: "#22d3ee", Experimental: "#a78bfa", Folk: "#f59e0b",
  "Hip-Hop": "#ef4444", Instrumental: "#10b981", International: "#ec4899",
  Pop: "#f472b6", Rock: "#64748b",
};
const ACCENT = "#ff4d8d";

const state = {
  atlas: null,
  songs: [],
  toggles: { atlas: true, me: false, labels: true },
  theme: localStorage.getItem("pulse-theme") || "dark",
};

const $ = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
};

// ---------- theme ----------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  $("themeToggle").textContent = state.theme === "dark" ? "☀️ Light" : "🌙 Dark";
  if (state.atlas) renderMaps();
}
$("themeToggle").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("pulse-theme", state.theme);
  applyTheme();
};

function themeColors() {
  return state.theme === "dark"
    ? { font: "#9a96a8", grid: "rgba(255,255,255,0.06)", zero: "rgba(255,255,255,0.12)" }
    : { font: "#6b6678", grid: "rgba(20,20,30,0.08)", zero: "rgba(20,20,30,0.16)" };
}

// ---------- maps ----------
function lensTraces(lens) {
  const traces = [];
  const tc = themeColors();

  if (state.toggles.atlas && state.atlas) {
    const byGenre = {};
    state.atlas.points.forEach((p) => {
      (byGenre[p.genre] ||= []).push(p[lens]);
    });
    for (const g of state.atlas.genres) {
      const pts = byGenre[g] || [];
      traces.push({
        type: "scatter3d", mode: "markers", name: g,
        x: pts.map((c) => c.x), y: pts.map((c) => c.y), z: pts.map((c) => c.z),
        marker: { size: 3, color: GENRE_COLORS[g] || "#888", opacity: 0.5 },
        hovertemplate: `<b>${g}</b><extra></extra>`,
      });
    }
  }

  if (state.toggles.me && state.atlas) {
    for (const pref of ["Liked", "Disliked"]) {
      const pts = state.atlas.reference_me.filter((r) => r.preference === pref);
      traces.push({
        type: "scatter3d", mode: "markers", name: `My ${pref}`,
        x: pts.map((r) => r[lens].x), y: pts.map((r) => r[lens].y), z: pts.map((r) => r[lens].z),
        marker: { size: 4, color: pref === "Liked" ? "#00ffcc" : "#ff3366", opacity: 0.45, symbol: "circle" },
        text: pts.map((r) => r.name),
        hovertemplate: `%{text}<br>(my ${pref})<extra></extra>`,
      });
    }
  }

  if (state.songs.length) {
    const pts = state.songs.filter((s) => s.placed);
    traces.push({
      type: "scatter3d", mode: state.toggles.labels ? "markers+text" : "markers",
      name: "Your songs",
      x: pts.map((s) => s.data[lens].x), y: pts.map((s) => s.data[lens].y), z: pts.map((s) => s.data[lens].z),
      text: pts.map((s) => s.data.name),
      textposition: "top center",
      textfont: { color: tc.font, size: 10 },
      marker: { size: 8, color: ACCENT, symbol: "diamond", opacity: 0.98,
                line: { color: "#fff", width: 1 } },
      hovertemplate: pts.map((s) => `<b>${s.data.name}</b><br>${s.data.artist}<br>${s.data.taste_type}<extra></extra>`),
    });
  }
  return traces;
}

function lensLayout() {
  const tc = themeColors();
  const ax = { showticklabels: false, title: "", showbackground: false,
               gridcolor: tc.grid, zerolinecolor: tc.zero, color: tc.font };
  return {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false,
    scene: { xaxis: ax, yaxis: ax, zaxis: ax,
             camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } } },
    font: { color: tc.font },
  };
}

function renderMaps() {
  const cfg = { displayModeBar: false, responsive: true };
  Plotly.react("soundPlot", lensTraces("sound"), lensLayout(), cfg);
  Plotly.react("featurePlot", lensTraces("feature"), lensLayout(), cfg);
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
        <span class="meta"><b>${esc(s.name)}</b><span>${esc(s.artist)} · ${esc(s.genre || "")}</span></span>
      </div>`).join("");
    [...dd.querySelectorAll(".row")].forEach((row) => {
      const i = row.dataset.i;
      if (i !== undefined) row.onclick = () => addSong(results[i]);
    });
  } catch (err) { toast("Search failed"); }
}
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- add / place a song ----------
async function addSong(hit) {
  $("dropdown").innerHTML = "";
  $("searchInput").value = "";
  const song = { hit, placed: false, data: null };
  state.songs.push(song);
  renderSongList();
  toast(`Mapping "${hit.name}"…`);
  try {
    const r = await fetch("/api/place", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewUrl: hit.previewUrl, name: hit.name, artist: hit.artist, artwork: hit.artwork }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "place failed");
    song.data = await r.json();
    song.placed = true;
    renderSongList(); renderMaps(); renderPulseCard(); renderMeaning();
    toast(`Placed: ${song.data.taste_type}`);
  } catch (err) {
    state.songs = state.songs.filter((s) => s !== song);
    renderSongList();
    toast("Couldn't map that one — try another.");
  }
}

function renderSongList() {
  const el = $("songList");
  if (!state.songs.length) {
    el.innerHTML = `<div class="empty">No songs yet — search above to drop your first one onto the map.</div>`;
    return;
  }
  el.innerHTML = state.songs.map((s) => `
    <div class="song">
      <img src="${s.hit.artwork}" onerror="this.style.visibility='hidden'"/>
      <div class="info">
        <b>${esc(s.hit.name)}</b>
        <span>${esc(s.hit.artist)}</span>
        ${s.placed ? `<span class="taste">${esc(s.data.taste_type)}</span>` : `<span><span class="loader"></span> mapping…</span>`}
      </div>
    </div>`).join("");
}

// ---------- pulse card ----------
function aggregateSignature() {
  const placed = state.songs.filter((s) => s.placed);
  if (!placed.length) return null;
  const keys = placed[0].data.signature.map((x) => x.key);
  return keys.map((k, idx) => {
    const meta = placed[0].data.signature[idx];
    const avg = placed.reduce((sum, s) => sum + s.data.signature[idx].value, 0) / placed.length;
    return { ...meta, value: avg };
  });
}

function renderPulseCard() {
  const sig = aggregateSignature();
  const placed = state.songs.filter((s) => s.placed);
  $("pcId").textContent = `PULSE.${String(placed.length).padStart(3, "0")}`;
  if (!sig) return;
  // dominant taste type (most common)
  const counts = {};
  placed.forEach((s) => (counts[s.data.taste_type] = (counts[s.data.taste_type] || 0) + 1));
  const taste = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  $("pcName").textContent = placed.length === 1 ? placed[0].data.name.slice(0, 22) : "YOUR PULSE";
  $("pcType").textContent = taste;
  $("pcRows").innerHTML = sig.map((s) => `
    <div class="pc-row">
      <span class="lab">${s.low}</span>
      <span class="track"><span class="tick" style="left:${(s.value * 100).toFixed(0)}%"></span></span>
      <span class="hi">${s.high}</span>
    </div>`).join("");
}

function renderMeaning() {
  const sig = aggregateSignature();
  if (!sig) return;
  const sorted = [...sig].sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5));
  const top = sorted.slice(0, 3).map((s) => {
    const pole = s.value >= 0.5 ? s.high : s.low;
    const strength = Math.abs(s.value - 0.5) > 0.3 ? "strongly" : "leans";
    return `<b style="color:var(--text)">${pole.toLowerCase()}</b> (${strength})`;
  });
  $("meaning").innerHTML = `Across your ${state.songs.filter(s=>s.placed).length} song(s), your sound ${top.join(", ")}.
    These are real measurements vs the 320-track atlas — turn on <b style="color:var(--text)">Compare with my taste</b>
    to see how you sit against my likes &amp; dislikes.`;
}

// ---------- downloads ----------
document.querySelectorAll("[data-dl]").forEach((b) => {
  b.onclick = () => {
    const id = b.dataset.dl;
    Plotly.downloadImage(id, { format: "png", width: 1200, height: 1000,
      filename: id === "soundPlot" ? "pulse_sound_lens" : "pulse_feature_lens" });
  };
});
$("downloadCard").onclick = () => {
  html2canvas($("pulseCard"), { backgroundColor: null, scale: 2 }).then((canvas) => {
    const a = document.createElement("a");
    a.download = "pulse_card.png"; a.href = canvas.toDataURL("image/png"); a.click();
  });
};

// ---------- toggles ----------
$("toggleAtlas").onclick = (e) => { state.toggles.atlas = !state.toggles.atlas; e.target.classList.toggle("active"); renderMaps(); };
$("toggleMe").onclick = (e) => { state.toggles.me = !state.toggles.me; e.target.classList.toggle("active"); renderMaps(); };
$("toggleLabels").onclick = (e) => { state.toggles.labels = !state.toggles.labels; e.target.classList.toggle("active"); renderMaps(); };

// ---------- boot ----------
async function boot() {
  applyTheme();
  $("pcYear").textContent = new Date().getFullYear();
  try {
    const r = await fetch("/api/atlas");
    state.atlas = await r.json();
    renderMaps();
  } catch (err) {
    toast("Couldn't load the atlas — is the server running?");
  }
}
boot();
