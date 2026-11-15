'use strict';
/* B-Z Visual Engine: Cybernetic Mesh & High-Performance Particle FX */
window.FX = (() => {
  const bg = document.getElementById('bg'), fg = document.getElementById('fx');
  const bctx = bg.getContext('2d'), fctx = fg.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, rgb = [255, 32, 78], mode = 'idle', last = performance.now();
  const mouse = { x: -999, y: -999, active: false };
  const nodes = [], parts = [], pulses = [];

  const mk = () => ({
    x: Math.random() * (W || 800),
    y: Math.random() * (H || 600),
    vx: (Math.random() - 0.5) * 0.32,
    vy: (Math.random() - 0.5) * 0.32,
    r: Math.random() * 1.4 + 0.8,
    pulse: Math.random() * Math.PI * 2,
  });

  function parse(c) {
    c = String(c || '').trim();
    if (c[0] === '#') {
      if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = c.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [255, 32, 78];
  }

  function refresh() {
    const tone = getComputedStyle(document.body).getPropertyValue('--tone') || '#ff204e';
    rgb = parse(tone);
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [bg, fg]) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Optimized node count for 144Hz+ butter-smooth performance
    const target = Math.min(65, Math.max(30, Math.round((W * H) / 24000)));
    while (nodes.length < target) nodes.push(mk());
    nodes.length = target;
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    mouse.x = -999;
    mouse.y = -999;
    mouse.active = false;
  }, { passive: true });

  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const LINK = 135, LINK2 = LINK * LINK;

  function drawBg(dt) {
    bctx.clearRect(0, 0, W, H);
    const speed = mode === 'scan' ? 2.2 : 1;

    // Update nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx * speed * dt;
      n.y += n.vy * speed * dt;
      n.pulse += 0.02 * dt;

      if (n.x < -10) n.x = W + 10;
      else if (n.x > W + 10) n.x = -10;
      if (n.y < -10) n.y = H + 10;
      else if (n.y > H + 10) n.y = -10;

      // Snappy, subtle mouse repulsion with no stutter
      if (mouse.active) {
        const dx = n.x - mouse.x, dy = n.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 16000 && d2 > 4) {
          const force = (1 - d2 / 16000) * 1.1;
          const dist = Math.sqrt(d2);
          n.x += (dx / dist) * force;
          n.y += (dy / dist) * force;
        }
      }
    }

    // Connect mesh lines
    bctx.lineWidth = 1;
    const baseAlpha = mode === 'scan' ? 0.25 : 0.12;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK2) {
          const alpha = (1 - d2 / LINK2) * baseAlpha;
          bctx.strokeStyle = col(alpha);
          bctx.beginPath();
          bctx.moveTo(a.x, a.y);
          bctx.lineTo(b.x, b.y);
          bctx.stroke();
        }
      }

      // Mouse interactive connection
      if (mouse.active) {
        const mx = a.x - mouse.x, my = a.y - mouse.y;
        const md2 = mx * mx + my * my;
        if (md2 < 18000) {
          bctx.strokeStyle = col((1 - md2 / 18000) * 0.35);
          bctx.beginPath();
          bctx.moveTo(a.x, a.y);
          bctx.lineTo(mouse.x, mouse.y);
          bctx.stroke();
        }
      }

      // Node dot
      const rad = a.r + Math.sin(a.pulse) * 0.25;
      bctx.fillStyle = col(0.4);
      bctx.beginPath();
      bctx.arc(a.x, a.y, Math.max(0.5, rad), 0, Math.PI * 2);
      bctx.fill();
    }

    // Scan pulses
    if (mode === 'scan' && nodes.length > 4 && Math.random() < 0.28) {
      const a = nodes[(Math.random() * nodes.length) | 0];
      const b = nodes[(Math.random() * nodes.length) | 0];
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < LINK2 * 2) {
        pulses.push({ a, b, t: 0 });
      }
    }

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += 0.04 * dt;
      if (p.t >= 1) {
        pulses.splice(i, 1);
        continue;
      }
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      const g = bctx.createRadialGradient(x, y, 0, x, y, 8);
      g.addColorStop(0, col(0.95));
      g.addColorStop(1, col(0));
      bctx.fillStyle = g;
      bctx.beginPath();
      bctx.arc(x, y, 8, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  function drawFg(dt) {
    fctx.clearRect(0, 0, W, H);
    // Sparks & celebratory particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.1 * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= 0.009 * dt;

      if (p.life <= 0 || p.y > H + 20) {
        parts.splice(i, 1);
        continue;
      }
      fctx.save();
      fctx.translate(p.x, p.y);
      fctx.rotate(p.rot);
      fctx.globalAlpha = Math.min(1, p.life * 1.5);
      fctx.fillStyle = p.c;
      fctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s);
      fctx.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;
    if (!document.hidden) {
      drawBg(reduce ? 0 : dt);
      drawFg(dt);
    }
    requestAnimationFrame(frame);
  }

  function burst(x, y, count = 75) {
    if (reduce) return;
    const palette = [
      `rgb(${rgb.join(',')})`,
      '#ffffff',
      '#ff4d6d',
      '#ff1744',
      `rgba(${rgb.join(',')}, 0.85)`
    ];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = 3.5 + Math.random() * 8;
      parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 3.5,
        s: 2 + Math.random() * 3,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        life: 1,
        c: palette[(Math.random() * palette.length) | 0]
      });
    }
  }

  resize();
  refresh();
  requestAnimationFrame(frame);
  return { refresh, burst, setMode: (m) => { mode = m; } };
})();
