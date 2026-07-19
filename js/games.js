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
   Catálogo — la rotación diaria escoge uno por fecha
   ============================================================ */
const GAMES = [
  { id: 'flip', icon: '🤸', name: 'Flip Jump', desc: 'Carga el salto, suelta y aterriza el mortal en la siguiente plataforma.', run: gameFlip },
  { id: 'duet', icon: '☯️', name: 'Dúo Neón', desc: 'Gira las dos esferas y esquiva los bloques que caen. Un golpe y fuera.', run: gameDuet },
  { id: 'stairs', icon: '🪜', name: 'Escalera Infinita', desc: 'SUBIR sigue recto, GIRAR cambia de lado. Ni un paso al vacío y no te quedes sin energía.', run: gameStairs },
];
