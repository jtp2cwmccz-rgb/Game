/* ============================================================
   DAILY BUDDY BATTLES — lógica de la app
   ============================================================ */

'use strict';

/* ---------- utilidades ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function todayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function gameForDate(dateKey) {
  return GAMES[hashSeed('rotation:' + dateKey) % GAMES.length];
}

function dailyRng(dateKey, salt = '') {
  return mulberry32(hashSeed('ddb:' + dateKey + ':' + salt));
}

function fmtDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------- estado persistente ---------- */
const STORE_KEY = 'ddb-state-v1';

const DEFAULT_STATE = {
  profile: { name: 'Jugador', avatar: '🦊' },
  results: {},      // dateKey -> { gameId, score, detail, at }
  friends: {},      // dateKey -> [ { name, avatar, score } ]
  duels: [],        // { date, gameId, me, foe, myScore, foeScore }
  badges: [],       // ids ganados
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...structuredClone(DEFAULT_STATE), ...parsed, profile: { ...DEFAULT_STATE.profile, ...(parsed.profile || {}) } };
    }
  } catch (e) { /* estado corrupto: empezar de cero */ }
  return structuredClone(DEFAULT_STATE);
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* ---------- racha ---------- */
function currentStreak() {
  let streak = 0;
  for (let i = 0; ; i++) {
    const key = todayKey(-i);
    if (state.results[key]) streak++;
    else if (i === 0) continue; // hoy aún sin jugar no rompe la racha
    else break;
  }
  return streak;
}

/* ---------- insignias ---------- */
const BADGES = [
  { id: 'first',   icon: '🎮', name: 'Primer reto',   test: (s) => Object.keys(s.results).length >= 1 },
  { id: 'streak3', icon: '🔥', name: 'Racha ×3',      test: () => currentStreak() >= 3 },
  { id: 'streak7', icon: '🌋', name: 'Racha ×7',      test: () => currentStreak() >= 7 },
  { id: 'duelist', icon: '⚔️', name: '5 duelos',      test: (s) => s.duels.length >= 5 },
  { id: 'champ',   icon: '🏆', name: '3 victorias',   test: (s) => s.duels.filter(d => d.myScore > d.foeScore).length >= 3 },
  { id: 'points',  icon: '💎', name: '10K puntos',    test: (s) => totalPoints(s) >= 10000 },
];

function totalPoints(s) {
  return Object.values(s.results).reduce((a, r) => a + r.score, 0);
}

function checkBadges() {
  for (const b of BADGES) {
    if (!state.badges.includes(b.id) && b.test(state)) {
      state.badges.push(b.id);
      toast(`🏅 Insignia desbloqueada: ${b.name}`);
    }
  }
  saveState();
}

/* ---------- navegación ---------- */
const VIEWS = ['home', 'duel', 'rank', 'profile'];

function goto(view) {
  VIEWS.forEach(v => $(`#view-${v}`).classList.toggle('active', v === view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.goto === view));
  window.scrollTo({ top: 0 });
  if (view === 'home') renderHome();
  if (view === 'duel') renderDuel();
  if (view === 'rank') renderRank();
  if (view === 'profile') renderProfile();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-goto]');
  if (nav) goto(nav.dataset.goto);
});

/* ============================================================
   MOTOR DE JUEGO (overlay)
   ============================================================ */
const overlay = $('#game-overlay');
const stageEl = $('#game-stage');
let activeApi = null;

function playGame({ dateKey, salt, label, onFinish }) {
  const game = gameForDate(dateKey);
  stageEl.innerHTML = '';
  $('#game-hud-title').textContent = game.name;
  $('#game-hud-label').textContent = label || 'RETO DIARIO';
  $('#game-hud-score').textContent = '0';
  overlay.classList.remove('hidden');

  const api = {
    done: false,
    onQuit: null,
    setScore(s) { $('#game-hud-score').textContent = String(s); },
    finish(score, detail) {
      if (api.done) return;
      api.done = true;
      overlay.classList.add('hidden');
      onFinish({ score, detail, game });
    },
  };
  activeApi = api;
  game.run(stageEl, dailyRng(dateKey, salt + ':' + game.id), api);
}

$('#game-quit-btn').addEventListener('click', () => {
  if (activeApi && !activeApi.done) {
    activeApi.done = true;
    if (activeApi.onQuit) activeApi.onQuit();
  }
  overlay.classList.add('hidden');
  toast('Reto abandonado — puedes reintentarlo');
});

/* ---------- modal de resultado ---------- */
function showResult({ label, title, mood, score, detail, actions }) {
  $('#result-label').textContent = label;
  const t = $('#result-title');
  t.textContent = title;
  t.className = `result-title ${mood}`;
  $('#result-score').textContent = score !== null ? `${score} pts` : '';
  $('#result-detail').textContent = detail || '';
  const box = $('#result-actions');
  box.innerHTML = '';
  actions.forEach(([text, cls, fn]) => {
    const b = document.createElement('button');
    b.className = `btn-3d ${cls} btn-block`;
    b.textContent = text;
    b.addEventListener('click', () => { $('#result-modal').classList.add('hidden'); fn && fn(); });
    box.append(b);
  });
  $('#result-modal').classList.remove('hidden');
}

/* ============================================================
   RETO DIARIO
   ============================================================ */
function playDaily() {
  const dateKey = todayKey();
  playGame({
    dateKey,
    salt: 'daily',
    label: 'RETO DIARIO',
    onFinish({ score, detail, game }) {
      const prev = state.results[dateKey];
      const isRecord = !prev || score > prev.score;
      if (isRecord) {
        state.results[dateKey] = { gameId: game.id, score, detail, at: Date.now() };
        saveState();
      }
      checkBadges();
      showResult({
        label: game.name.toUpperCase(),
        title: isRecord ? '¡NUEVA MARCA!' : 'COMPLETADO',
        mood: isRecord ? 'win' : 'neutral',
        score,
        detail: detail + (prev && !isRecord ? ` · Tu mejor: ${prev.score}` : ''),
        actions: [
          ['COMPARTIR RESULTADO', 'btn-cyan', () => { goto('duel'); }],
          ['VER RANKING', 'btn-primary', () => { goto('rank'); }],
          ['CERRAR', 'btn-ghost', () => { renderHome(); }],
        ],
      });
      renderHome();
    },
  });
}

/* ============================================================
   VISTA: HOME
   ============================================================ */
function renderHome() {
  const dateKey = todayKey();
  const game = gameForDate(dateKey);
  const res = state.results[dateKey];

  $('#home-avatar').textContent = state.profile.avatar;
  $('#home-name').textContent = state.profile.name;
  $('#home-streak').textContent = String(currentStreak());
  $('#home-game-icon').textContent = game.icon;
  $('#home-game-name').textContent = game.name;
  $('#home-game-desc').textContent = game.desc;
  $('#home-best').textContent = res ? `${res.score} pts` : '—';
  $('#home-play-label').textContent = res ? 'REINTENTAR (MEJORA TU MARCA)' : 'JUGAR AHORA';

  const chip = $('#home-live-chip');
  if (res) { chip.textContent = '✓ JUGADO'; chip.className = 'chip chip-done'; }
  else { chip.textContent = '● LIVE'; chip.className = 'chip chip-live'; }

  // mini ranking
  const rows = leaderboardFor(dateKey).slice(0, 3);
  const box = $('#home-mini-rank');
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML = '<p class="empty-note">Nadie ha puntuado todavía. ¡Sé el primero!</p>';
  } else {
    rows.forEach((r, i) => box.append(rankRow(r, i + 1)));
  }

  // próximos retos
  const rail = $('#home-upcoming');
  rail.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const k = todayKey(i);
    const g = gameForDate(k);
    const c = document.createElement('div');
    c.className = 'rail-card glass';
    c.innerHTML = `<div class="rail-icon">${g.icon}</div><div class="rail-name">${g.name}</div><div class="rail-day label-caps">${fmtDate(k)}</div>`;
    rail.append(c);
  }
}

/* countdown */
setInterval(() => {
  const now = new Date();
  const mid = new Date(now); mid.setHours(24, 0, 0, 0);
  const s = Math.floor((mid - now) / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const elC = $('#home-countdown');
  if (elC) elC.textContent = `${hh}:${mm}:${ss}`;
}, 1000);

$('#home-play-btn').addEventListener('click', playDaily);

/* ============================================================
   RANKING
   ============================================================ */
function leaderboardFor(dateKey) {
  const rows = [];
  const mine = state.results[dateKey];
  if (mine) rows.push({ name: state.profile.name, avatar: state.profile.avatar, score: mine.score, me: true });
  (state.friends[dateKey] || []).forEach(f => rows.push({ ...f, me: false }));
  return rows.sort((a, b) => b.score - a.score);
}

function aggregateBoard(days) {
  const totals = new Map();
  for (const dateKey of days) {
    for (const r of leaderboardFor(dateKey)) {
      const k = (r.me ? '@me' : r.name.toLowerCase());
      const cur = totals.get(k) || { name: r.name, avatar: r.avatar, score: 0, me: r.me, days: 0 };
      cur.score += r.score;
      cur.days++;
      totals.set(k, cur);
    }
  }
  return [...totals.values()].sort((a, b) => b.score - a.score);
}

function rankRow(r, pos) {
  const row = document.createElement('div');
  row.className = 'rank-row glass' + (r.me ? ' me' : '');
  const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : String(pos);
  row.innerHTML = `
    <span class="rank-pos">${medal}</span>
    <div class="avatar avatar-md">${r.avatar}</div>
    <div class="rank-info">
      <p class="rank-name">${escapeHtml(r.name)}${r.me ? ' <span class="text-cyan">(tú)</span>' : ''}</p>
      <p class="rank-sub">${r.days ? `${r.days} día(s) jugados` : 'Reto diario'}</p>
    </div>
    <span class="rank-score">${r.score}</span>`;
  return row;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let rankRange = 'today';

function renderRank() {
  let rows, sub;
  if (rankRange === 'today') {
    rows = leaderboardFor(todayKey());
    sub = `Reto de hoy · ${gameForDate(todayKey()).name}`;
  } else if (rankRange === 'week') {
    rows = aggregateBoard([...Array(7)].map((_, i) => todayKey(-i)));
    sub = 'Suma de los últimos 7 días';
  } else {
    const allDays = new Set([...Object.keys(state.results), ...Object.keys(state.friends)]);
    rows = aggregateBoard([...allDays]);
    sub = 'Suma histórica total';
  }
  $('#rank-sub').textContent = sub;

  const podium = $('#rank-podium');
  podium.innerHTML = '';
  if (!rows.length) {
    podium.innerHTML = '<p class="podium-empty">Sin puntuaciones aún.<br>Juega el reto y añade códigos de tus amigos.</p>';
  } else {
    const order = [1, 0, 2]; // plata, oro, bronce (visual)
    order.forEach(idx => {
      const r = rows[idx];
      if (!r) return;
      const col = document.createElement('div');
      col.className = `podium-col podium-${idx + 1}`;
      col.innerHTML = `
        <div class="avatar avatar-lg ${idx === 0 ? 'glow-primary' : ''}">${r.avatar}</div>
        <p class="podium-name">${escapeHtml(r.name)}</p>
        <p class="podium-score">${r.score} pts</p>
        <div class="podium-base">${idx + 1}</div>`;
      podium.append(col);
    });
  }

  const list = $('#rank-list');
  list.innerHTML = '';
  rows.slice(3).forEach((r, i) => list.append(rankRow(r, i + 4)));
  if (rows.length && rows.length <= 3) {
    list.innerHTML = '<p class="empty-note">Añade códigos de amigos para llenar la tabla.</p>';
  }
}

$('#rank-seg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  rankRange = b.dataset.range;
  $$('#rank-seg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  renderRank();
});

/* ============================================================
   DUELO
   ============================================================ */
function renderDuel() {
  const dateKey = todayKey();
  const res = state.results[dateKey];
  $('#duel-me-avatar').textContent = state.profile.avatar;
  $('#duel-me-name').textContent = state.profile.name;
  $('#duel-me-score').textContent = res ? `${res.score}` : '—';

  // código de compartir
  if (res) {
    $('#share-status').textContent = `Tu resultado de hoy en ${gameForDate(dateKey).name}:`;
    $('#share-code').textContent = buildShareCode(dateKey, res);
  } else {
    $('#share-status').textContent = 'Juega el reto de hoy para generar tu código.';
    $('#share-code').textContent = '—';
  }

  // historial
  const hist = $('#duel-history');
  hist.innerHTML = '';
  if (!state.duels.length) {
    hist.innerHTML = '<p class="empty-note">Aún no hay duelos. ¡Reta a alguien!</p>';
  }
  [...state.duels].reverse().slice(0, 10).forEach(d => {
    const won = d.myScore > d.foeScore;
    const tie = d.myScore === d.foeScore;
    const row = document.createElement('div');
    row.className = 'rank-row glass';
    const g = GAMES.find(x => x.id === d.gameId) || { icon: '🎮', name: d.gameId };
    row.innerHTML = `
      <span class="rank-pos">${g.icon}</span>
      <div class="rank-info">
        <p class="rank-name">${escapeHtml(d.me)} <span class="text-muted">vs</span> ${escapeHtml(d.foe)}</p>
        <p class="rank-sub">${fmtDate(d.date)} · ${g.name}</p>
      </div>
      <span class="rank-score ${tie ? '' : won ? 'text-win' : 'text-lose'}">${d.myScore}–${d.foeScore}</span>`;
    hist.append(row);
  });
}

$('#duel-start-btn').addEventListener('click', () => {
  const foe = $('#duel-foe-input').value.trim() || 'Rival';
  const dateKey = todayKey();
  const duelSalt = 'duel:' + Date.now();
  $('#duel-foe-name').textContent = foe;

  // turno 1: yo
  playGame({
    dateKey, salt: duelSalt + ':p1', label: `DUELO · TURNO DE ${state.profile.name.toUpperCase()}`,
    onFinish({ score: myScore, game }) {
      $('#duel-me-score').textContent = String(myScore);
      showResult({
        label: 'DUELO — TURNO 1 COMPLETADO',
        title: `${myScore} PTS`,
        mood: 'neutral',
        score: null,
        detail: `Pásale el móvil a ${foe}. Le toca el mismo reto.`,
        actions: [[`TURNO DE ${foe.toUpperCase()}`, 'btn-pink', () => {
          // turno 2: rival (misma semilla → mismo reto exacto)
          playGame({
            dateKey, salt: duelSalt + ':p1', label: `DUELO · TURNO DE ${foe.toUpperCase()}`,
            onFinish({ score: foeScore }) {
              $('#duel-foe-score').textContent = String(foeScore);
              state.duels.push({ date: dateKey, gameId: game.id, me: state.profile.name, foe, myScore, foeScore });
              saveState();
              checkBadges();
              const won = myScore > foeScore;
              const tie = myScore === foeScore;
              showResult({
                label: `${state.profile.name} ${myScore} — ${foeScore} ${foe}`,
                title: tie ? 'EMPATE' : won ? `¡GANA ${state.profile.name.toUpperCase()}!` : `¡GANA ${foe.toUpperCase()}!`,
                mood: tie ? 'neutral' : won ? 'win' : 'lose',
                score: null,
                detail: GAMES.find(g2 => g2.id === game.id).name,
                actions: [
                  ['REVANCHA', 'btn-primary', () => $('#duel-start-btn').click()],
                  ['CERRAR', 'btn-ghost', () => renderDuel()],
                ],
              });
              renderDuel();
            },
          });
        }]],
      });
    },
  });
});

/* ---------- compartir / importar códigos ---------- */
function buildShareCode(dateKey, res) {
  const payload = { v: 1, d: dateKey, g: res.gameId, n: state.profile.name, a: state.profile.avatar, s: res.score };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'DDB1.' + b64;
}

function parseShareCode(code) {
  const m = String(code).trim().match(/^DDB1\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const p = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (p.v !== 1 || typeof p.s !== 'number' || !p.d || !p.n) return null;
    return p;
  } catch (e) { return null; }
}

$('#share-copy-btn').addEventListener('click', async () => {
  const code = $('#share-code').textContent;
  if (code === '—') { toast('Primero juega el reto de hoy'); return; }
  const game = gameForDate(todayKey());
  const text = `⚡ Daily Buddy Battles — ${game.name}\n${state.profile.avatar} ${state.profile.name}: ${state.results[todayKey()].score} pts\n¿Me superas? Pega mi código en la app:\n${code}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('¡Copiado! Envíaselo a tus amigos');
  } catch (e) {
    // fallback si el portapapeles está bloqueado
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    toast('¡Copiado! Envíaselo a tus amigos');
  }
});

$('#import-btn').addEventListener('click', () => {
  const raw = $('#import-input').value;
  const msg = $('#import-msg');
  // acepta el código aunque venga pegado con el texto de compartir
  const match = raw.match(/DDB1\.[A-Za-z0-9_-]+/);
  const p = match ? parseShareCode(match[0]) : null;
  if (!p) { msg.textContent = '⚠️ Código no válido.'; msg.style.color = 'var(--error)'; return; }
  if (p.n.toLowerCase() === state.profile.name.toLowerCase()) {
    msg.textContent = '⚠️ Ese código es tuyo.'; msg.style.color = 'var(--error)'; return;
  }
  const list = state.friends[p.d] = state.friends[p.d] || [];
  const existing = list.find(f => f.name.toLowerCase() === p.n.toLowerCase());
  if (existing) {
    if (p.s > existing.score) existing.score = p.s;
    existing.avatar = p.a || existing.avatar;
  } else {
    list.push({ name: p.n, avatar: p.a || '👾', score: p.s });
  }
  saveState();
  $('#import-input').value = '';
  msg.textContent = `✅ ${p.n} añadido al ranking de ${fmtDate(p.d)} con ${p.s} pts.`;
  msg.style.color = 'var(--win)';
  toast(`${p.a || '👾'} ${p.n} entra en la clasificación`);
});

/* ============================================================
   PERFIL
   ============================================================ */
const TITLES = [
  [0, 'NOVATO NEÓN'], [3, 'RETADOR'], [7, 'GLADIADOR ARCADE'], [15, 'MAESTRO DEL DUELO'], [30, 'LEYENDA NEÓN'],
];

function renderProfile() {
  const played = Object.keys(state.results).length;
  $('#prof-avatar').textContent = state.profile.avatar;
  $('#prof-name').textContent = state.profile.name;
  $('#st-played').textContent = String(played);
  $('#st-streak').textContent = String(currentStreak());
  $('#st-wins').textContent = String(state.duels.filter(d => d.myScore > d.foeScore).length);
  $('#st-points').textContent = totalPoints(state).toLocaleString('es');

  const title = TITLES.filter(([n]) => played >= n).pop();
  $('#prof-title-badge').textContent = title[1];

  const bg = $('#prof-badges');
  bg.innerHTML = '';
  BADGES.forEach(b => {
    const earned = state.badges.includes(b.id);
    const pod = document.createElement('div');
    pod.className = 'badge-pod glass' + (earned ? ' earned' : '');
    pod.innerHTML = `<div class="badge-icon">${b.icon}</div><div class="badge-name">${b.name}</div>`;
    bg.append(pod);
  });

  const act = $('#prof-activity');
  act.innerHTML = '';
  const entries = Object.entries(state.results).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  if (!entries.length) act.innerHTML = '<p class="empty-note">Todavía no has jugado ningún reto.</p>';
  entries.forEach(([date, r]) => {
    const g = GAMES.find(x => x.id === r.gameId) || { icon: '🎮', name: r.gameId };
    const row = document.createElement('div');
    row.className = 'rank-row glass';
    row.innerHTML = `
      <span class="rank-pos">${g.icon}</span>
      <div class="rank-info">
        <p class="rank-name">${g.name}</p>
        <p class="rank-sub">${fmtDate(date)} · ${escapeHtml(r.detail || '')}</p>
      </div>
      <span class="rank-score">${r.score}</span>`;
    act.append(row);
  });
}

/* ---------- edición de perfil ---------- */
const AVATARS = ['🦊', '👾', '🐺', '🐸', '🐙', '🦄', '🤖', '👻', '🐯', '🦁', '🐼', '🐹', '🦉', '🐲', '😼', '🦈', '🐝', '🎃'];
let pendingAvatar = null;

function openEdit() {
  $('#edit-name').value = state.profile.name;
  pendingAvatar = state.profile.avatar;
  const grid = $('#edit-emojis');
  grid.innerHTML = '';
  AVATARS.forEach(a => {
    const b = document.createElement('button');
    b.className = 'emoji-opt' + (a === pendingAvatar ? ' sel' : '');
    b.textContent = a;
    b.addEventListener('click', () => {
      pendingAvatar = a;
      grid.querySelectorAll('.emoji-opt').forEach(x => x.classList.toggle('sel', x === b));
    });
    grid.append(b);
  });
  $('#edit-modal').classList.remove('hidden');
}

$('#prof-edit-btn').addEventListener('click', openEdit);
$('#edit-save-btn').addEventListener('click', () => {
  const name = $('#edit-name').value.trim();
  if (name) state.profile.name = name.slice(0, 14);
  state.profile.avatar = pendingAvatar || state.profile.avatar;
  saveState();
  $('#edit-modal').classList.add('hidden');
  renderProfile();
  renderHome();
  toast('Perfil guardado');
});

$('#prof-reset-btn').addEventListener('click', () => {
  if (confirm('¿Seguro? Se borrarán tu perfil, resultados, duelos e insignias.')) {
    localStorage.removeItem(STORE_KEY);
    state = loadState();
    goto('home');
    toast('Datos borrados');
  }
});

/* cerrar modales tocando el fondo */
[['#edit-modal'], ['#result-modal']].forEach(([sel]) => {
  $(sel).addEventListener('click', (e) => {
    if (e.target === $(sel)) $(sel).classList.add('hidden');
  });
});

/* ============================================================
   ARRANQUE
   ============================================================ */
(function boot() {
  // primera visita: abrir editor de perfil
  if (!localStorage.getItem(STORE_KEY)) {
    saveState();
    setTimeout(openEdit, 600);
  }
  renderHome();
})();
