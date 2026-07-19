/* ============================================================
   DAILY BUDDY BATTLES — minijuegos
   Cada juego recibe (stage, rng, api) y termina con api.finish(score, detail).
   rng es un generador determinista sembrado con la fecha, así todos
   los amigos juegan exactamente el mismo reto cada día.
   ============================================================ */

'use strict';

/* ---------- RNG determinista (mulberry32) ---------- */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

/* barra de progreso neón (spec "Progress Bars") para los juegos con tiempo */
function timeBar() {
  const bar = el('div', 'progress');
  const fill = el('div');
  fill.style.width = '100%';
  bar.append(fill);
  return { bar, set(ratio) { fill.style.width = `${Math.max(0, ratio) * 100}%`; } };
}

/* ============================================================
   1. DUELO DE REFLEJOS
   ============================================================ */
function gameReflex(stage, rng, api) {
  const ROUNDS = 5;
  let round = 0;
  let total = 0;
  let timer = null;
  let goAt = 0;
  let state = 'idle'; // idle | wait | go
  const times = [];

  const info = el('div', 'stage-center', '');
  const msg = el('p', 'stage-msg', 'Toca cuando el panel se ilumine en cian.<br>¡Ojo con salir antes de tiempo!');
  const pad = el('div', 'reflex-pad', '<p class="stage-big">👆</p><p class="stage-msg">Toca para empezar</p>');
  const prog = el('p', 'stage-timer', `RONDA 0 / ${ROUNDS}`);
  info.append(msg, prog);
  info.style.flex = '0 0 auto';
  info.style.paddingBottom = '14px';
  stage.append(info, pad);

  function nextRound() {
    round++;
    if (round > ROUNDS) {
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      api.finish(total, `Media de reacción: ${avg} ms`);
      return;
    }
    prog.textContent = `RONDA ${round} / ${ROUNDS}`;
    state = 'wait';
    pad.className = 'reflex-pad wait';
    pad.innerHTML = '<p class="stage-big">…</p><p class="stage-msg">Espera al cian</p>';
    const delay = 1000 + rng() * 2500;
    timer = setTimeout(() => {
      state = 'go';
      goAt = performance.now();
      pad.className = 'reflex-pad go';
      pad.innerHTML = '<p class="stage-big">⚡</p><p class="stage-msg">¡TOCA YA!</p>';
    }, delay);
  }

  pad.addEventListener('pointerdown', () => {
    if (api.done) return;
    if (state === 'idle') { nextRound(); return; }
    if (state === 'wait') {
      clearTimeout(timer);
      state = 'idle';
      times.push(1000);
      pad.className = 'reflex-pad fail';
      pad.innerHTML = '<p class="stage-big">✕</p><p class="stage-msg">¡Demasiado pronto! (+0 pts)<br>Toca para seguir</p>';
      return;
    }
    if (state === 'go') {
      const ms = Math.round(performance.now() - goAt);
      times.push(ms);
      const pts = Math.max(0, 1000 - ms * 2);
      total += pts;
      api.setScore(total);
      state = 'idle';
      pad.className = 'reflex-pad';
      pad.innerHTML = `<p class="stage-big">${ms} ms</p><p class="stage-msg">+${pts} pts · toca para seguir</p>`;
    }
  });

  api.onQuit = () => clearTimeout(timer);
}

/* ============================================================
   2. MEMORIA NEÓN
   ============================================================ */
function gameMemory(stage, rng, api) {
  const ICONS = ['⚡', '👾', '🔥', '💎', '🚀', '🌙', '🎯', '🕹️'];
  const deck = shuffled(ICONS.concat(ICONS), rng);
  let open = [];
  let lock = false;
  let moves = 0;
  let found = 0;
  const t0 = performance.now();

  const head = el('div', 'stage-center');
  head.style.flex = '0 0 auto';
  const prog = el('p', 'stage-timer', 'PARES 0 / 8 · MOVIMIENTOS 0');
  head.append(el('p', 'stage-msg', 'Encuentra los 8 pares.<br>Menos movimientos y menos tiempo = más puntos.'), prog);
  const grid = el('div', 'mem-grid');
  stage.append(head, grid);

  deck.forEach((icon, i) => {
    const c = el('button', 'mem-card', '');
    c.dataset.icon = icon;
    grid.append(c);
    c.addEventListener('click', () => {
      if (lock || c.classList.contains('open') || c.classList.contains('done') || api.done) return;
      c.classList.add('open');
      c.textContent = icon;
      open.push(c);
      if (open.length === 2) {
        moves++;
        lock = true;
        const [a, b] = open;
        const match = a.dataset.icon === b.dataset.icon;
        setTimeout(() => {
          if (match) {
            a.classList.add('done'); b.classList.add('done');
            a.classList.remove('open'); b.classList.remove('open');
            found++;
          } else {
            a.classList.remove('open'); b.classList.remove('open');
            a.textContent = ''; b.textContent = '';
          }
          open = [];
          lock = false;
          prog.textContent = `PARES ${found} / 8 · MOVIMIENTOS ${moves}`;
          const secs = (performance.now() - t0) / 1000;
          api.setScore(liveScore(secs));
          if (found === 8) {
            const s = liveScore(secs);
            api.finish(s, `${moves} movimientos en ${Math.round(secs)} s`);
          }
        }, match ? 120 : 550);
      }
    });
  });

  function liveScore(secs) {
    return Math.max(150, 3000 - Math.max(0, moves - 8) * 90 - Math.round(secs) * 18);
  }
}

/* ============================================================
   3. CÁLCULO RÁPIDO
   ============================================================ */
function gameMath(stage, rng, api) {
  const DURATION = 45;
  let score = 0;
  let streak = 0;
  let correct = 0;
  let wrong = 0;
  let left = DURATION;
  let ticker = null;

  const head = el('div', 'stage-center');
  head.style.flex = '0 0 auto';
  const timerP = el('p', 'stage-timer', `⏱ ${DURATION} s`);
  const streakP = el('p', 'label-caps text-pink', 'RACHA ×0');
  const tb = timeBar();
  head.append(timerP, tb.bar, streakP);

  const box = el('div', 'quiz-box');
  const qP = el('p', 'quiz-q', '');
  const opts = el('div', 'quiz-opts');
  box.append(qP, opts);
  stage.append(head, box);

  function makeQuestion() {
    const kind = Math.floor(rng() * 4);
    let a, b, ans, text;
    if (kind === 0) { a = 3 + Math.floor(rng() * 40); b = 3 + Math.floor(rng() * 40); ans = a + b; text = `${a} + ${b}`; }
    else if (kind === 1) { a = 10 + Math.floor(rng() * 60); b = Math.floor(rng() * a); ans = a - b; text = `${a} − ${b}`; }
    else if (kind === 2) { a = 2 + Math.floor(rng() * 11); b = 2 + Math.floor(rng() * 11); ans = a * b; text = `${a} × ${b}`; }
    else { b = 2 + Math.floor(rng() * 9); ans = 2 + Math.floor(rng() * 10); a = ans * b; text = `${a} ÷ ${b}`; }
    const answers = new Set([ans]);
    while (answers.size < 4) {
      const off = Math.floor(rng() * 10) - 5;
      const cand = ans + (off === 0 ? 6 : off) + (rng() > 0.8 ? 10 : 0);
      if (cand >= 0) answers.add(cand);
    }
    return { text, ans, options: shuffled([...answers], rng) };
  }

  function ask() {
    const q = makeQuestion();
    qP.textContent = q.text;
    opts.innerHTML = '';
    q.options.forEach(o => {
      const b = el('button', 'quiz-opt', String(o));
      b.addEventListener('click', () => {
        if (api.done) return;
        if (o === q.ans) {
          correct++; streak++;
          score += 100 + streak * 10;
          b.classList.add('ok');
        } else {
          wrong++; streak = 0;
          score = Math.max(0, score - 25);
          b.classList.add('ko');
        }
        streakP.textContent = `RACHA ×${streak}`;
        api.setScore(score);
        setTimeout(ask, 130);
      }, { once: true });
      opts.append(b);
    });
  }

  ticker = setInterval(() => {
    left--;
    timerP.textContent = `⏱ ${left} s`;
    tb.set(left / DURATION);
    if (left <= 0) {
      clearInterval(ticker);
      api.finish(score, `${correct} aciertos · ${wrong} fallos`);
    }
  }, 1000);
  api.onQuit = () => clearInterval(ticker);
  ask();
}

/* ============================================================
   4. PALABRA OCULTA
   ============================================================ */
const WORD_BANK = [
  'NEBULA', 'COMETA', 'GALAXIA', 'PLANETA', 'COHETE', 'ORBITA', 'METEORO', 'ECLIPSE',
  'NEON', 'LASER', 'ARCADE', 'PIXEL', 'ROBOT', 'CIRCUITO', 'ENERGIA', 'TURBO',
  'VICTORIA', 'BATALLA', 'TORNEO', 'RIVAL', 'CAMPEON', 'MEDALLA', 'TROFEO', 'RACHA',
  'ESTRELLA', 'DESTELLO', 'RELAMPAGO', 'TORMENTA', 'VOLCAN', 'GLACIAR', 'OCEANO', 'SELVA',
  'MISTERIO', 'ENIGMA', 'SECRETO', 'CODIGO', 'SENAL', 'RADAR', 'SONDA', 'NAVE',
];

function gameWord(stage, rng, api) {
  const DURATION = 60;
  const words = shuffled(WORD_BANK, rng);
  let idx = 0;
  let score = 0;
  let solved = 0;
  let left = DURATION;
  let picked = [];

  const head = el('div', 'stage-center');
  head.style.flex = '0 0 auto';
  const timerP = el('p', 'stage-timer', `⏱ ${DURATION} s`);
  const tb = timeBar();
  head.append(el('p', 'stage-msg', 'Ordena las letras y forma la palabra.'), timerP, tb.bar);

  const box = el('div', 'quiz-box');
  const answer = el('div', 'word-answer');
  const tiles = el('div', 'word-tiles');
  const controls = el('div', 'quiz-opts');
  const clearB = el('button', 'btn-3d btn-ghost', 'BORRAR');
  const skipB = el('button', 'btn-3d btn-pink', 'PASAR (−25)');
  controls.append(clearB, skipB);
  box.append(answer, tiles, controls);
  stage.append(head, box);

  function load() {
    const word = words[idx % words.length];
    picked = [];
    answer.innerHTML = '';
    tiles.innerHTML = '';
    let letters = shuffled(word.split(''), rng);
    if (letters.join('') === word) letters = letters.reverse();
    letters.forEach((ch) => {
      const t = el('button', 'word-tile', ch);
      t.addEventListener('click', () => {
        if (t.classList.contains('used') || api.done) return;
        t.classList.add('used');
        picked.push({ ch, tile: t });
        const a = el('div', 'word-tile', ch);
        answer.append(a);
        if (picked.length === word.length) {
          const guess = picked.map(p => p.ch).join('');
          if (guess === word) {
            solved++;
            score += 150;
            api.setScore(score);
            idx++;
            setTimeout(load, 220);
          } else {
            answer.querySelectorAll('.word-tile').forEach(n => { n.style.borderColor = 'var(--lose)'; });
            setTimeout(reset, 450);
          }
        }
      });
      tiles.append(t);
    });
  }

  function reset() {
    picked = [];
    answer.innerHTML = '';
    tiles.querySelectorAll('.word-tile').forEach(t => t.classList.remove('used'));
  }

  clearB.addEventListener('click', reset);
  skipB.addEventListener('click', () => {
    if (api.done) return;
    score = Math.max(0, score - 25);
    api.setScore(score);
    idx++;
    load();
  });

  const ticker = setInterval(() => {
    left--;
    timerP.textContent = `⏱ ${left} s`;
    tb.set(left / DURATION);
    if (left <= 0) {
      clearInterval(ticker);
      api.finish(score, `${solved} palabras resueltas`);
    }
  }, 1000);
  api.onQuit = () => clearInterval(ticker);
  load();
}

/* ============================================================
   5. SECUENCIA NEÓN (simon)
   ============================================================ */
function gameSimon(stage, rng, api) {
  let seq = [];
  let inputPos = 0;
  let level = 0;
  let score = 0;
  let accepting = false;
  const timeouts = [];

  const head = el('div', 'stage-center');
  head.style.flex = '0 0 auto';
  const msg = el('p', 'stage-msg', 'Memoriza la secuencia de luces y repítela.');
  const prog = el('p', 'stage-timer', 'NIVEL 1');
  head.append(msg, prog);
  const grid = el('div', 'simon-grid');
  const pads = [];
  for (let i = 0; i < 4; i++) {
    const p = el('button', `simon-pad simon-${i}`, '');
    pads.push(p);
    grid.append(p);
    p.addEventListener('pointerdown', () => {
      if (!accepting || api.done) return;
      flash(i, 220);
      if (i === seq[inputPos]) {
        inputPos++;
        if (inputPos === seq.length) {
          accepting = false;
          score += 100 + level * 25;
          api.setScore(score);
          timeouts.push(setTimeout(nextLevel, 700));
        }
      } else {
        accepting = false;
        api.finish(score, `Llegaste al nivel ${level}`);
      }
    });
  }
  stage.append(head, grid);

  function flash(i, dur) {
    pads[i].classList.add('lit');
    timeouts.push(setTimeout(() => pads[i].classList.remove('lit'), dur));
  }

  function playSeq() {
    accepting = false;
    seq.forEach((p, k) => {
      timeouts.push(setTimeout(() => flash(p, 340), 600 + k * 520));
    });
    timeouts.push(setTimeout(() => {
      accepting = true;
      inputPos = 0;
      msg.innerHTML = '¡Tu turno!';
    }, 600 + seq.length * 520));
  }

  function nextLevel() {
    level++;
    prog.textContent = `NIVEL ${level}`;
    msg.innerHTML = 'Observa…';
    seq.push(Math.floor(rng() * 4));
    playSeq();
  }

  api.onQuit = () => timeouts.forEach(clearTimeout);
  nextLevel();
}

/* ============================================================
   6. LLUVIA DE DIANAS
   ============================================================ */
function gameTargets(stage, rng, api) {
  const DURATION = 30;
  let score = 0;
  let hits = 0;
  let misses = 0;
  let left = DURATION;
  let spawner = null;
  let ticker = null;

  const head = el('div', 'stage-center');
  head.style.flex = '0 0 auto';
  const timerP = el('p', 'stage-timer', `⏱ ${DURATION} s`);
  const tb = timeBar();
  head.append(el('p', 'stage-msg', 'Revienta las dianas antes de que se encojan.'), timerP, tb.bar);
  const arena = el('div', 'target-arena');
  stage.append(head, arena);

  arena.addEventListener('pointerdown', (e) => {
    if (e.target === arena && !api.done) {
      misses++;
      score = Math.max(0, score - 10);
      api.setScore(score);
    }
  });

  function spawn() {
    if (api.done) return;
    const size = 44 + rng() * 40;
    const life = 1400 + rng() * 900;
    const t = el('div', 'target', '');
    t.style.width = t.style.height = `${size}px`;
    t.style.left = `${8 + rng() * 84}%`;
    t.style.top = `${8 + rng() * 84}%`;
    t.style.animationDuration = `${life}ms`;
    const born = performance.now();
    t.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (api.done) return;
      const age = (performance.now() - born) / life;
      const pts = Math.max(25, Math.round(120 - age * 95));
      hits++;
      score += pts;
      api.setScore(score);
      t.remove();
    });
    arena.append(t);
    setTimeout(() => t.remove(), life);
  }

  spawner = setInterval(spawn, 650);
  spawn();
  ticker = setInterval(() => {
    left--;
    timerP.textContent = `⏱ ${left} s`;
    tb.set(left / DURATION);
    if (left <= 0) {
      clearInterval(ticker);
      clearInterval(spawner);
      api.finish(score, `${hits} dianas · ${misses} fallos`);
    }
  }, 1000);
  api.onQuit = () => { clearInterval(ticker); clearInterval(spawner); };
}

/* ============================================================
   7. PULSO PERFECTO
   ============================================================ */
function gamePulse(stage, rng, api) {
  const TRIES = 5;
  let attempt = 0;
  let score = 0;
  let raf = null;
  let pos = 0;
  let dir = 1;
  let speed = 0.9; // % por frame
  let running = false;

  const center = el('div', 'stage-center');
  const msg = el('p', 'stage-msg', 'Detén el pulso dentro de la zona verde.<br>Cuanto más al centro, más puntos.');
  const prog = el('p', 'stage-timer', `INTENTO 1 / ${TRIES}`);
  const track = el('div', 'pulse-track');
  const zone = el('div', 'pulse-zone');
  const cursor = el('div', 'pulse-cursor');
  track.append(zone, cursor);
  const btn = el('button', 'btn-3d btn-primary btn-block', '¡AHORA!');
  const last = el('p', 'stats-number text-cyan', '');
  center.append(msg, prog, track, last, btn);
  stage.append(center);

  let zoneC = 50, zoneW = 18;

  function setupRound() {
    zoneW = Math.max(7, 20 - attempt * 3);
    zoneC = 18 + rng() * 64;
    speed = 0.9 + attempt * 0.28;
    zone.style.left = `${zoneC - zoneW / 2}%`;
    zone.style.width = `${zoneW}%`;
    pos = 0; dir = 1;
    prog.textContent = `INTENTO ${attempt + 1} / ${TRIES}`;
    running = true;
    loop();
  }

  function loop() {
    if (!running || api.done) return;
    pos += dir * speed;
    if (pos >= 100) { pos = 100; dir = -1; }
    if (pos <= 0) { pos = 0; dir = 1; }
    cursor.style.left = `calc(${pos}% - 2px)`;
    raf = requestAnimationFrame(loop);
  }

  btn.addEventListener('click', () => {
    if (api.done) return;
    if (!running) { setupRound(); btn.textContent = '¡AHORA!'; return; }
    running = false;
    cancelAnimationFrame(raf);
    const dist = Math.abs(pos - zoneC);
    const inZone = dist <= zoneW / 2;
    const pts = inZone ? Math.round(200 - (dist / (zoneW / 2)) * 110) : 0;
    score += pts;
    api.setScore(score);
    last.textContent = inZone ? `+${pts} pts 🎯` : 'Fuera de zona · +0';
    attempt++;
    if (attempt >= TRIES) {
      api.finish(score, `${TRIES} pulsos lanzados`);
    } else {
      btn.textContent = 'SIGUIENTE PULSO';
    }
  });

  api.onQuit = () => cancelAnimationFrame(raf);
  setupRound();
}

/* ============================================================
   Catálogo — la rotación diaria escoge uno por fecha
   ============================================================ */
const GAMES = [
  { id: 'reflex',  icon: '⚡', name: 'Duelo de Reflejos', desc: 'Toca al instante cuando el panel se encienda. 5 rondas.', run: gameReflex },
  { id: 'memory',  icon: '🧠', name: 'Memoria Neón',      desc: 'Encuentra los 8 pares en el menor tiempo posible.', run: gameMemory },
  { id: 'math',    icon: '➗', name: 'Cálculo Rápido',    desc: '45 segundos de operaciones a toda velocidad.', run: gameMath },
  { id: 'word',    icon: '🔤', name: 'Palabra Oculta',    desc: 'Reordena las letras y descubre la palabra.', run: gameWord },
  { id: 'simon',   icon: '🎼', name: 'Secuencia Neón',    desc: 'Repite la secuencia de luces. Cada nivel crece.', run: gameSimon },
  { id: 'targets', icon: '🎯', name: 'Lluvia de Dianas',  desc: 'Revienta todas las dianas que puedas en 30 s.', run: gameTargets },
  { id: 'pulse',   icon: '💓', name: 'Pulso Perfecto',    desc: 'Frena el cursor en plena zona verde. 5 intentos.', run: gamePulse },
];
