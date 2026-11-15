'use strict';
/* Visual effects: living network-mesh background, cursor comet trail, confetti. */
window.FX = (() => {
  const bg = document.getElementById('bg'), fg = document.getElementById('fx');
  const bctx = bg.getContext('2d'), fctx = fg.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, rgb = [200, 255, 62], mode = 'idle', last = performance.now();
  const mouse = { x: -999, y: -999 };
  const nodes = [], trail = [], parts = [], pulses = [];

  const mk = () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28, r: Math.random() * 1.3 + 0.5 });

  function parse(c) {
    c = String(c).trim();
    if (c[0] === '#') {
      if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = c.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [200, 255, 62];
  }
  function refresh() {
    rgb = parse(getComputedStyle(document.body).getPropertyValue('--tone') || '#c8ff3e');
  }
  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    for (const c of [bg, fg]) { c.width = W * dpr; c.height = H * dpr; }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0); fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = Math.min(130, Math.round((W * H) / 17000));
    while (nodes.length < target) nodes.push(mk());
    nodes.length = target;
  }
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!reduce) trail.push({ x: e.clientX, y: e.clientY, life: 1 });
    if (trail.length > 28) trail.shift();
  });
  document.documentElement.addEventListener('mouseleave', () => { mouse.x = mouse.y = -999; });

  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const LINK = 135, LINK2 = LINK * LINK;

  function drawBg(dt) {
    bctx.clearRect(0, 0, W, H);
    const speed = mode === 'scan' ? 2.6 : 1;
    for (const n of nodes) {
      n.x += n.vx * speed * dt; n.y += n.vy * speed * dt;
      if (n.x < -10) n.x = W + 10; else if (n.x > W + 10) n.x = -10;
      if (n.y < -10) n.y = H + 10; else if (n.y > H + 10) n.y = -10;
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 16000 && d2 > 1) { const f = (1 - d2 / 16000) * 0.9; n.x += (dx / Math.sqrt(d2)) * f; n.y += (dy / Math.sqrt(d2)) * f; }
    }
    const base = mode === 'scan' ? 0.2 : 0.11;
    bctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < LINK2) { bctx.strokeStyle = col((1 - d2 / LINK2) * base); bctx.beginPath(); bctx.moveTo(a.x, a.y); bctx.lineTo(b.x, b.y); bctx.stroke(); }
      }
      const mx = a.x - mouse.x, my = a.y - mouse.y, md = mx * mx + my * my;
      if (md < 22000) { bctx.strokeStyle = col((1 - md / 22000) * 0.45); bctx.beginPath(); bctx.moveTo(a.x, a.y); bctx.lineTo(mouse.x, mouse.y); bctx.stroke(); }
      bctx.fillStyle = col(0.35); bctx.beginPath(); bctx.arc(a.x, a.y, a.r, 0, 6.2832); bctx.fill();
    }
    if (mode === 'scan' && nodes.length > 4 && Math.random() < 0.35) {
      const a = nodes[(Math.random() * nodes.length) | 0], b = nodes[(Math.random() * nodes.length) | 0];
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < LINK2 * 2.2) pulses.push({ a, b, t: 0 });
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]; p.t += 0.035 * dt;
      if (p.t >= 1) { pulses.splice(i, 1); continue; }
      const x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t;
      const g = bctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, col(0.95)); g.addColorStop(1, col(0));
      bctx.fillStyle = g; bctx.beginPath(); bctx.arc(x, y, 9, 0, 6.2832); bctx.fill();
    }
  }

  function drawFg(dt) {
    fctx.clearRect(0, 0, W, H);
    // comet trail
    for (let i = trail.length - 1; i >= 0; i--) { trail[i].life -= 0.055 * dt; if (trail[i].life <= 0) trail.splice(i, 1); }
    fctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], l = Math.min(a.life, b.life);
      fctx.strokeStyle = col(l * 0.5); fctx.lineWidth = 1 + l * 3;
      fctx.beginPath(); fctx.moveTo(a.x, a.y); fctx.lineTo(b.x, b.y); fctx.stroke();
    }
    // confetti
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.09 * dt; p.vx *= 0.992; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= 0.0075 * dt;
      if (p.life <= 0 || p.y > H + 20) { parts.splice(i, 1); continue; }
      fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.globalAlpha = Math.min(1, p.life * 1.6); fctx.fillStyle = p.c;
      fctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); fctx.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.67); last = now;
    if (!document.hidden) { drawBg(reduce ? 0 : dt); drawFg(dt); }
    requestAnimationFrame(frame);
  }

  function burst(x, y, count = 90) {
    if (reduce) return;
    const palette = [`rgb(${rgb.join(',')})`, '#ffffff', '#ffb547', `rgb(${rgb.join(',')})`];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 7;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, s: 2 + Math.random() * 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1, c: palette[(Math.random() * palette.length) | 0] });
    }
  }

  resize(); refresh(); requestAnimationFrame(frame);
  return { refresh, burst, setMode: (m) => { mode = m; } };
})();
