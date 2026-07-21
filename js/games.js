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

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

/* baraja una copia del array con el RNG dado (Fisher–Yates) */
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   FLIP JUMP
   Mantén pulsado para cargar, suelta para saltar: el personaje da
   un salto mortal hasta la siguiente plataforma. Aterriza cerca del
   centro para un "¡PERFECTO!" con combo. Si caes, se acabó.
   ============================================================ */
function gameFlip(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const powerWrap = el('div', 'flip-power');
  const powerFill = el('div', 'flip-power-fill');
  powerWrap.append(powerFill);
  const hint = el('p', 'stage-timer', 'MANTÉN PULSADO PARA CARGAR · SUELTA PARA SALTAR');
  wrap.append(canvas, powerWrap, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(300, r.height - 70);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();

  /* mundo */
  const GROUND = () => H - 46;
  const CHAR_X = () => Math.min(90, W * 0.22);   // el personaje se queda a la izquierda; el mundo se desplaza
  const G = 1500;
  const JUMP_VY = 560;
  const AIRTIME = (2 * JUMP_VY) / G;

  const avatar = (typeof state !== 'undefined' && state.profile) ? state.profile.avatar : '🦊';

  let platforms = [];   // { x, w } en coordenadas de mundo
  let worldX = 0;       // scroll del mundo
  let charW = 0;        // posición x del personaje en el mundo
  let charY = 0;        // altura sobre el suelo (0 = en plataforma)
  let vx = 0, vy = 0;
  let flying = false;
  let charging = false;
  let power = 0;
  let chargeDir = 1;
  let flips = 1;
  let angle = 0;
  let score = 0;
  let landed = 0;
  let streak = 0;
  let maxStreak = 0;
  let over = false;
  let popup = null;     // { text, t, color }
  let raf = null;
  let last = performance.now();

  function addPlatform() {
    const prev = platforms[platforms.length - 1];
    const n = platforms.length; // dificultad progresiva y determinista
    const gapMax = Math.min(150, W * 0.35, 46 + n * 10);
    const gap = 40 + rng() * gapMax;
    const w = 60 + rng() * Math.max(30, 74 - n * 2);
    platforms.push({ x: prev.x + prev.w + gap, w });
  }

  // arranque: plataforma bajo el personaje + siguientes
  platforms.push({ x: 0, w: 110 });
  charW = 55;
  for (let i = 0; i < 6; i++) addPlatform();

  function jumpDistFor(p) {
    return 40 + p * (Math.min(320, W * 0.8) - 40);
  }

  function startCharge() {
    if (flying || over || api.done) return;
    charging = true;
    power = 0;
    chargeDir = 1;
  }

  function release() {
    if (!charging || flying || over || api.done) return;
    charging = false;
    flying = true;
    flips = power > 0.72 ? 2 : 1;
    angle = 0;
    vy = -JUMP_VY;
    vx = jumpDistFor(power) / AIRTIME;
  }

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); startCharge(); });
  window.addEventListener('pointerup', release);

  function currentPlatform() {
    return platforms.find(p => charW >= p.x && charW <= p.x + p.w);
  }

  function fail() {
    over = true;
    setTimeout(() => {
      api.finish(score, `${landed} plataformas · mejor racha ×${maxStreak}`);
    }, 650);
  }

  function land(p) {
    charW = Math.max(p.x + 4, Math.min(p.x + p.w - 4, charW));
    charY = 0; vy = 0; vx = 0;
    flying = false;
    angle = 0;
    landed++;
    const center = p.x + p.w / 2;
    const perfect = Math.abs(charW - center) < p.w * 0.18;
    let pts = 100;
    if (perfect) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
      pts += 50 * streak;
      popup = { text: `¡PERFECTO! ×${streak}`, t: 1, color: '#00f4fe' };
    } else {
      streak = 0;
      popup = { text: '+100', t: 1, color: '#ebb2ff' };
    }
    score += pts;
    api.setScore(score);
    addPlatform();
  }

  function step(dt) {
    if (charging) {
      power += chargeDir * dt / 0.85;
      if (power >= 1) { power = 1; chargeDir = -1; }
      if (power <= 0) { power = 0; chargeDir = 1; }
    }
    powerFill.style.width = `${power * 100}%`;

    if (flying) {
      charW += vx * dt;
      vy += G * dt;
      charY -= vy * dt;
      angle += (Math.PI * 2 * flips / AIRTIME) * dt;
      if (!over && charY <= 0 && vy > 0) {
        const p = platforms.find(pl => charW >= pl.x - 6 && charW <= pl.x + pl.w + 6);
        if (p) { charY = 0; land(p); }
        // sin plataforma debajo: sigue cayendo al vacío
      }
      if (!over && charY < -40) fail();
    }

    // cámara: sigue al personaje
    const target = charW - CHAR_X();
    worldX += (target - worldX) * Math.min(1, dt * 8);

    if (popup) {
      popup.t -= dt;
      if (popup.t <= 0) popup = null;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // rejilla neón de fondo
    ctx.strokeStyle = 'rgba(235,178,255,0.06)';
    ctx.lineWidth = 1;
    const gs = 40;
    const gx = -(worldX % gs);
    for (let x = gx; x < W; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gs) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // plataformas
    const gy = GROUND();
    platforms.forEach(p => {
      const sx = p.x - worldX;
      if (sx > W || sx + p.w < -20) return;
      ctx.fillStyle = '#171f33';
      ctx.strokeStyle = '#00f4fe';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f4fe';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(sx, gy, p.w, 14, 7);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // zona perfecta
      ctx.fillStyle = 'rgba(0,244,254,0.35)';
      const pz = p.w * 0.36;
      ctx.beginPath();
      ctx.roundRect(sx + (p.w - pz) / 2, gy, pz, 4, 2);
      ctx.fill();
    });

    // personaje (emoji con rotación de salto mortal)
    const cx = charW - worldX;
    const cy = gy - 16 - charY;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(flying ? -angle : 0);
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ebb2ff';
    ctx.shadowBlur = 14;
    ctx.fillText(avatar, 0, 0);
    ctx.restore();

    // popup de puntos
    if (popup) {
      ctx.font = '700 20px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = popup.color;
      ctx.globalAlpha = Math.max(0, popup.t);
      ctx.shadowColor = popup.color;
      ctx.shadowBlur = 16;
      ctx.fillText(popup.text, W / 2, H * 0.3 - (1 - popup.t) * 30);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // aviso de caída
    if (over) {
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡CAÍSTE!', W / 2, H * 0.4);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerup', release);
  };
}

/* ============================================================
   DÚO NEÓN (estilo Duet)
   Dos esferas orbitan un eje. Toca la mitad izquierda o derecha de
   la pantalla para girarlas y esquiva los bloques que caen. Un
   golpe y se acabó.
   ============================================================ */
function gameDuet(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'TOCA IZQUIERDA / DERECHA PARA GIRAR');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(340, r.height - 40);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const CX = W / 2;
  const ORBIT = Math.min(80, W * 0.23);
  const CY = H - ORBIT - 46;
  const ORB = 11;
  const SPIN = 4.4;               // rad/s
  const CYAN = '#00f4fe', PINK = '#ff007a';

  let angle = 0;                  // esferas empiezan en horizontal
  let dir = 0;                    // -1 izquierda, +1 derecha
  let obstacles = [];             // { x, w, y, h, angle, spin, counted }
  let trail = [];
  let t = 0;
  let untilSpawn = 0.6;
  let score = 0;
  let passed = 0;
  let over = false;
  let hitAt = null;               // { x, y, color }
  let notice = null;              // aviso de subida de nivel { text, t }
  let level = 0;
  let raf = null;
  let last = performance.now();

  /* subida de dificultad por fases */
  const LEVELS = [
    [10, '¡PIEZAS GIRATORIAS!'],
    [22, '¡MÁS RÁPIDO!'],
    [38, '¡MODO FRENESÍ!'],
  ];

  /* probabilidad y velocidad de giro crecen con la partida */
  function makeSpin() {
    if (t < LEVELS[0][0]) return 0;
    const chance = Math.min(0.85, 0.35 + (t - LEVELS[0][0]) * 0.02);
    if (rng() > chance) return 0;
    const sgn = rng() < 0.5 ? -1 : 1;
    return sgn * (0.6 + rng() * 0.8 + Math.min(1.4, t * 0.02));
  }

  /* patrones esquivables: pared izquierda/derecha (esferas en vertical),
     bloque central ancho o estrecho (esferas en horizontal), o laterales dobles.
     Los bloques centrales pueden girar sobre sí mismos. */
  function spawn() {
    const kind = Math.floor(rng() * 5);
    const h = 26;
    const y = -h - 10;
    if (kind === 0) {
      obstacles.push({ x: CX - ORBIT * 0.75, w: ORBIT * 1.5, y, h, angle: 0, spin: makeSpin(), counted: false });
    } else if (kind === 1) {
      obstacles.push({ x: 0, w: CX - ORBIT * 0.4, y, h, angle: 0, spin: 0, counted: false });
    } else if (kind === 2) {
      obstacles.push({ x: CX + ORBIT * 0.4, w: W - (CX + ORBIT * 0.4), y, h, angle: 0, spin: 0, counted: false });
    } else if (kind === 3) {
      obstacles.push({ x: CX - 24, w: 48, y, h, angle: 0, spin: makeSpin() * 1.5, counted: false });
    } else {
      // el hueco central se estrecha con el tiempo
      const gap = ORBIT * Math.max(0.9, 1.15 - t * 0.004);
      obstacles.push({ x: 0, w: CX - gap / 2, y, h, angle: 0, spin: 0, counted: false });
      obstacles.push({ x: CX + gap / 2, w: W - (CX + gap / 2), y, h, angle: 0, spin: 0, counted: true }); // solo puntúa una del par
    }
  }

  function orbPos(k) { // k = 0 | 1
    const a = angle + k * Math.PI;
    return { x: CX + Math.cos(a) * ORBIT, y: CY + Math.sin(a) * ORBIT };
  }

  function hitTest(o, p) {
    // círculo contra rectángulo rotado: pasar la esfera al sistema local de la pieza
    const rcx = o.x + o.w / 2, rcy = o.y + o.h / 2;
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const dx = p.x - rcx, dy = p.y - rcy;
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    const nx = Math.max(-o.w / 2, Math.min(lx, o.w / 2));
    const ny = Math.max(-o.h / 2, Math.min(ly, o.h / 2));
    return (lx - nx) ** 2 + (ly - ny) ** 2 < ORB * ORB;
  }

  function setDir(clientX) {
    const r = canvas.getBoundingClientRect();
    dir = clientX < r.left + r.width / 2 ? -1 : 1;
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); setDir(e.clientX); });
  canvas.addEventListener('pointermove', (e) => { if (dir !== 0) setDir(e.clientX); });
  const stop = () => { dir = 0; };
  window.addEventListener('pointerup', stop);
  const onKey = (e) => {
    if (e.type === 'keydown') {
      if (e.key === 'ArrowLeft') dir = -1;
      if (e.key === 'ArrowRight') dir = 1;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') dir = 0;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  function step(dt) {
    if (over) return;
    t += dt;
    angle += dir * SPIN * dt;

    // aviso al subir de nivel
    if (level < LEVELS.length && t >= LEVELS[level][0]) {
      notice = { text: LEVELS[level][1], t: 1.6 };
      level++;
    }
    if (notice) { notice.t -= dt; if (notice.t <= 0) notice = null; }

    const speed = Math.min(430, 170 + t * 8);
    untilSpawn -= dt;
    if (untilSpawn <= 0) {
      spawn();
      untilSpawn = Math.max(0.62, 1.55 - t * 0.018) + rng() * 0.25;
    }

    const p0 = orbPos(0), p1 = orbPos(1);
    trail.push([p0.x, p0.y, p1.x, p1.y]);
    if (trail.length > 14) trail.shift();

    for (const o of obstacles) {
      o.y += speed * dt;
      o.angle += o.spin * dt;
      if (!o.counted && o.y > CY + ORBIT + ORB) {
        o.counted = true;
        passed++;
        score += 100;
        api.setScore(score);
      }
      if (hitTest(o, p0)) { hitAt = { ...p0, color: CYAN }; }
      else if (hitTest(o, p1)) { hitAt = { ...p1, color: PINK }; }
      if (hitAt) break;
    }
    obstacles = obstacles.filter(o => o.y < H + 60);

    if (hitAt) {
      over = true;
      setTimeout(() => api.finish(score, `${passed} bloques esquivados`), 700);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // órbita guía
    ctx.strokeStyle = 'rgba(218,226,253,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, ORBIT, 0, Math.PI * 2);
    ctx.stroke();

    // bloques (con rotación)
    for (const o of obstacles) {
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      ctx.rotate(o.angle);
      ctx.fillStyle = '#dae2fd';
      ctx.shadowColor = o.spin ? '#ebb2ff' : '#dae2fd';
      ctx.shadowBlur = o.spin ? 16 : 10;
      ctx.beginPath();
      ctx.roundRect(-o.w / 2, -o.h / 2, o.w, o.h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // estelas
    trail.forEach(([x0, y0, x1, y1], i) => {
      const a = (i / trail.length) * 0.35;
      ctx.globalAlpha = a;
      ctx.fillStyle = CYAN;
      ctx.beginPath(); ctx.arc(x0, y0, ORB * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PINK;
      ctx.beginPath(); ctx.arc(x1, y1, ORB * 0.7, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // esferas
    const p0 = orbPos(0), p1 = orbPos(1);
    [[p0, CYAN], [p1, PINK]].forEach(([p, c]) => {
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(p.x, p.y, ORB, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });

    // aviso de subida de nivel
    if (notice) {
      ctx.font = '800 26px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ebb2ff';
      ctx.globalAlpha = Math.min(1, notice.t * 2);
      ctx.shadowColor = '#bc13fe';
      ctx.shadowBlur = 22;
      ctx.fillText(notice.text, W / 2, H * 0.28);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // impacto: salpicadura y aviso
    if (hitAt) {
      ctx.fillStyle = hitAt.color;
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(hitAt.x + Math.cos(a) * 16, hitAt.y + Math.sin(a) * 16, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡TOCADO!', W / 2, H * 0.35);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  };
}

/* ============================================================
   ESCALERA INFINITA (estilo Infinite Stairs)
   Sube la escalera en zigzag: SUBIR avanza en tu dirección,
   GIRAR cambia de lado y sube. Un paso al vacío o quedarte sin
   energía termina la partida. El desgaste crece con la altura.
   ============================================================ */
function gameStairs(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const powerWrap = el('div', 'flip-power');
  const powerFill = el('div', 'flip-power-fill');
  powerWrap.append(powerFill);
  const controls = el('div', 'stairs-controls');
  const btnTurn = el('button', 'btn-3d btn-pink', '⟲ GIRAR');
  const btnUp = el('button', 'btn-3d btn-cyan', '⬆ SUBIR');
  controls.append(btnTurn, btnUp);
  wrap.append(canvas, powerWrap, controls);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(300, r.height - 128);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const U = Math.min(46, W * 0.13);   // paso horizontal
  const SH = U * 0.62;                // alto de cada escalón
  const avatar = (typeof state !== 'undefined' && state.profile) ? state.profile.avatar : '🦊';
  const CYAN = '#00f4fe', PINK = '#ff007a';

  /* dirección del tramo i→i+1, generada perezosamente con la semilla diaria */
  const dirs = [];
  function dirAt(i) {
    while (dirs.length <= i) {
      const prev = dirs.length ? dirs[dirs.length - 1] : (rng() < 0.5 ? -1 : 1);
      dirs.push(rng() < 0.42 ? -prev : prev);
    }
    return dirs[i];
  }

  /* posiciones de los escalones en el mundo */
  const pos = [{ x: 0, y: 0 }];
  function posAt(i) {
    while (pos.length <= i) {
      const k = pos.length - 1;
      pos.push({ x: pos[k].x + dirAt(k) * U, y: pos[k].y - SH });
    }
    return pos[i];
  }

  let idx = 0;
  let facing = dirAt(0);              // empiezas mirando al primer tramo
  let energy = 100;
  let steps = 0;
  let score = 0;
  let over = false;
  let deathMsg = '';
  let fall = null;                    // { x, y, vy }
  let cam = { x: 0, y: 0 };
  let raf = null;
  let last = performance.now();

  function die(msg) {
    if (over) return;
    over = true;
    deathMsg = msg;
    setTimeout(() => api.finish(score, `${steps} escalones subidos`), 850);
  }

  function move(turn) {
    if (over || api.done) return;
    if (turn) facing = -facing;
    if (facing === dirAt(idx)) {
      idx++;
      posAt(idx);
      steps++;
      score += 10;
      api.setScore(score);
      energy = Math.min(100, energy + 9);
    } else {
      // paso al vacío
      const p = posAt(idx);
      fall = { x: p.x + facing * U, y: p.y, vy: -140 };
      die('¡AL VACÍO!');
    }
  }

  btnUp.addEventListener('pointerdown', (e) => { e.preventDefault(); move(false); });
  btnTurn.addEventListener('pointerdown', (e) => { e.preventDefault(); move(true); });
  const onKey = (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === ' ') move(false);
    if (e.key === 'ArrowLeft') move(true);
  };
  window.addEventListener('keydown', onKey);

  function step(dt) {
    if (!over) {
      // el desgaste crece con la altura: cada vez hay que subir más rápido
      energy -= dt * (9 + steps * 0.045);
      if (energy <= 0) { energy = 0; die('¡SIN ENERGÍA!'); }
    }
    powerFill.style.width = `${energy}%`;
    if (fall) {
      fall.vy += 1500 * dt;
      fall.y += fall.vy * dt;
    }
    const target = fall || posAt(idx);
    cam.x += (target.x - cam.x) * Math.min(1, dt * 10);
    cam.y += (target.y - cam.y) * Math.min(1, dt * 10);
  }

  function toScreen(p) {
    return { x: W / 2 + (p.x - cam.x), y: H * 0.62 + (p.y - cam.y) };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // escalones visibles
    for (let i = Math.max(0, idx - 8); i <= idx + 14; i++) {
      const s = toScreen(posAt(i));
      if (s.y < -30 || s.y > H + 30) continue;
      ctx.fillStyle = '#171f33';
      ctx.strokeStyle = i === idx ? CYAN : 'rgba(0,244,254,0.55)';
      ctx.lineWidth = i === idx ? 2.5 : 1.5;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = i === idx ? 14 : 7;
      ctx.beginPath();
      ctx.roundRect(s.x - U * 0.46, s.y, U * 0.92, 13, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // personaje (o cayendo)
    const cp = fall ? toScreen(fall) : toScreen(posAt(idx));
    ctx.save();
    ctx.translate(cp.x, cp.y - 17);
    if (fall) ctx.rotate((fall.vy / 900) * 0.8);
    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ebb2ff';
    ctx.shadowBlur = 14;
    ctx.fillText(avatar, 0, 0);
    ctx.restore();

    // flecha de dirección actual
    if (!over) {
      ctx.fillStyle = facing === dirAt(idx) ? CYAN : PINK;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      const ax = cp.x + facing * 24, ay = cp.y - 34;
      ctx.moveTo(ax, ay - 6);
      ctx.lineTo(ax + facing * 10, ay);
      ctx.lineTo(ax, ay + 6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // altura
    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(218,226,253,0.55)';
    ctx.fillText(`ALTURA ${steps}`, 12, 22);

    if (over && deathMsg) {
      ctx.font = '800 32px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText(deathMsg, W / 2, H * 0.32);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
  };
}

/* ============================================================
   TUKTUK DODGE — Bangkok Run (port fiel del juego de Base44)
   Esquiva-carriles cenital: el tuk-tuk va abajo y cambia de
   carril (toca izquierda/derecha o flechas) para esquivar
   elefantes, motos y artistas. Puntúas por tiempo + por cada
   esquive; la velocidad rampa de START a MAX. Un golpe y fin.
   ============================================================ */
function gameTuktuk(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'TOCA IZQUIERDA / DERECHA PARA CAMBIAR DE CARRIL');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(340, r.height - 40);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  // ---------- config (portada de config.js) ----------
  const LANE_COUNT = 4;
  const ROAD_WIDTH = Math.min(W * 0.78, 340);
  const ROAD_LEFT = (W - ROAD_WIDTH) / 2;
  const LANE_WIDTH = ROAD_WIDTH / LANE_COUNT;
  const laneX = (l) => ROAD_LEFT + LANE_WIDTH * (l + 0.5);
  const PLAYER_START_LANE = Math.floor(LANE_COUNT / 2);
  const PLAYER_Y = H - 84;

  const DIFFICULTY_RAMP_SECONDS = 45;
  const OBSTACLE_SPEED_START = 250;   // px/s (a 768 de alto lógico)
  const OBSTACLE_SPEED_MAX = 620;
  const SPAWN_MAX_DELAY = 1.25;
  const SPAWN_MIN_DELAY = 0.62;
  const SPAWN_MIN_FLOOR = 0.5;
  const SCORE_PER_DODGE = 25;
  const SCORE_TICK_MS = 200;
  const SCORE_TICK_VALUE = 2;

  // colores del original (PALETTE / fallback textures)
  const GRASS = '#14532d', ROADC = '#2b3547', STRIPE = '#fbbf24';
  const SPARK_TINT = ['#fbbf24', '#f97316', '#ec4899', '#3b82f6', '#10b981'];
  // roster de obstáculos: emoji + glow del color de su textura fallback.
  // weight = probabilidad relativa; spin = giro por frame (solo el artista gira).
  const OBSTACLES = [
    { emoji: '🏍️', glow: '#3b82f6', size: 34, weight: 5, spin: 0,    name: 'moto' },
    { emoji: '💃', glow: '#ec4899', size: 36, weight: 3, spin: 0.6,  name: 'artista' },
    { emoji: '🐘', glow: '#6b7280', size: 46, weight: 2, spin: 0,    name: 'elefante' },
  ];
  const TOTAL_WEIGHT = OBSTACLES.reduce((s, o) => s + o.weight, 0);
  function pickObstacle() {
    let r = rng() * TOTAL_WEIGHT;
    for (const o of OBSTACLES) { if (r < o.weight) return o; r -= o.weight; }
    return OBSTACLES[0];
  }

  const scaleY = H / 768;

  let playerLane = PLAYER_START_LANE;
  let playerX = laneX(playerLane);
  let obstacles = [];            // { lane, y, o, rot, passed }
  let sparks = [];               // { x, y, vx, vy, life, color }
  let palms = [];                // decorado lateral { x, y, r }
  let stripeScroll = 0;
  let elapsedSec = 0;
  let sinceScoreTick = 0;
  let untilSpawn = 0.5;
  let score = 0;
  let dodged = 0;
  let over = false;
  let crashAt = null;
  let flashT = 0;
  let raf = null;
  let last = performance.now();

  // palmeras iniciales en los arcenes (se reciclan al bajar)
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? ROAD_LEFT - 34 : ROAD_LEFT + ROAD_WIDTH + 34;
    palms.push({ x: side, y: (i / 8) * (H + 200) - 100, r: 22 });
  }

  function difficulty() { return Math.min(1, elapsedSec / DIFFICULTY_RAMP_SECONDS); }

  function moveLane(dir) {
    if (over) return;
    playerLane = Math.max(0, Math.min(LANE_COUNT - 1, playerLane + dir));
  }

  function setLaneFromX(clientX) {
    const r = canvas.getBoundingClientRect();
    moveLane(clientX - r.left < r.width / 2 ? -1 : 1);
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!over) setLaneFromX(e.clientX); });
  const onKey = (e) => {
    if (e.repeat || over) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveLane(-1);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveLane(1);
  };
  window.addEventListener('keydown', onKey);

  function spawnObstacle() {
    // tipo por peso; un obstáculo en carril al azar.
    const type = pickObstacle();
    const lane = Math.floor(rng() * LANE_COUNT);
    obstacles.push({ lane, y: -60, o: type, rot: 0, passed: false });
    // bonus: con dificultad > 0.4, a veces un segundo en otro carril, escalonado.
    if (difficulty() > 0.4 && rng() < 0.25) {
      let lane2;
      do { lane2 = Math.floor(rng() * LANE_COUNT); } while (lane2 === lane);
      obstacles.push({ lane: lane2, y: -60 - (60 + rng() * 140), o: type, rot: 0, passed: false });
    }
  }

  function burst(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const sp = 80 + rng() * 140;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, color: SPARK_TINT[Math.floor(rng() * SPARK_TINT.length)] });
    }
  }

  function crash(x, y) {
    if (over) return;
    over = true;
    crashAt = { x, y };
    flashT = 0.4;
    setTimeout(() => api.finish(score, `${dodged} obstáculos esquivados`), 700);
  }

  function step(dt) {
    if (over) { if (flashT > 0) flashT = Math.max(0, flashT - dt); return; }
    elapsedSec += dt;
    const diff = difficulty();

    // marcador por tiempo
    sinceScoreTick += dt * 1000;
    while (sinceScoreTick >= SCORE_TICK_MS) {
      sinceScoreTick -= SCORE_TICK_MS;
      score += SCORE_TICK_VALUE;
    }

    // tuk-tuk se desliza al carril objetivo
    playerX += (laneX(playerLane) - playerX) * Math.min(1, dt * 16);

    // scroll de rayas y palmeras
    const speedMul = 1 + diff * 1.5;
    stripeScroll = (stripeScroll + 240 * speedMul * dt) % 80;
    palms.forEach(p => {
      p.y += 200 * speedMul * dt;
      if (p.y > H + 40) { p.y = -40; p.x = rng() < 0.5 ? ROAD_LEFT - 34 : ROAD_LEFT + ROAD_WIDTH + 34; }
    });

    // spawn (delay se encoge con la dificultad)
    untilSpawn -= dt;
    if (untilSpawn <= 0) {
      spawnObstacle();
      const maxDelay = SPAWN_MAX_DELAY - (SPAWN_MAX_DELAY - SPAWN_MIN_FLOOR) * diff;
      const minDelay = Math.max(SPAWN_MIN_FLOOR, SPAWN_MIN_DELAY - diff * 0.3);
      untilSpawn = minDelay + rng() * Math.max(0, maxDelay - minDelay);
    }

    // mover obstáculos: velocidad = START * (1 + diff*1.5), como el original
    const speed = Math.min(OBSTACLE_SPEED_MAX, OBSTACLE_SPEED_START * speedMul) * scaleY;
    for (const ob of obstacles) {
      ob.y += speed * dt;
      ob.rot += ob.o.spin * dt * 8;            // el artista gira sobre sí mismo
      const ox = laneX(ob.lane);
      // colisión (mismo carril, solape vertical con el tuk-tuk)
      if (!over && Math.abs(ob.lane - playerLane) < 0.5 && Math.abs(ob.y - PLAYER_Y) < 40 && Math.abs(ox - playerX) < LANE_WIDTH * 0.5) {
        crash(playerX, PLAYER_Y);
      }
      // esquivado: al pasar al jugador. Chispa si venía de un carril ADYACENTE.
      if (!ob.passed && ob.y > PLAYER_Y + 60) {
        ob.passed = true;
        dodged++;
        score += SCORE_PER_DODGE;
        if (Math.abs(ob.lane - playerLane) === 1) burst(laneX(playerLane), PLAYER_Y);
      }
    }
    obstacles = obstacles.filter(o => o.y < H + 80);
    api.setScore(score);

    // chispas
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    sparks = sparks.filter(s => s.life > 0);
  }

  function draw() {
    // hierba de fondo
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, W, H);

    // palmeras (siluetas de círculos verdes)
    palms.forEach(p => {
      ctx.fillStyle = '#166534';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#15803d';
      ctx.beginPath(); ctx.arc(p.x, p.y - 16, p.r * 0.7, 0, Math.PI * 2); ctx.fill();
    });

    // asfalto
    ctx.fillStyle = ROADC;
    ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, H);
    // bordes blancos
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(ROAD_LEFT, 0, 4, H);
    ctx.fillRect(ROAD_LEFT + ROAD_WIDTH - 4, 0, 4, H);

    // rayas de carril discontinuas amarillas
    ctx.fillStyle = STRIPE;
    for (let l = 1; l < LANE_COUNT; l++) {
      const x = ROAD_LEFT + LANE_WIDTH * l - 3;
      for (let y = -80 + stripeScroll; y < H; y += 80) {
        ctx.fillRect(x, y, 6, 40);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // obstáculos (el artista gira con ob.rot)
    for (const ob of obstacles) {
      ctx.save();
      ctx.translate(laneX(ob.lane), ob.y);
      if (ob.rot) ctx.rotate(ob.rot);
      ctx.font = `${ob.o.size}px serif`;
      ctx.shadowColor = ob.o.glow;
      ctx.shadowBlur = 14;
      ctx.fillText(ob.o.emoji, 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // chispas
    for (const s of sparks) {
      ctx.globalAlpha = Math.max(0, s.life / 0.6);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // tuk-tuk (mirando hacia arriba)
    ctx.font = '40px serif';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 16;
    ctx.fillText('🛺', playerX, PLAYER_Y);
    ctx.shadowBlur = 0;

    // marcador de esquivados arriba
    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`ESQUIVADOS ${dodged}`, 12, 20);

    if (crashAt) {
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.fillText('💥', crashAt.x, crashAt.y);
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡CHOQUE!', W / 2, H * 0.32);
      ctx.shadowBlur = 0;
    }

    if (flashT > 0) {
      ctx.fillStyle = `rgba(255,68,68,${flashT})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
  };
}

/* ============================================================
   JUMPY NEÓN (estilo Doodle Jump / "Jumpy")
   Rebotas sin parar: guía al personaje con izquierda/derecha para
   aterrizar en las plataformas y subir lo más alto posible. Hay
   plataformas móviles, muelles que impulsan y bordes que teletransportan.
   Si caes al vacío, fin de la partida.
   ============================================================ */
function gameJumpy(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'MANTÉN IZQUIERDA / DERECHA PARA MOVERTE');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(340, r.height - 40);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const G = 1800;
  const BOUNCE = -760;
  const SPRING = -1180;
  const PW = 64, PH = 12;
  const CYAN = '#00f4fe', PINK = '#ff007a', PURPLE = '#bc13fe';
  const avatar = (typeof state !== 'undefined' && state.profile) ? state.profile.avatar : '🦊';

  let px = W / 2, py = H - 90;
  let vx = 0, vy = BOUNCE;
  let move = 0;                  // -1 | 0 | +1
  let ascent = 0;                // desplazamiento total de cámara (altura ganada)
  let genY = H - 40;             // siguiente altura (en mundo-pantalla) donde generar plataforma
  let platforms = [];            // { x, y, w, type: 'normal'|'move'|'spring', dir, hitFlash }
  let score = 0;
  let over = false;
  let raf = null;
  let last = performance.now();

  function difficulty() { return ascent; }

  function addPlatform(y) {
    const h = difficulty();
    const type = (h > 700 && rng() < Math.min(0.35, 0.08 + h * 0.00006)) ? 'move'
      : (rng() < 0.09 ? 'spring' : 'normal');
    platforms.push({
      x: rng() * (W - PW),
      y,
      w: PW,
      type,
      dir: rng() < 0.5 ? -1 : 1,
    });
  }

  // suelo inicial + plataformas hacia arriba (más densas al principio)
  platforms.push({ x: W / 2 - PW / 2, y: H - 60, w: PW, type: 'normal', dir: 1 });
  while (genY > -H) {
    genY -= (genY > H * 0.35 ? 42 + rng() * 16 : 52 + rng() * 26);
    addPlatform(genY);
  }

  function setMove(clientX) {
    const r = canvas.getBoundingClientRect();
    move = clientX < r.left + r.width / 2 ? -1 : 1;
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); setMove(e.clientX); });
  canvas.addEventListener('pointermove', (e) => { if (move !== 0) setMove(e.clientX); });
  const stopMove = () => { move = 0; };
  window.addEventListener('pointerup', stopMove);
  const onKey = (e) => {
    if (e.type === 'keydown') {
      if (e.key === 'ArrowLeft') move = -1;
      if (e.key === 'ArrowRight') move = 1;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') move = 0;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  function step(dt) {
    if (over) return;

    vx += (move * 300 - vx) * Math.min(1, dt * 10);
    px += vx * dt;
    // los bordes teletransportan al lado contrario (clásico del género)
    if (px < -14) px = W + 14;
    if (px > W + 14) px = -14;

    vy += G * dt;
    py += vy * dt;

    // rebote solo cayendo
    if (vy > 0) {
      for (const p of platforms) {
        if (px > p.x - 12 && px < p.x + p.w + 12 && py + 16 > p.y && py + 16 < p.y + PH + vy * dt + 4) {
          if (p.type === 'spring') { vy = SPRING; p.hitFlash = 0.5; }
          else { vy = BOUNCE; p.hitFlash = 0.25; }
          py = p.y - 16;
          break;
        }
      }
    }

    // plataformas móviles: más rápidas cuanto más alto
    const mvSpeed = 60 + Math.min(120, difficulty() * 0.02);
    for (const p of platforms) {
      if (p.type === 'move') {
        p.x += p.dir * mvSpeed * dt;
        if (p.x < 0) { p.x = 0; p.dir = 1; }
        if (p.x + p.w > W) { p.x = W - p.w; p.dir = -1; }
      }
      if (p.hitFlash) p.hitFlash = Math.max(0, p.hitFlash - dt);
    }

    // cámara: al superar el 45% de la pantalla, el mundo baja
    const lift = H * 0.45 - py;
    if (lift > 0) {
      py += lift;
      ascent += lift;
      genY += lift;
      platforms.forEach(p => { p.y += lift; });
      score = Math.round(ascent / 4);
      api.setScore(score);
      // generar nuevas plataformas arriba (separación crece con la altura)
      while (genY > -60) {
        genY -= 52 + Math.min(52, difficulty() * 0.01) + rng() * 26;
        addPlatform(genY);
      }
    }
    platforms = platforms.filter(p => p.y < H + 30);

    if (py > H + 40) {
      over = true;
      setTimeout(() => api.finish(score, `${Math.round(ascent / 30)} m de altura`), 700);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // rejilla que se desplaza con la subida
    ctx.strokeStyle = 'rgba(235,178,255,0.06)';
    ctx.lineWidth = 1;
    const gs = 40;
    const gy = (ascent % gs);
    for (let y = gy - gs; y < H; y += gs) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let x = 0; x < W; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // plataformas
    for (const p of platforms) {
      const col = p.type === 'spring' ? PINK : p.type === 'move' ? PURPLE : CYAN;
      ctx.fillStyle = '#171f33';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.shadowColor = col;
      ctx.shadowBlur = p.hitFlash ? 20 : 9;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, PH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (p.type === 'spring') {
        ctx.font = '11px serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = PINK;
        ctx.fillText('▲', p.x + p.w / 2, p.y - 4);
      }
    }

    // personaje
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.max(-0.25, Math.min(0.25, vx / 1200)));
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ebb2ff';
    ctx.shadowBlur = 14;
    ctx.fillText(avatar, 0, 0);
    ctx.restore();

    // altura
    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(218,226,253,0.55)';
    ctx.fillText(`${Math.round(ascent / 30)} m`, 12, 22);

    if (over) {
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡CAÍSTE!', W / 2, H * 0.4);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerup', stopMove);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  };
}

/* ============================================================
   CRUCE LOCO (estilo Trafix)
   Dirige el tráfico del cruce: toca un coche para frenarlo y
   vuelve a tocarlo para arrancarlo. Cada coche que cruza suma;
   un choque y se acabó. El tráfico crece con el tiempo.
   ============================================================ */
function gameTrafix(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'TOCA UN COCHE PARA FRENARLO / ARRANCARLO');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(340, r.height - 40);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const CX = W / 2, CY = H / 2;
  const LO = 16;                 // separación del carril al eje
  const ROAD = 62;               // ancho de calzada
  const CAR_L = 30, CAR_W = 17;
  const COLORS = ['#00f4fe', '#ff007a', '#bc13fe', '#3dff9a'];

  /* streams: 0 arriba→abajo, 1 abajo→arriba, 2 izq→dcha, 3 dcha→izq */
  const LEN = [H + 60, H + 60, W + 60, W + 60];
  function carPos(c) {
    if (c.stream === 0) return { x: CX - LO, y: c.d - 30 };
    if (c.stream === 1) return { x: CX + LO, y: H + 30 - c.d };
    if (c.stream === 2) return { x: c.d - 30, y: CY + LO };
    return { x: W + 30 - c.d, y: CY - LO };
  }
  function carRect(c) {
    const p = carPos(c);
    return c.stream < 2
      ? { x: p.x - CAR_W / 2, y: p.y - CAR_L / 2, w: CAR_W, h: CAR_L }
      : { x: p.x - CAR_L / 2, y: p.y - CAR_W / 2, w: CAR_L, h: CAR_W };
  }

  let cars = [];
  let nextId = 1;
  let spawnT = [0.2, 1.1, 0.6, 1.6];
  let t = 0;
  let score = 0;
  let passed = 0;
  let over = false;
  let crashP = null;
  let notice = null;
  let level = 0;
  let raf = null;
  let last = performance.now();

  const LEVELS = [[18, '¡MÁS TRÁFICO!'], [36, '¡HORA PUNTA!']];

  canvas.addEventListener('pointerdown', (e) => {
    if (over) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 34;
    for (const c of cars) {
      const p = carPos(c);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) best.stopped = !best.stopped;
  });

  function crash(a, b) {
    if (over) return;
    over = true;
    const pa = carPos(a);
    crashP = { x: pa.x, y: pa.y };
    setTimeout(() => api.finish(score, `${passed} coches cruzaron`), 850);
  }

  function step(dt) {
    if (over) return;
    t += dt;

    if (level < LEVELS.length && t >= LEVELS[level][0]) {
      notice = { text: LEVELS[level][1], t: 1.6 };
      level++;
    }
    if (notice) { notice.t -= dt; if (notice.t <= 0) notice = null; }

    // aparición de coches por stream
    const pace = Math.max(0.5, 1 - t * 0.007);
    for (let s = 0; s < 4; s++) {
      spawnT[s] -= dt;
      if (spawnT[s] <= 0) {
        const lastCar = cars.filter(c => c.stream === s).sort((a, b) => a.d - b.d)[0];
        if (!lastCar || lastCar.d > 55) {
          cars.push({ id: nextId++, stream: s, d: 0, stopped: false, v: 0, color: COLORS[Math.floor(rng() * COLORS.length)] });
          spawnT[s] = (1.3 + rng() * 1.6) * pace;
        } else {
          spawnT[s] = 0.3;
        }
      }
    }

    // movimiento con frenado y cola
    const SPEED = Math.min(210, 120 + t * 2);
    for (const c of cars) {
      const ahead = cars
        .filter(o => o.stream === c.stream && o.d > c.d)
        .sort((a, b) => a.d - b.d)[0];
      const blocked = c.stopped || (ahead && ahead.d - c.d < 44);
      const target = blocked ? 0 : SPEED;
      c.v += (target - c.v) * Math.min(1, dt * 8);
      c.d += c.v * dt;
    }

    // choques entre streams distintos (solo cerca del cruce)
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.stream === b.stream) continue;
        const ra = carRect(a), rb = carRect(b);
        if (ra.x < rb.x + rb.w && ra.x + ra.w > rb.x && ra.y < rb.y + rb.h && ra.y + ra.h > rb.y) {
          crash(a, b);
        }
      }
    }

    // coches que completan el recorrido
    const before = cars.length;
    cars = cars.filter(c => {
      if (c.d > LEN[c.stream]) {
        passed++;
        score += 40;
        return false;
      }
      return true;
    });
    if (cars.length !== before) api.setScore(score);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // calzadas
    ctx.fillStyle = '#060e20';
    ctx.fillRect(CX - ROAD / 2, 0, ROAD, H);
    ctx.fillRect(0, CY - ROAD / 2, W, ROAD);
    // bordes con glow
    ctx.strokeStyle = 'rgba(0,244,254,0.4)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00f4fe';
    ctx.shadowBlur = 6;
    [[CX - ROAD / 2, 0, CX - ROAD / 2, CY - ROAD / 2], [CX + ROAD / 2, 0, CX + ROAD / 2, CY - ROAD / 2],
     [CX - ROAD / 2, CY + ROAD / 2, CX - ROAD / 2, H], [CX + ROAD / 2, CY + ROAD / 2, CX + ROAD / 2, H],
     [0, CY - ROAD / 2, CX - ROAD / 2, CY - ROAD / 2], [CX + ROAD / 2, CY - ROAD / 2, W, CY - ROAD / 2],
     [0, CY + ROAD / 2, CX - ROAD / 2, CY + ROAD / 2], [CX + ROAD / 2, CY + ROAD / 2, W, CY + ROAD / 2]]
      .forEach(([x0, y0, x1, y1]) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); });
    ctx.shadowBlur = 0;

    // líneas centrales discontinuas
    ctx.strokeStyle = 'rgba(235,178,255,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 18]);
    ctx.beginPath(); ctx.moveTo(CX, 0); ctx.lineTo(CX, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(W, CY); ctx.stroke();
    ctx.setLineDash([]);

    // coches
    for (const c of cars) {
      const r = carRect(c);
      ctx.fillStyle = c.stopped ? '#31394d' : '#171f33';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = c.stopped ? 4 : 12;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (c.stopped) {
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (notice) {
      ctx.font = '800 26px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ebb2ff';
      ctx.globalAlpha = Math.min(1, notice.t * 2);
      ctx.shadowColor = '#bc13fe';
      ctx.shadowBlur = 22;
      ctx.fillText(notice.text, W / 2, H * 0.16);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    if (crashP) {
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💥', crashP.x, crashP.y);
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡CHOQUE!', W / 2, H * 0.3);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => cancelAnimationFrame(raf);
}

/* ============================================================
   BOL GLOTÓN (atrapa la comida, esquiva lo tóxico)
   Mueve el bol siguiendo tu dedo y recoge la comida que cae.
   Los objetos tóxicos restan una vida (tienes 3). La lluvia se
   acelera con el tiempo.
   ============================================================ */
function gameBowl(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'ARRASTRA PARA MOVER EL BOL · EVITA LO TÓXICO');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(340, r.height - 40);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const FOOD = ['🍣', '🍜', '🍎', '🍕', '🥭', '🍤', '🍩', '🍇'];
  const TOXIC = ['☠️', '🧪', '🧨', '🗑️'];
  const BOWL_Y = H - 56;
  const CATCH_R = 36;

  let bowlX = W / 2;
  let targetX = W / 2;
  let items = [];              // { x, y, vy, emoji, toxic, spin }
  let t = 0;
  let untilSpawn = 0.4;
  let score = 0;
  let caught = 0;
  let lives = 3;
  let over = false;
  let flash = null;            // { color, t }
  let popup = null;            // { text, x, t, color }
  let raf = null;
  let last = performance.now();

  const track = (e) => {
    const r = canvas.getBoundingClientRect();
    targetX = Math.max(26, Math.min(W - 26, e.clientX - r.left));
  };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); track(e); });
  canvas.addEventListener('pointermove', track);
  let keyDir = 0;
  const onKey = (e) => {
    if (e.type === 'keydown') {
      if (e.key === 'ArrowLeft') keyDir = -1;
      if (e.key === 'ArrowRight') keyDir = 1;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keyDir = 0;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  function step(dt) {
    if (over) return;
    t += dt;

    if (keyDir) targetX = Math.max(26, Math.min(W - 26, targetX + keyDir * 420 * dt));
    bowlX += (targetX - bowlX) * Math.min(1, dt * 14);

    untilSpawn -= dt;
    if (untilSpawn <= 0) {
      const toxic = rng() < Math.min(0.38, 0.2 + t * 0.004);
      items.push({
        x: 24 + rng() * (W - 48),
        y: -24,
        vy: (150 + t * 5) * (0.85 + rng() * 0.4),
        emoji: toxic ? TOXIC[Math.floor(rng() * TOXIC.length)] : FOOD[Math.floor(rng() * FOOD.length)],
        toxic,
        spin: (rng() - 0.5) * 3,
      });
      untilSpawn = Math.max(0.3, 0.62 - t * 0.005) + rng() * 0.2;
    }

    for (const it of items) {
      it.y += it.vy * dt;
      // captura
      if (!it.done && Math.abs(it.y - BOWL_Y) < 20 && Math.abs(it.x - bowlX) < CATCH_R) {
        it.done = true;
        if (it.toxic) {
          lives--;
          flash = { color: 'rgba(255,84,112,0.35)', t: 0.4 };
          popup = { text: '☠️ −1 VIDA', x: it.x, t: 1, color: '#ff5470' };
          if (lives <= 0) {
            over = true;
            setTimeout(() => api.finish(score, `${caught} manjares atrapados`), 850);
          }
        } else {
          caught++;
          score += 50;
          api.setScore(score);
          popup = { text: '+50', x: it.x, t: 0.8, color: '#3dff9a' };
        }
      }
    }
    items = items.filter(it => !it.done && it.y < H + 30);

    if (flash) { flash.t -= dt; if (flash.t <= 0) flash = null; }
    if (popup) { popup.t -= dt; if (popup.t <= 0) popup = null; }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // objetos cayendo
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.spin * it.y / 100);
      ctx.font = '26px serif';
      if (it.toxic) {
        ctx.shadowColor = '#ff5470';
        ctx.shadowBlur = 12;
      }
      ctx.fillText(it.emoji, 0, 0);
      ctx.restore();
      ctx.shadowBlur = 0;
    }

    // bol
    ctx.font = '44px serif';
    ctx.shadowColor = '#00f4fe';
    ctx.shadowBlur = 16;
    ctx.fillText('🥣', bowlX, BOWL_Y + 8);
    ctx.shadowBlur = 0;

    // vidas
    ctx.font = '16px serif';
    ctx.textAlign = 'right';
    ctx.fillText('❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(3 - Math.max(0, lives)), W - 10, 22);
    ctx.textAlign = 'center';

    if (popup) {
      ctx.font = '700 18px Lexend, sans-serif';
      ctx.fillStyle = popup.color;
      ctx.globalAlpha = Math.max(0, popup.t);
      ctx.shadowColor = popup.color;
      ctx.shadowBlur = 12;
      ctx.fillText(popup.text, popup.x, BOWL_Y - 40 - (1 - popup.t) * 24);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    if (flash) {
      ctx.fillStyle = flash.color;
      ctx.fillRect(0, 0, W, H);
    }

    if (over) {
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡EMPACHO TÓXICO!', W / 2, H * 0.4);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  };
}

/* ============================================================
   CAÑA PERFECTA (tirar la cerveza correctamente)
   Mantén TIRAR para abrir el grifo: la presión sube sola y a más
   presión, más espuma. Suelta para que repose y pulsa SERVIR con
   la cerveza en la marca y dos dedos de espuma. 8 clientes, cada
   ronda con el grifo más bravo. Rebosar arruina la caña.
   ============================================================ */
function gameBeer(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const powerWrap = el('div', 'flip-power');
  const powerFill = el('div', 'flip-power-fill');
  powerWrap.append(powerFill);
  const controls = el('div', 'stairs-controls');
  const btnPour = el('button', 'btn-3d btn-pink', '🚰 TIRAR');
  const btnServe = el('button', 'btn-3d btn-cyan', '🍺 SERVIR');
  controls.append(btnPour, btnServe);
  wrap.append(canvas, powerWrap, controls);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width;
    H = Math.max(300, r.height - 128);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const ROUNDS = 8;
  const GX = W / 2 - 55, GY = H * 0.18, GW = 110, GH = H * 0.66;
  const FOAM_IDEAL = 0.12;      // "dos dedos" de espuma
  const CUSTOMERS = ['🧔', '👩', '👨‍🦳', '🧑‍🎤', '👵', '🧑‍🚀', '🕺', '🧙'];
  const ORDERS = [[0.6, 'UNA CAÑA'], [0.75, 'UN TUBO'], [0.88, 'UNA JARRA'], [0.68, 'UNA CAÑA LARGA']];

  let round = 0;
  let target = 0.6;
  let orderName = '';
  let level = 0;                // cerveza (0..1)
  let foam = 0;                 // espuma (fracción del vaso)
  let pouring = false;
  let pressure = 0;
  let score = 0;
  let perfects = 0;
  let streak = 0;
  let over = false;
  let spillT = 0;               // animación de derrame
  let msg = null;               // { text, color, t }
  let waiting = false;          // entre rondas
  let raf = null;
  let last = performance.now();

  function nextRound() {
    round++;
    if (round > ROUNDS) {
      over = true;
      setTimeout(() => api.finish(score, `${perfects} cañas perfectas de ${ROUNDS}`), 900);
      return;
    }
    const o = ORDERS[Math.floor(rng() * ORDERS.length)];
    target = o[0] + (rng() - 0.5) * 0.06;
    orderName = o[1];
    level = 0;
    foam = 0;
    pressure = 0;
    spillT = 0;
    waiting = false;
  }

  function serve() {
    if (over || waiting || api.done || spillT > 0) return;
    waiting = true;
    const levelErr = Math.abs(level - target);
    const foamErr = Math.abs(foam - FOAM_IDEAL);
    const ptsLevel = Math.max(0, Math.round(200 - levelErr * 1000));
    const ptsFoam = Math.max(0, Math.round(120 - foamErr * 900));
    let pts = ptsLevel + ptsFoam;
    const perfect = levelErr < 0.035 && foamErr < 0.045;
    if (perfect) {
      perfects++;
      streak++;
      pts += 50 * streak;
      msg = { text: `¡CAÑA PERFECTA! +${pts}`, color: '#3dff9a', t: 1.4 };
    } else {
      streak = 0;
      msg = { text: pts > 150 ? `¡Buena! +${pts}` : pts > 60 ? `Meh… +${pts}` : `Aguachirri +${pts}`, color: pts > 150 ? '#00f4fe' : '#ebb2ff', t: 1.4 };
    }
    score += pts;
    api.setScore(score);
    setTimeout(nextRound, 1200);
  }

  function spill() {
    if (spillT > 0 || waiting) return;
    spillT = 1;
    streak = 0;
    pouring = false;
    msg = { text: '¡REBOSA! Caña arruinada +0', color: '#ff5470', t: 1.4 };
    waiting = true;
    setTimeout(nextRound, 1400);
  }

  const startPour = (e) => { e.preventDefault(); if (!over && !waiting) pouring = true; };
  const stopPour = () => { pouring = false; };
  btnPour.addEventListener('pointerdown', startPour);
  window.addEventListener('pointerup', stopPour);
  btnServe.addEventListener('pointerdown', (e) => { e.preventDefault(); serve(); });
  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'ArrowDown') {
      if (e.type === 'keydown') { if (!over && !waiting) pouring = true; }
      else pouring = false;
    }
    if (e.key === 'Enter' && e.type === 'keydown') serve();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  function step(dt) {
    if (over) return;

    if (pouring && !waiting) {
      // la presión del grifo sube sola mientras tiras (cada ronda más rápido)
      const rampa = 1 + (round - 1) * 0.14;
      pressure = Math.min(1, pressure + dt / 0.8);
      level += (0.12 + pressure * 0.34) * rampa * dt;
      foam += (0.008 + pressure * pressure * 0.085) * rampa * dt;
    } else {
      pressure = Math.max(0, pressure - dt * 2.2);
      foam = Math.max(0, foam - dt * 0.03); // la espuma reposa
    }
    powerFill.style.width = `${pressure * 100}%`;

    if (level + foam > 1.03 && !waiting) spill();
    if (spillT > 0) spillT = Math.max(0, spillT - dt * 0.8);
    if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // cliente y pedido
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(CUSTOMERS[(round - 1 + CUSTOMERS.length) % CUSTOMERS.length], 30, GY - 26);
    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.fillStyle = '#00f4fe';
    ctx.textAlign = 'left';
    ctx.fillText(`CLIENTE ${Math.min(round, ROUNDS)}/${ROUNDS} · PIDE ${orderName}`, 56, GY - 26);
    ctx.textAlign = 'center';

    // vaso
    ctx.strokeStyle = 'rgba(0,244,254,0.8)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00f4fe';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(GX, GY, GW, GH, [4, 4, 14, 14]);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // cerveza
    const beerH = Math.min(1, level) * GH;
    if (beerH > 1) {
      const g = ctx.createLinearGradient(0, GY + GH - beerH, 0, GY + GH);
      g.addColorStop(0, '#ffcf40');
      g.addColorStop(1, '#e8930c');
      ctx.fillStyle = g;
      ctx.shadowColor = '#ffcf40';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.roundRect(GX + 3, GY + GH - beerH, GW - 6, beerH - 2, beerH > GH - 8 ? 3 : [0, 0, 12, 12]);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // espuma
    const foamH = foam * GH;
    if (foamH > 1) {
      const fy = GY + GH - beerH - foamH;
      ctx.fillStyle = '#fdf6e3';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(GX + 3, fy, GW - 6, foamH, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      // burbujas
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 5; i++) {
        const bx = GX + 14 + ((i * 37 + Math.floor(foamH * 7)) % (GW - 28));
        ctx.beginPath();
        ctx.arc(bx, fy + 4 + (i * 13) % Math.max(6, foamH - 6), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // marca objetivo
    const ty = GY + GH - target * GH;
    ctx.strokeStyle = '#ff007a';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.shadowColor = '#ff007a';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(GX - 16, ty);
    ctx.lineTo(GX + GW + 16, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.font = '700 10px Space Grotesk, monospace';
    ctx.fillStyle = '#ff007a';
    ctx.textAlign = 'left';
    ctx.fillText('MARCA', GX + GW + 20, ty);

    // medidor de espuma ideal (a la izquierda del vaso)
    const zoneTop = GY + GH - (target + FOAM_IDEAL + 0.045) * GH;
    const zoneBot = GY + GH - (target + FOAM_IDEAL - 0.045) * GH;
    ctx.fillStyle = 'rgba(61,255,154,0.25)';
    ctx.fillRect(GX - 14, zoneTop, 8, zoneBot - zoneTop);
    ctx.font = '700 9px Space Grotesk, monospace';
    ctx.fillStyle = '#3dff9a';
    ctx.textAlign = 'right';
    ctx.fillText('ESPUMA', GX - 18, (zoneTop + zoneBot) / 2);

    // grifo
    ctx.fillStyle = '#2d3449';
    ctx.strokeStyle = '#9d8ba0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 12, GY - 58, 24, 30, 6);
    ctx.fill(); ctx.stroke();
    if (pouring && !waiting) {
      // chorro
      ctx.fillStyle = 'rgba(255,207,64,0.9)';
      ctx.shadowColor = '#ffcf40';
      ctx.shadowBlur = 10;
      const jetTop = GY - 28;
      const jetBot = GY + GH - beerH - foamH;
      ctx.fillRect(W / 2 - 3, jetTop, 6, Math.max(0, jetBot - jetTop));
      ctx.shadowBlur = 0;
    }

    // derrame
    if (spillT > 0) {
      ctx.fillStyle = 'rgba(253,246,227,0.85)';
      ctx.beginPath();
      ctx.ellipse(W / 2, GY + GH + 14, 60 * (1 - spillT) + 20, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // mensaje de ronda
    if (msg) {
      ctx.font = '800 22px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = msg.color;
      ctx.globalAlpha = Math.min(1, msg.t * 2);
      ctx.shadowColor = msg.color;
      ctx.shadowBlur = 18;
      ctx.fillText(msg.text, W / 2, H * 0.1);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    if (over) {
      ctx.font = '800 30px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3dff9a';
      ctx.shadowColor = '#3dff9a';
      ctx.shadowBlur = 20;
      ctx.fillText('¡ÚLTIMA RONDA SERVIDA!', W / 2, H * 0.5);
      ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  nextRound();

  api.onQuit = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointerup', stopPour);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  };
}


/* ============================================================
   TORRE INFINITA (apila y crece un rascacielos)
   Un bloque se desliza; toca para soltarlo sobre la torre. Lo que
   sobresale se corta y el bloque se estrecha. Aciertos perfectos
   dan combo y recuperan anchura. Si fallas del todo, se derrumba.
   ============================================================ */
function gameTower(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'TOCA PARA SOLTAR EL BLOQUE');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width; H = Math.max(340, r.height - 40);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const BH = 26;                       // alto de cada planta
  const BASE_W = Math.min(W * 0.5, 190);
  let blocks = [];                     // { x, w } de abajo arriba
  let camY = 0;                        // desplazamiento de cámara (torre sube)
  let cur = null;                      // bloque en movimiento { x, w, dir, speed }
  let falling = [];                    // trozos recortados que caen
  let score = 0, floors = 0, streak = 0;
  let over = false, popup = null;
  let raf = null, last = performance.now();

  blocks.push({ x: (W - BASE_W) / 2, w: BASE_W });

  function spawnBlock() {
    const w = blocks[blocks.length - 1].w;
    const speed = 150 + floors * 6 + rng() * 40;
    cur = { x: 0, w, dir: 1, speed };
  }
  spawnBlock();

  function baseY() { return H - 40; }
  function blockY(i) { return baseY() - i * BH + camY; }

  function drop() {
    if (over || !cur || api.done) return;
    const below = blocks[blocks.length - 1];
    const overlapL = Math.max(cur.x, below.x);
    const overlapR = Math.min(cur.x + cur.w, below.x + below.w);
    const overlap = overlapR - overlapL;
    if (overlap <= 0) {
      falling.push({ x: cur.x, y: blockY(blocks.length), w: cur.w, vy: 0, vx: cur.dir * 40 });
      cur = null;
      over = true;
      setTimeout(() => api.finish(score, `${floors} plantas de rascacielos`), 800);
      return;
    }
    const diff = cur.x - below.x;
    // trozo sobrante que se cae
    if (Math.abs(diff) > 1.5) {
      const cutX = diff > 0 ? overlapR : cur.x;
      falling.push({ x: cutX, y: blockY(blocks.length), w: cur.w - overlap, vy: 0, vx: (diff > 0 ? 1 : -1) * 30 });
    }
    const perfect = Math.abs(diff) < 6;
    let w = overlap, x = overlapL;
    if (perfect) {
      streak++;
      w = Math.min(below.w, overlap + 8);          // recompensa: recupera anchura
      x = below.x + (below.w - w) / 2;
      score += 50 + streak * 15;
      popup = { text: `¡PERFECTO! ×${streak}`, t: 1, color: '#00f4fe' };
    } else {
      streak = 0;
      score += 25;
      popup = { text: '+25', t: 0.9, color: '#ebb2ff' };
    }
    blocks.push({ x, w });
    floors++;
    api.setScore(score);
    // subir cámara para mantener la cima visible
    const topY = blockY(blocks.length);
    if (topY < H * 0.4) camY += H * 0.4 - topY;
    spawnBlock();
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); drop(); });
  const onKey = (e) => { if (!e.repeat && (e.key === ' ' || e.key === 'ArrowDown')) drop(); };
  window.addEventListener('keydown', onKey);

  function step(dt) {
    if (cur && !over) {
      cur.x += cur.dir * cur.speed * dt;
      if (cur.x <= 0) { cur.x = 0; cur.dir = 1; }
      if (cur.x + cur.w >= W) { cur.x = W - cur.w; cur.dir = -1; }
    }
    for (const f of falling) { f.vy += 1400 * dt; f.y += f.vy * dt; f.x += f.vx * dt; }
    falling = falling.filter(f => f.y < H + 60);
    if (popup) { popup.t -= dt; if (popup.t <= 0) popup = null; }
  }

  function drawBlock(x, y, w, hue) {
    ctx.fillStyle = hue;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y - BH, w, BH - 2, 4); ctx.fill(); ctx.stroke();
    // ventanas
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let wx = x + 6; wx < x + w - 6; wx += 12) ctx.fillRect(wx, y - BH + 6, 5, BH - 13);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // cielo degradado
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#160e2e'); g.addColorStop(1, '#0b1326');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    blocks.forEach((b, i) => {
      const y = blockY(i + 1);
      if (y < -BH || y > H + BH) return;
      const t = i / Math.max(1, blocks.length);
      const hue = `hsl(${(200 + i * 12) % 360} 90% ${34 + (i % 2) * 8}%)`;
      drawBlock(b.x, y, b.w, hue);
    });
    for (const f of falling) drawBlock(f.x, f.y, f.w, 'rgba(235,178,255,0.5)');

    if (cur && !over) drawBlock(cur.x, blockY(blocks.length), cur.w, 'hsl(185 90% 45%)');

    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(218,226,253,0.6)';
    ctx.fillText(`PLANTA ${floors}`, 12, 22);

    if (popup) {
      ctx.font = '800 20px Lexend, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = popup.color; ctx.globalAlpha = Math.min(1, popup.t * 2);
      ctx.shadowColor = popup.color; ctx.shadowBlur = 16;
      ctx.fillText(popup.text, W / 2, H * 0.18); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    if (over) {
      ctx.font = '800 30px Lexend, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470'; ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 20;
      ctx.fillText('¡SE DERRUMBA!', W / 2, H * 0.5); ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); draw(); raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  api.onQuit = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
}

/* ============================================================
   TUBERÍA (guía la bola que cae girando el conducto)
   La bola cae por un conducto de tuberías. Toca izquierda/derecha
   para doblar la tubería y llevarla de carril: recoge válvulas 💠
   y esquiva las fugas 🔥. Se acelera con el tiempo.
   ============================================================ */
function gamePipes(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const hint = el('p', 'stage-timer', 'TOCA IZQUIERDA / DERECHA PARA DOBLAR LA TUBERÍA');
  wrap.append(canvas, hint);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width; H = Math.max(360, r.height - 40);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const LANES = 4;
  const CONDUIT_W = Math.min(W * 0.8, 320);
  const CX0 = (W - CONDUIT_W) / 2;
  const LANE_W = CONDUIT_W / LANES;
  const laneX = (l) => CX0 + LANE_W * (l + 0.5);
  const BALL_Y = H * 0.34;
  const CYAN = '#00f4fe', PINK = '#ff007a';

  let lane = Math.floor(LANES / 2);
  let ballX = laneX(lane);
  let bend = 0;                 // animación de doblado (-1..1)
  let items = [];               // { lane, y, type: 'leak'|'valve' }
  let jointScroll = 0;
  let prevSafe = lane;
  let t = 0, untilSpawn = 0.5;
  let score = 0, valves = 0, over = false;
  let crashY = null, notice = null, level = 0;
  let raf = null, last = performance.now();

  const LEVELS = [[16, '¡MÁS PRESIÓN!'], [34, '¡A TODO CAUDAL!']];

  function difficulty() { return Math.min(1, t / 40); }

  function spawnRow() {
    // deja siempre ≥1 carril seguro y alcanzable desde el hueco anterior
    const shift = Math.floor(rng() * 3) - 1;
    const safe = Math.max(0, Math.min(LANES - 1, prevSafe + shift));
    prevSafe = safe;
    for (let l = 0; l < LANES; l++) {
      if (l === safe) { if (rng() < 0.5) items.push({ lane: l, y: -30, type: 'valve' }); continue; }
      if (rng() < 0.66) items.push({ lane: l, y: -30, type: 'leak' });
      else if (rng() < 0.3) items.push({ lane: l, y: -30, type: 'valve' });
    }
  }

  function move(dir) {
    if (over) return;
    const nl = Math.max(0, Math.min(LANES - 1, lane + dir));
    if (nl !== lane) { lane = nl; bend = dir; }
  }
  function setFromX(cx) {
    const r = canvas.getBoundingClientRect();
    move(cx - r.left < r.width / 2 ? -1 : 1);
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!over) setFromX(e.clientX); });
  const onKey = (e) => {
    if (e.repeat || over) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') move(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') move(1);
  };
  window.addEventListener('keydown', onKey);

  function crash(y) {
    if (over) return;
    over = true; crashY = y;
    setTimeout(() => api.finish(score, `${valves} válvulas recogidas`), 750);
  }

  function step(dt) {
    if (over) return;
    t += dt;
    if (level < LEVELS.length && t >= LEVELS[level][0]) { notice = { text: LEVELS[level][1], t: 1.6 }; level++; }
    if (notice) { notice.t -= dt; if (notice.t <= 0) notice = null; }

    const speed = Math.min(520, 230 + t * 8);
    jointScroll = (jointScroll + speed * dt) % 46;
    ballX += (laneX(lane) - ballX) * Math.min(1, dt * 14);
    bend *= Math.max(0, 1 - dt * 6);

    // marcador por caudal
    score += Math.round(dt * 14);

    untilSpawn -= dt;
    if (untilSpawn <= 0) {
      spawnRow();
      untilSpawn = Math.max(0.5, 1.05 - t * 0.012) + rng() * 0.15;
    }

    for (const it of items) {
      it.y += speed * dt;
      if (!it.done && Math.abs(it.y - BALL_Y) < 22 && it.lane === lane) {
        if (it.type === 'valve') { it.done = true; valves++; score += 60; api.setScore(score); }
        else { crash(it.y); }
      }
    }
    items = items.filter(it => !it.done && it.y < H + 40);
    api.setScore(score);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1326'; ctx.fillRect(0, 0, W, H);

    // paredes del conducto
    ctx.fillStyle = '#060e20';
    ctx.fillRect(CX0, 0, CONDUIT_W, H);
    ctx.strokeStyle = 'rgba(0,244,254,0.45)'; ctx.lineWidth = 3;
    ctx.shadowColor = CYAN; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(CX0, 0); ctx.lineTo(CX0, H);
    ctx.moveTo(CX0 + CONDUIT_W, 0); ctx.lineTo(CX0 + CONDUIT_W, H); ctx.stroke();
    ctx.shadowBlur = 0;

    // juntas de tubería (anillos que bajan) por carril
    ctx.strokeStyle = 'rgba(235,178,255,0.18)'; ctx.lineWidth = 2;
    for (let l = 0; l < LANES; l++) {
      const x = laneX(l);
      for (let y = -46 + jointScroll; y < H; y += 46) {
        ctx.beginPath(); ctx.moveTo(x - LANE_W * 0.34, y); ctx.lineTo(x + LANE_W * 0.34, y); ctx.stroke();
      }
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of items) {
      if (it.type === 'valve') {
        ctx.font = '22px serif'; ctx.shadowColor = CYAN; ctx.shadowBlur = 10;
        ctx.fillText('💠', laneX(it.lane), it.y); ctx.shadowBlur = 0;
      } else {
        ctx.font = '24px serif'; ctx.shadowColor = PINK; ctx.shadowBlur = 12;
        ctx.fillText('🔥', laneX(it.lane), it.y); ctx.shadowBlur = 0;
      }
    }

    // bola con "tubo doblado" hacia su carril
    ctx.strokeStyle = CYAN; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.shadowColor = CYAN; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(ballX - bend * 26, BALL_Y - 30);
    ctx.quadraticCurveTo(ballX, BALL_Y - 6, ballX, BALL_Y + 26);
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd76a'; ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(ballX, BALL_Y, 11, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

    ctx.font = '700 13px Space Grotesk, monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(218,226,253,0.6)'; ctx.fillText(`💠 ${valves}`, 12, 20);

    if (notice) {
      ctx.font = '800 24px Lexend, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ebb2ff'; ctx.globalAlpha = Math.min(1, notice.t * 2);
      ctx.shadowColor = '#bc13fe'; ctx.shadowBlur = 20;
      ctx.fillText(notice.text, W / 2, H * 0.16); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    if (crashY !== null) {
      ctx.font = '800 30px Lexend, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5470'; ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 20;
      ctx.fillText('¡FUGA!', W / 2, H * 0.5); ctx.shadowBlur = 0;
    }
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); draw(); raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  api.onQuit = () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); };
}

/* ============================================================
   BLACKJACK GORE (21 sangriento)
   Acércate a 21 más que el crupier sin pasarte. Quien pierde la
   mano pierde una extremidad. Si el crupier se queda sin miembros,
   ganas la partida; si te descabezan a ti, se acabó.
   ============================================================ */
function gameBlackjack(stage, rng, api) {
  const wrap = el('div', 'flip-wrap');
  const canvas = el('canvas', 'flip-canvas');
  const powerWrap = el('div', 'flip-power'); powerWrap.style.visibility = 'hidden';
  const controls = el('div', 'stairs-controls');
  const btnHit = el('button', 'btn-3d btn-pink', '🩸 PEDIR');
  const btnStand = el('button', 'btn-3d btn-cyan', '✋ PLANTARSE');
  controls.append(btnHit, btnStand);
  wrap.append(canvas, controls);
  stage.append(wrap);

  const ctx = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  (function resize() {
    const r = wrap.getBoundingClientRect();
    W = r.width; H = Math.max(320, r.height - 88);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  })();

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const LIMBS = ['left-arm', 'right-arm', 'left-leg', 'right-leg', 'head'];  // head al final = muerte
  const LIMB_ES = 'brazo pierna pierna cabeza'.split(' ');

  let deck = [];
  function reshuffle() {
    deck = [];
    for (const r of RANKS) for (const s of SUITS) deck.push({ r, s });
    deck = shuffled(deck, rng);
  }
  reshuffle();
  function draw1() { if (!deck.length) reshuffle(); return deck.pop(); }
  function cardVal(c) { return c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : parseInt(c.r); }
  function handVal(cards) {
    let sum = cards.reduce((s, c) => s + cardVal(c), 0);
    let aces = cards.filter(c => c.r === 'A').length;
    while (sum > 21 && aces > 0) { sum -= 10; aces--; }
    return sum;
  }

  let player = [], dealer = [];
  let phase = 'player';           // player | dealer | result | over
  let hideDealer = true;
  let msg = 'Acércate a 21. ¡Quien pierde, pierde un miembro!';
  let pLimbs = 5, dLimbs = 5;     // 5 = intacto (incluye cabeza)
  let blood = [];                 // partículas de sangre
  let score = 0, handsWon = 0, over = false;
  let raf = null, last = performance.now();

  function splat(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, sp = 40 + rng() * 160;
      blood.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.9, r: 2 + rng() * 4 });
    }
  }

  function deal() {
    if (over) return;
    player = [draw1(), draw1()];
    dealer = [draw1(), draw1()];
    hideDealer = true;
    phase = 'player';
    msg = 'PIDE otra carta o PLÁNTATE';
    if (handVal(player) === 21) { stand(); }   // blackjack directo
  }

  function loseLimb(who) {
    if (who === 'p') { pLimbs--; splat(W * 0.28, H * 0.42); }
    else { dLimbs--; splat(W * 0.72, H * 0.42); }
  }

  function endHand(result) {
    // result: 'win' | 'lose' | 'push'
    hideDealer = false;
    phase = 'result';
    if (result === 'win') {
      handsWon++; score += 150; loseLimb('d');
      msg = `¡GANAS! El crupier pierde un ${LIMB_ES[4 - dLimbs] || 'miembro'} 🩸`;
      if (dLimbs <= 0) { win(); return; }
    } else if (result === 'lose') {
      score += 20; loseLimb('p');
      msg = `Pierdes la mano… y un ${LIMB_ES[4 - pLimbs] || 'miembro'} 🩸`;
      if (pLimbs <= 0) { lose(); return; }
    } else {
      score += 40; msg = 'Empate. Nadie sangra.';
    }
    setTimeout(() => { if (!over) deal(); }, 1600);
  }

  function stand() {
    if (phase !== 'player' || over) return;
    phase = 'dealer';
    hideDealer = false;
    // el crupier pide hasta 17
    const tick = () => {
      if (over) return;
      if (handVal(dealer) < 17) { dealer.push(draw1()); setTimeout(tick, 500); return; }
      const pv = handVal(player), dv = handVal(dealer);
      if (dv > 21 || pv > dv) endHand('win');
      else if (pv === dv) endHand('push');
      else endHand('lose');
    };
    setTimeout(tick, 500);
  }

  function hit() {
    if (phase !== 'player' || over) return;
    player.push(draw1());
    if (handVal(player) > 21) { endHand('lose'); }
  }

  function win() { over = true; phase = 'over'; msg = '¡DESCUARTIZASTE AL CRUPIER! 🏆'; setTimeout(() => api.finish(score + 400, `Crupier destrozado · ${handsWon} manos`), 1200); }
  function lose() { over = true; phase = 'over'; msg = 'TE DESCABEZARON ☠️'; setTimeout(() => api.finish(score, `${handsWon} manos ganadas`), 1200); }

  btnHit.addEventListener('pointerdown', (e) => { e.preventDefault(); hit(); });
  btnStand.addEventListener('pointerdown', (e) => { e.preventDefault(); stand(); });

  function drawFigure(cx, cy, limbs, color, isDealer) {
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round';
    // cabeza (limbs>=1 para estar viva; head se pierde en el último golpe)
    const headOn = limbs >= 1;
    if (headOn) {
      ctx.beginPath(); ctx.arc(cx, cy - 34, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '13px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(isDealer ? '💀' : '😬', cx, cy - 34);
    }
    // torso
    ctx.beginPath(); ctx.moveTo(cx, cy - 22); ctx.lineTo(cx, cy + 8); ctx.stroke();
    // brazos: left-arm perdido si limbs<5 ; right-arm si limbs<4
    if (limbs >= 5) { ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx - 16, cy - 6); ctx.stroke(); }
    if (limbs >= 4) { ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx + 16, cy - 6); ctx.stroke(); }
    // piernas: left-leg si limbs>=3 ; right-leg si limbs>=2
    if (limbs >= 3) { ctx.beginPath(); ctx.moveTo(cx, cy + 8); ctx.lineTo(cx - 12, cy + 28); ctx.stroke(); }
    if (limbs >= 2) { ctx.beginPath(); ctx.moveTo(cx, cy + 8); ctx.lineTo(cx + 12, cy + 28); ctx.stroke(); }
  }

  function drawCard(x, y, c, hidden) {
    ctx.fillStyle = hidden ? '#3a1220' : '#f4f1ea';
    ctx.strokeStyle = '#ff2b5e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, 30, 42, 4); ctx.fill(); ctx.stroke();
    if (!hidden) {
      const red = c.s === '♥' || c.s === '♦';
      ctx.fillStyle = red ? '#c4173c' : '#1c2430';
      ctx.font = '700 13px Lexend, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.r, x + 15, y + 15);
      ctx.font = '13px serif'; ctx.fillText(c.s, x + 15, y + 30);
    } else {
      ctx.fillStyle = '#ff2b5e'; ctx.font = '16px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🩸', x + 15, y + 21);
    }
  }

  function step(dt) {
    for (const b of blood) { b.vy += 260 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
    blood = blood.filter(b => b.life > 0);
  }

  function draw() {
    // fondo tétrico
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.4, W);
    g.addColorStop(0, '#2a0a12'); g.addColorStop(1, '#0b0406');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // figuras
    drawFigure(W * 0.28, H * 0.42, pLimbs, '#7cf7ff', false);
    drawFigure(W * 0.72, H * 0.42, dLimbs, '#ff5470', true);
    ctx.font = '700 11px Space Grotesk, monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#7cf7ff'; ctx.fillText('TÚ', W * 0.28, H * 0.42 + 46);
    ctx.fillStyle = '#ff5470'; ctx.fillText('CRUPIER', W * 0.72, H * 0.42 + 46);

    // cartas del crupier (arriba)
    dealer.forEach((c, i) => drawCard(W / 2 - dealer.length * 17 + i * 34, 12, c, hideDealer && i === 1));
    // cartas del jugador (abajo)
    player.forEach((c, i) => drawCard(W / 2 - player.length * 17 + i * 34, H - 58, c, false));

    // valores
    ctx.font = '800 18px Lexend, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#dae2fd';
    ctx.fillText(hideDealer ? '?' : String(handVal(dealer)), W / 2, 74);
    ctx.fillText(String(handVal(player)), W / 2, H - 70);

    // sangre
    for (const b of blood) {
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.fillStyle = '#c4173c';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // mensaje central
    ctx.font = '600 14px Lexend, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd9d9';
    wrapText(msg, W / 2, H * 0.62, W - 40, 18);
  }

  function wrapText(text, x, y, maxW, lh) {
    const words = text.split(' '); let line = '', yy = y;
    for (const w of words) {
      if (ctx.measureText(line + w).width > maxW && line) { ctx.fillText(line.trim(), x, yy); line = ''; yy += lh; }
      line += w + ' ';
    }
    ctx.fillText(line.trim(), x, yy);
  }

  function loop(now) {
    if (api.done) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); draw(); raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  deal();
  api.onQuit = () => cancelAnimationFrame(raf);
}

/* ============================================================
   Iconos de línea (estilo design system de Stitch: Material
   Symbols outlined + glow neón). Sustituyen a los emojis en la
   galería. `currentColor` los tiñe desde el CSS.
   ============================================================ */
const _svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const GAME_ICONS = {
  flip:   _svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>'),
  duet:   _svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="20" r="1.9" fill="currentColor" stroke="none"/>'),
  stairs: _svg('<path d="M3 20h4v-4h4v-4h4v-4h5"/>'),
  tuktuk: _svg('<path d="M4 15v-2l2-5h8l3 5v2"/><path d="M2 15h20"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/>'),
  jumpy:  _svg('<path d="M6 13l6-6 6 6"/><path d="M6 18l6-6 6 6"/>'),
  trafix: _svg('<rect x="8" y="2" width="8" height="15" rx="4"/><path d="M12 17v4"/><path d="M6 21h12"/><circle cx="12" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12.5" r="1.1" fill="currentColor" stroke="none"/>'),
  bowl:   _svg('<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8.5 7c0-1.2 1-1.2 1-2.5"/><path d="M13.5 7c0-1.2 1-1.2 1-2.5"/>'),
  beer:   _svg('<path d="M7 8h8v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><path d="M15 11h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/><path d="M7 8c-1.1 0-2-.9-2-2s.9-2 2-2c.2-1.1 1.2-2 2.4-2 .7 0 1.3.3 1.8.8.5-.5 1.1-.8 1.8-.8 1.2 0 2.2.9 2.4 2 1.1 0 2 .9 2 2s-.9 2-2 2z"/>'),
  tower:  _svg('<rect x="9" y="3" width="6" height="18"/><rect x="4" y="9" width="5" height="12"/><rect x="15" y="12" width="5" height="9"/><path d="M2 21h20"/>'),
  pipes:  _svg('<path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6"/><circle cx="6" cy="3" r="1.6" fill="currentColor" stroke="none"/>'),
  blackjack: _svg('<rect x="4" y="6" width="12" height="15" rx="2"/><path d="M8 10l4 7 4-7z" fill="currentColor" stroke="none"/><path d="M16 6l3 1 1.5 12-3 1"/>'),
};
function gameIcon(g) { return GAME_ICONS[g.id] || g.icon; }

/* ============================================================
   Catálogo — la rotación diaria escoge uno por fecha
   ============================================================ */
const GAMES = [
  { id: 'flip', icon: '🤸', name: 'Flip Jump', desc: 'Carga el salto, suelta y aterriza el mortal en la siguiente plataforma.', run: gameFlip },
  { id: 'duet', icon: '☯️', name: 'Dúo Neón', desc: 'Gira las dos esferas y esquiva los bloques que caen. Un golpe y fuera.', run: gameDuet },
  { id: 'stairs', icon: '🪜', name: 'Escalera Infinita', desc: 'SUBIR sigue recto, GIRAR cambia de lado. Ni un paso al vacío y no te quedes sin energía.', run: gameStairs },
  { id: 'tuktuk', icon: '🛺', name: 'TukTuk Dodge', desc: 'Cambia de carril con tu tuk-tuk y esquiva elefantes, motos y artistas por las calles de Bangkok.', run: gameTuktuk },
  { id: 'jumpy', icon: '🦘', name: 'Jumpy Neón', desc: 'Rebota de plataforma en plataforma y sube lo más alto que puedas. ¡No caigas!', run: gameJumpy },
  { id: 'trafix', icon: '🚦', name: 'Cruce Loco', desc: 'Toca los coches para frenarlos o arrancarlos y evita choques en el cruce.', run: gameTrafix },
  { id: 'bowl', icon: '🥣', name: 'Bol Glotón', desc: 'Atrapa la comida que cae con tu bol y esquiva los objetos tóxicos. 3 vidas.', run: gameBowl },
  { id: 'beer', icon: '🍺', name: 'Caña Perfecta', desc: 'Tira la cerveza en la marca con dos dedos de espuma. 8 clientes te esperan.', run: gameBeer },
  { id: 'tower', icon: '🏙️', name: 'Torre Infinita', desc: 'Apila bloques y haz crecer el rascacielos. Suéltalos alineados o se derrumba.', run: gameTower },
  { id: 'pipes', icon: '🚰', name: 'Tubería', desc: 'Gira las tuberías para guiar la bola que cae. Si llega a un callejón sin salida, fuga.', run: gamePipes },
  { id: 'blackjack', icon: '🃏', name: 'Blackjack Gore', desc: 'Acércate a 21 más que el crupier. Quien pierde la mano pierde una extremidad.', run: gameBlackjack },
];
