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
   Catálogo — la rotación diaria escoge uno por fecha
   ============================================================ */
const GAMES = [
  { id: 'flip', icon: '🤸', name: 'Flip Jump', desc: 'Carga el salto, suelta y aterriza el mortal en la siguiente plataforma.', run: gameFlip },
];
