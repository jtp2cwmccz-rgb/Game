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
   TUK-TUK RUSH (esquivar tráfico, inspirado en Tailandia)
   Conduces un tuk-tuk por Bangkok de noche: toca izquierda o
   derecha para cambiar de carril y esquiva el tráfico (¡y los
   elefantes!). La velocidad sube con el tiempo.
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

  const LANES = 3;
  const ROAD_W = Math.min(W * 0.72, 300);
  const ROAD_X = (W - ROAD_W) / 2;
  const LANE_W = ROAD_W / LANES;
  const PLAYER_Y = H - 74;
  const CYAN = '#00f4fe', PINK = '#ff007a';

  const CARS = ['🚕', '🚌', '🚚', '🛵', '🚗'];
  const DECOR = ['🌴', '🏮', '🛕', '🌴', '🍜', '🏮', '🌴'];

  let lane = 1;                 // carril objetivo
  let laneF = 1;                // carril interpolado (para el dibujo y colisión)
  let rows = [];                // { y, cars: [{lane, emoji}], counted }
  let prevGap = 1;
  let t = 0;
  let untilSpawn = 0.5;
  let roadScroll = 0;
  let meters = 0;
  let dodged = 0;
  let score = 0;
  let over = false;
  let crashAt = null;           // { x, y }
  let notice = null;
  let level = 0;
  let raf = null;
  let last = performance.now();

  const LEVELS = [
    [15, '¡HORA PUNTA!'],
    [32, '¡A TODO GAS!'],
  ];

  function laneX(l) { return ROAD_X + LANE_W * (l + 0.5); }

  /* cada fila deja siempre un hueco alcanzable desde el hueco anterior */
  function spawnRow() {
    const shift = Math.floor(rng() * 3) - 1;
    const gap = Math.max(0, Math.min(LANES - 1, prevGap + shift));
    prevGap = gap;
    const cars = [];
    for (let l = 0; l < LANES; l++) {
      if (l === gap) continue;
      if (rng() < 0.3) continue; // a veces queda otro hueco extra
      const emoji = rng() < 0.08 ? '🐘' : CARS[Math.floor(rng() * CARS.length)];
      cars.push({ lane: l, emoji });
    }
    rows.push({ y: -50, cars, counted: false });
  }

  function setLane(clientX) {
    const r = canvas.getBoundingClientRect();
    lane = clientX < r.left + r.width / 2 ? Math.max(0, lane - 1) : Math.min(LANES - 1, lane + 1);
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!over) setLane(e.clientX); });
  const onKey = (e) => {
    if (e.repeat || over) return;
    if (e.key === 'ArrowLeft') lane = Math.max(0, lane - 1);
    if (e.key === 'ArrowRight') lane = Math.min(LANES - 1, lane + 1);
  };
  window.addEventListener('keydown', onKey);

  function crash(x, y) {
    if (over) return;
    over = true;
    crashAt = { x, y };
    setTimeout(() => api.finish(score, `${dodged} vehículos esquivados · ${Math.round(meters)} m`), 850);
  }

  function step(dt) {
    if (over) return;
    t += dt;

    if (level < LEVELS.length && t >= LEVELS[level][0]) {
      notice = { text: LEVELS[level][1], t: 1.6 };
      level++;
    }
    if (notice) { notice.t -= dt; if (notice.t <= 0) notice = null; }

    const speed = Math.min(560, 250 + t * 9);
    roadScroll = (roadScroll + speed * dt) % 60;
    meters += speed * dt / 30;

    laneF += (lane - laneF) * Math.min(1, dt * 14);

    untilSpawn -= dt;
    if (untilSpawn <= 0) {
      spawnRow();
      untilSpawn = Math.max(0.52, 1.1 - t * 0.011) + rng() * 0.15;
    }

    for (const row of rows) {
      row.y += speed * dt;
      if (!row.counted && row.y > PLAYER_Y + 26) {
        row.counted = true;
        dodged += row.cars.length;
        score += row.cars.length * 50;
        api.setScore(score);
      }
      // colisión: mismo carril (±0.45) y solape vertical
      for (const c of row.cars) {
        if (Math.abs(c.lane - laneF) < 0.45 && Math.abs(row.y - PLAYER_Y) < 40) {
          crash(laneX(c.lane), row.y);
        }
      }
    }
    rows = rows.filter(r => r.y < H + 80);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // arcenes con decorado tailandés desplazándose
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    for (let i = -1; i < H / 90 + 1; i++) {
      const y = ((i * 90 + roadScroll * 1.5) % (H + 90));
      const di = Math.abs(Math.floor((i * 90) / 90)) % DECOR.length;
      ctx.globalAlpha = 0.85;
      ctx.fillText(DECOR[di], ROAD_X / 2, y);
      ctx.fillText(DECOR[(di + 3) % DECOR.length], W - ROAD_X / 2, y + 45);
      ctx.globalAlpha = 1;
    }

    // carretera
    ctx.fillStyle = '#060e20';
    ctx.fillRect(ROAD_X, 0, ROAD_W, H);
    ctx.strokeStyle = 'rgba(0,244,254,0.5)';
    ctx.lineWidth = 2;
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(ROAD_X, 0); ctx.lineTo(ROAD_X, H);
    ctx.moveTo(ROAD_X + ROAD_W, 0); ctx.lineTo(ROAD_X + ROAD_W, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // líneas discontinuas de carril
    ctx.strokeStyle = 'rgba(235,178,255,0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 34]);
    ctx.lineDashOffset = -roadScroll;
    for (let l = 1; l < LANES; l++) {
      ctx.beginPath();
      ctx.moveTo(ROAD_X + LANE_W * l, -20);
      ctx.lineTo(ROAD_X + LANE_W * l, H + 20);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // tráfico
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const row of rows) {
      for (const c of row.cars) {
        ctx.font = c.emoji === '🐘' || c.emoji === '🚌' || c.emoji === '🚚' ? '34px serif' : '30px serif';
        ctx.shadowColor = PINK;
        ctx.shadowBlur = 10;
        ctx.fillText(c.emoji, laneX(c.lane), row.y);
        ctx.shadowBlur = 0;
      }
    }

    // tu tuk-tuk
    ctx.font = '34px serif';
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 16;
    ctx.fillText('🛺', laneX(laneF), PLAYER_Y);
    ctx.shadowBlur = 0;

    // marcador de metros
    ctx.font = '700 13px Space Grotesk, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(218,226,253,0.55)';
    ctx.fillText(`${Math.round(meters)} m`, 12, 22);

    if (notice) {
      ctx.font = '800 26px Lexend, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ebb2ff';
      ctx.globalAlpha = Math.min(1, notice.t * 2);
      ctx.shadowColor = '#bc13fe';
      ctx.shadowBlur = 22;
      ctx.fillText(notice.text, W / 2, H * 0.25);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    if (crashAt) {
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.fillText('💥', crashAt.x, Math.min(crashAt.y, H - 20));
      ctx.font = '800 34px Lexend, sans-serif';
      ctx.fillStyle = '#ff5470';
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 20;
      ctx.fillText('¡CRASH!', W / 2, H * 0.35);
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
   Catálogo — la rotación diaria escoge uno por fecha
   ============================================================ */
const GAMES = [
  { id: 'flip', icon: '🤸', name: 'Flip Jump', desc: 'Carga el salto, suelta y aterriza el mortal en la siguiente plataforma.', run: gameFlip },
  { id: 'duet', icon: '☯️', name: 'Dúo Neón', desc: 'Gira las dos esferas y esquiva los bloques que caen. Un golpe y fuera.', run: gameDuet },
  { id: 'stairs', icon: '🪜', name: 'Escalera Infinita', desc: 'SUBIR sigue recto, GIRAR cambia de lado. Ni un paso al vacío y no te quedes sin energía.', run: gameStairs },
  { id: 'tuktuk', icon: '🛺', name: 'Tuk-Tuk Rush', desc: 'Esquiva el tráfico de Bangkok con tu tuk-tuk. ¡Cuidado con los elefantes!', run: gameTuktuk },
  { id: 'jumpy', icon: '🦘', name: 'Jumpy Neón', desc: 'Rebota de plataforma en plataforma y sube lo más alto que puedas. ¡No caigas!', run: gameJumpy },
  { id: 'trafix', icon: '🚦', name: 'Cruce Loco', desc: 'Toca los coches para frenarlos o arrancarlos y evita choques en el cruce.', run: gameTrafix },
  { id: 'bowl', icon: '🥣', name: 'Bol Glotón', desc: 'Atrapa la comida que cae con tu bol y esquiva los objetos tóxicos. 3 vidas.', run: gameBowl },
];
