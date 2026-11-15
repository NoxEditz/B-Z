'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const bz = window.bz, FX = window.FX;
  const state = {
    phase: 'idle',
    info: null,
    analysis: null,
    selected: new Set(),
    verifyFrom: null,
    catalog: {},
    live: { on: false, pts: [], lost: 0, total: 0, rt: null }
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Browser storage is a per-viewer convenience only; every access is guarded.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  /* ---------- SVG Icons Library ---------- */
  const SVGS = {
    // Metrics
    latency: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><polyline points="10 6 10 10 13 13"/></svg>',
    loss: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 2l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z"/><path d="M10 6v5m0 3v.5"/></svg>',
    down: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 3v10m-4-4l4 4 4-4M3 17h14"/></svg>',
    dns: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="10" cy="5" rx="7" ry="2.5"/><path d="M3 5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5M3 10v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5"/><path d="M13 11l-2 3h3l-2 3" stroke-width="1.4"/></svg>',
    wifi: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 7a12 12 0 0 1 16 0M5 10a8 8 0 0 1 10 0M8 13a4 4 0 0 1 4 0"/><circle cx="10" cy="16" r="1.2" fill="currentColor"/></svg>',
    eth: '<svg class="tile-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7 16v-3h6v3M6 8h1m2 0h1m2 0h1m2 0h1"/></svg>',

    // Findings Severities
    bad: '<svg class="finding-ic" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="6,2 14,2 18,6 18,14 14,18 6,18 2,14 2,6"/><path d="M10 6v5m0 3v.5"/></svg>',
    warn: '<svg class="finding-ic" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="10,2 18,17 2,17"/><path d="M10 7v5m0 3v.5"/></svg>',
    ok: '<svg class="finding-ic" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="10,2 18,7 18,13 10,18 2,13 2,7"/><polyline points="6 10 9 13 14 7"/></svg>',
    info: '<svg class="finding-ic" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="8"/><path d="M10 9v5m0-7v1"/></svg>',

    // Fix Categories
    dnsFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="8"/><path d="M2 10h16M10 2a12 12 0 0 1 0 16M10 2a12 12 0 0 0 0 16"/><path d="M12 7l-3 4h4l-3 4" stroke-width="1.5"/></svg>',
    nicFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M6 16v-2m4 2v-2m4 2v-2M6 8h8"/></svg>',
    flushFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 3l3 3-8 8H6v-3l8-8zM3 17h14"/></svg>',
    ipFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M17 10a7 7 0 1 1-2-5M15 2v3h-3"/></svg>',
    clockFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="8"/><polyline points="10 6 10 10 13 10"/></svg>',
    tcpFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 16l4-1 6-6a2.8 2.8 0 0 0-4-4L4 11l-1 4 1 1zM14 6l-2-2"/></svg>',
    sysFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14.7 10.3l-2.4-2.4a4.5 4.5 0 0 0-5.6-.6L4 4.6a1.5 1.5 0 0 0-2.1 2.1l2.7 2.7a4.5 4.5 0 0 0 .6 5.6l2.4 2.4a1.5 1.5 0 0 0 2.1-2.1l-1-1 2.5-2.5 1 1a1.5 1.5 0 0 0 2.5-2.5z"/></svg>',
    portalFix: '<svg class="fix-cat-ic" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="14" height="14" rx="2"/><circle cx="10" cy="9" r="2"/><path d="M10 11v3m-2-1h4"/></svg>',

    // DNS Providers
    cloudflare: '<svg class="lane-logo" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h10a2.5 2.5 0 0 0 .5-5 4 4 0 0 0-7.8-1.5A3 3 0 0 0 3 12z"/></svg>',
    google: '<svg class="lane-logo" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M8 8h5"/></svg>',
    quad9: '<svg class="lane-logo" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 1.5l5 2v5c0 3-2 5-5 6-3-1-5-3-5-6v-5l5-2z"/><circle cx="8" cy="7" r="1.5"/><path d="M9.5 7v3.5a1 1 0 0 1-2 0"/></svg>',
    opendns: '<svg class="lane-logo" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><path d="M2 8a7 7 0 0 1 12 0 7 7 0 0 1-12 0"/></svg>',
    you: '<svg class="lane-logo" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="9" width="12" height="5" rx="1.5"/><path d="M4 9V5m4 4V3m4 6V5"/></svg>'
  };

  /* ---------- DOM Helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function iconEl(svgStr) {
    const t = document.createElement('template');
    t.innerHTML = svgStr.trim();
    return t.content.firstElementChild;
  }

  function fixIconFor(id) {
    if (id.startsWith('set-dns') || id === 'reset-dns-auto') return SVGS.dnsFix;
    if (id === 'flush-dns' || id === 'flush-arp') return SVGS.flushFix;
    if (id === 'renew-ip') return SVGS.ipFix;
    if (id === 'sync-time') return SVGS.clockFix;
    if (id === 'optimize-tcp') return SVGS.tcpFix;
    if (id === 'open-portal') return SVGS.portalFix;
    if (id === 'enable-adapters' || id === 'restart-adapter' || id === 'disable-power-saving' || id === 'restart-wifi-service') return SVGS.nicFix;
    return SVGS.sysFix;
  }

  /* ---------- Zero-Latency Cursor & Reactive Follower ---------- */
  const dot = $('#cur-dot'), ring = $('#cur-ring'), ringLabel = ring.querySelector('em');
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;

  // Ultra low latency tracking: update dot immediately on pointermove with 0ms delay!
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    
    const root = document.documentElement.style;
    root.setProperty('--mx', mx + 'px');
    root.setProperty('--my', my + 'px');
    
    dot.classList.add('show');
    ring.classList.add('show');
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    dot.classList.remove('show');
    ring.classList.remove('show');
  });

  // Smooth & snappy ring tracking loop (high responsiveness k=0.52, zero floaty drag!)
  (function cursorLoop() {
    const k = reduce ? 1 : 0.52;
    rx += (mx - rx) * k;
    ry += (my - ry) * k;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    requestAnimationFrame(cursorLoop);
  })();

  // Card spotlight: attach mousemove on .spot containers with no global thrashing
  document.addEventListener('pointerover', (e) => {
    const spot = e.target.closest && e.target.closest('.spot');
    if (spot && !spot._spotBound) {
      spot._spotBound = true;
      spot.addEventListener('pointermove', (ev) => {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty('--x', (ev.clientX - r.left) + 'px');
        spot.style.setProperty('--y', (ev.clientY - r.top) + 'px');
      }, { passive: true });
    }
  });

  // Magnetic buttons: Scoped event listeners so global mouse moves have ZERO layout reflows!
  function bindMagnetic(el) {
    let r = null;
    el.addEventListener('mouseenter', () => { r = el.getBoundingClientRect(); });
    el.addEventListener('mousemove', (e) => {
      if (reduce) return;
      if (!r) r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      el.style.transform = `translate(${dx * 0.22}px, ${dy * 0.28}px)`;
    }, { passive: true });
    el.addEventListener('mouseleave', () => {
      el.style.transform = '';
      r = null;
    });
  }
  $$('.magnetic').forEach(bindMagnetic);

  // Hover states & ripples
  const interactiveSelector = 'button, a, input, label, .fix, .toggle, .tab, .tile';
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest ? e.target : null;
    const lab = t && t.closest('[data-cursor]');
    const on = !!(t && t.closest(interactiveSelector));
    ring.classList.toggle('label', !!lab);
    ring.classList.toggle('hover', on && !lab);
    dot.classList.toggle('hover', on);
    if (lab) ringLabel.textContent = lab.dataset.cursor;
  });

  window.addEventListener('pointerdown', (e) => {
    ring.classList.add('down');
    if (reduce) return;
    const r = h('span', { class: 'ripple' });
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.append(r);
    r.addEventListener('animationend', () => r.remove());
  });
  window.addEventListener('pointerup', () => ring.classList.remove('down'));

  /* ---------- Circular HUD Tick Gauge ---------- */
  const TICKS = 72, NS = 'http://www.w3.org/2000/svg';
  const ticks = [];
  const ticksG = $('#ticks');
  ticksG.textContent = '';

  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
    const major = i % 6 === 0;
    const r1 = major ? 104 : 110, r2 = 124;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', 140 + Math.cos(a) * r1);
    l.setAttribute('y1', 140 + Math.sin(a) * r1);
    l.setAttribute('x2', 140 + Math.cos(a) * r2);
    l.setAttribute('y2', 140 + Math.sin(a) * r2);
    l.setAttribute('class', 'tick' + (major ? ' major' : ''));
    ticksG.append(l);
    ticks.push(l);
  }

  let sweep = null;
  function stopSweep() {
    if (sweep) clearInterval(sweep);
    sweep = null;
    ticks.forEach((t) => { t.style.opacity = ''; });
  }

  function startSweep() {
    stopSweep();
    let head = 0;
    sweep = setInterval(() => {
      head = (head + 1) % TICKS;
      ticks.forEach((t, i) => {
        const d = (head - i + TICKS) % TICKS;
        t.classList.toggle('on', d < 18);
        t.style.opacity = d < 18 ? String(1 - d / 18) : '0.35';
      });
    }, 36);
  }

  function setGauge(pct) {
    stopSweep();
    const target = Math.round((pct / 100) * TICKS);
    let i = 0;
    (function step() {
      ticks.forEach((t, k) => t.classList.toggle('on', k < i));
      if (i < target) {
        i += reduce ? target : 1;
        requestAnimationFrame(step);
      }
    })();
  }

  function countTo(el, to, ms = 850) {
    if (reduce) { el.textContent = to; return; }
    const t0 = performance.now();
    (function f(t) {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  /* ---------- Helpers & State ---------- */
  const toneFor = (s) => (s >= 75 ? 'ok' : s >= 45 ? 'warn' : 'bad');
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  function setPhase(p) {
    state.phase = p;
    document.body.dataset.state = p;
    FX.setMode(p === 'scanning' ? 'scan' : 'idle');
  }

  function setTone(t) {
    document.body.dataset.tone = t;
    FX.refresh();
    setTimeout(FX.refresh, 80);
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  /* ---------- Accent Themes ---------- */
  function setAccent(a, save) {
    // Default to crimson if legacy accent was lime
    if (a === 'lime' || !a) a = 'crimson';
    document.body.dataset.accent = a;
    $$('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.accent === a));
    if (save) store.set('bz.accent', a);
    FX.refresh();
    setTimeout(FX.refresh, 80);
  }
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setAccent(b.dataset.accent, true);
  });

  /* ---------- Tabs ---------- */
  function setTab(t) {
    document.body.dataset.tab = t;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'live') startLive(); else stopLive();
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btn-live').addEventListener('click', () => {
    if (state.phase === 'idle') setPhase('report');
    setTab('live');
  });

  /* ---------- Scan History Sparkline ---------- */
  function renderHistory() {
    const box = $('#history');
    box.textContent = '';
    const items = store.get('bz.history', []).slice(-14);
    if (!items.length) {
      box.append(h('span', { class: 'hint', style: 'font-size:10px;' }, 'None yet'));
      return;
    }
    for (const s of items) {
      const el = h('i', { class: toneFor(s) });
      el.style.height = Math.max(4, Math.round((s / 100) * 24)) + 'px';
      el.title = `Score: ${s}/100`;
      box.append(el);
    }
  }

  function pushHistory(s) {
    const hs = store.get('bz.history', []);
    hs.push(s);
    store.set('bz.history', hs.slice(-14));
    renderHistory();
  }

  /* ---------- Scan Step Badges ---------- */
  const STEPS = [
    ['adapters', 'Adapters'],
    ['gateway', 'Router Gateway'],
    ['internet', 'Internet Route'],
    ['dns', 'DNS Race'],
    ['web', 'Web Connect'],
    ['speed', 'Bandwidth'],
    ['ai', 'AI Engine']
  ];

  function resetSteps(withAi) {
    const ol = $('#steps');
    ol.textContent = '';
    for (const [id, label] of STEPS) {
      if (id !== 'ai' || withAi) {
        ol.append(h('li', { 'data-id': id }, label));
      }
    }
  }

  bz.onScanStep(({ id, state: s }) => {
    const li = $(`#steps li[data-id="${id}"]`);
    if (li) li.className = s === 'start' ? 'active' : 'done';
  });

  /* ---------- Scan Execution ---------- */
  async function runScan() {
    if (state.phase === 'scanning') return;
    const verify = state.verifyFrom != null;
    stopLive();
    setPhase('scanning');
    setTone('ok');
    $('#ring-wrap').classList.remove('healthy');
    resetSteps(state.info && state.info.settings.hasKey);
    $('#score').textContent = '…';
    $('#label').textContent = 'Scanning';
    $('#headline').textContent = 'Reading your network…';
    $('#scan-text').textContent = 'Scanning';
    $$('.node').forEach((n) => { n.className = 'node'; });
    $$('.seg').forEach((n) => { n.className = 'seg'; });
    ticks.forEach((t) => t.classList.remove('on'));
    startSweep();

    let res;
    try {
      res = await bz.scan();
    } catch (e) {
      res = { error: String(e.message || e) };
    }

    if (!res || res.error) {
      toast((res && res.error) || 'Scan failed.');
      stopSweep();
      setPhase(state.analysis ? 'report' : 'idle');
      $('#scan-text').textContent = state.analysis ? 'Scan again' : 'Scan Network';
      if (state.analysis) renderScore(state.analysis);
      else {
        $('#score').textContent = '—';
        $('#label').textContent = 'Ready';
        $('#headline').textContent = 'Your connection, diagnosed.';
      }
      return;
    }

    state.analysis = res.analysis;
    document.body.dataset.has = '1';
    setTab('report');
    renderReport(res.analysis, verify ? state.verifyFrom : null);
    state.verifyFrom = null;
    setPhase('report');
    pushHistory(res.analysis.score);
    $('#scan-text').textContent = 'Scan again';

    if (res.analysis.online && res.analysis.score >= 90) {
      const [x, y] = centerOf($('#ring-wrap'));
      setTimeout(() => FX.burst(x, y, 75), 650);
    }
  }

  function renderScore(a) {
    const tone = toneFor(a.score);
    setTone(tone);
    countTo($('#score'), a.score);
    $('#label').textContent = a.label;
    $('#headline').textContent = a.online
      ? (a.score >= 75 ? 'You’re in good shape.' : 'A few things to look at.')
      : 'You’re offline.';
    $('#ring-wrap').classList.toggle('healthy', tone === 'ok');
    setGauge(a.score);
  }

  /* ---------- Report View & Icons ---------- */
  const METRICS = [
    ['Latency', (m) => m.latencyMs, 'ms', (v) => (v > 150 ? 'bad' : v > 80 ? 'warn' : 'good'), SVGS.latency],
    ['Packet Loss', (m) => m.lossPct, '%', (v) => (v >= 10 ? 'bad' : v > 0 ? 'warn' : 'good'), SVGS.loss],
    ['Download', (m) => m.downMbps, 'Mbps', (v) => (v < 1 ? 'bad' : v < 5 ? 'warn' : 'good'), SVGS.down],
    ['DNS Ping', (m) => m.dnsMs, 'ms', (v) => (v > 250 ? 'warn' : 'good'), SVGS.dns],
  ];

  function renderRace(a) {
    const box = $('#race');
    box.textContent = '';
    if (!a.race) {
      box.append(h('div', { class: 'hint' }, 'No DNS benchmark data.'));
      return;
    }

    const lanes = [
      { name: 'Your DNS', id: 'you', you: true, ...(a.race.yours || { ok: false, ms: null }) },
      ...a.race.providers.map((p) => ({ ...p, best: p.id === a.race.best }))
    ];

    const oks = lanes.filter((l) => l.ok && l.ms != null).map((l) => l.ms);
    const max = Math.max(40, ...oks);
    const rows = [lanes[0], ...lanes.slice(1).sort((x, y) => (x.ok ? x.ms : 1e9) - (y.ok ? y.ms : 1e9))];

    rows.forEach((l, i) => {
      const w = l.ok && l.ms != null ? Math.max(6, Math.round((l.ms / max) * 100)) : 100;
      const logoSvg = SVGS[l.id] || SVGS.cloudflare;
      
      const lane = h('div', {
        class: 'lane' + (l.you ? ' you' : '') + (l.best ? ' best' : '') + (!l.ok ? ' fail' : ''),
        style: `--i:${i};--w:${w}%`
      },
        h('div', { class: 'lane-info' },
          iconEl(logoSvg),
          h('span', { class: 'nm' }, l.name)
        ),
        h('div', { class: 'track' }, h('i')),
        h('span', { class: 'ms' }, l.ok && l.ms != null ? `${l.ms} ms` : 'no reply')
      );
      box.append(lane);
    });
  }

  function renderReport(a, from) {
    renderScore(a);

    // Update path nodes
    const nodes = $$('.node'), segs = $$('.seg');
    a.path.forEach((p, i) => {
      nodes[i].className = 'node ' + p.status;
      if (i > 0) segs[i - 1].className = 'seg ' + (p.status === 'unknown' ? '' : p.status);
    });

    // Summary banner
    $('#source-badge-text').textContent = a.source === 'ai' ? `AI · ${a.model || 'Claude'}` : 'Built-in rules';
    $('#summary-text').textContent = a.summary;
    const note = $('#ai-note');
    note.hidden = !a.aiError;
    note.textContent = a.aiError || '';

    const d = $('#delta');
    d.hidden = from == null;
    d.textContent = from == null ? '' : `Score: ${from} → ${a.score}`;
    if (from != null && a.score > from) {
      const [x, y] = centerOf($('#ring-wrap'));
      setTimeout(() => FX.burst(x, y, 110), 600);
    }

    // Telemetry Tiles
    const m = a.metrics, box = $('#metrics');
    box.textContent = '';
    let i = 0;

    const tile = (cls, big, unit, name, svgStr) => {
      const t = h('div', { class: 'tile spot rise ' + cls, style: `--i:${i++}` },
        h('div', { class: 'tile-head' },
          h('span', null, name),
          iconEl(svgStr)
        ),
        h('b', null, big, unit ? h('small', null, unit) : null)
      );
      return t;
    };

    for (const [name, get, unit, grade, svgIcon] of METRICS) {
      const v = get(m);
      box.append(tile(v == null ? '' : grade(v), v == null ? '—' : v, v == null ? '' : unit, name, svgIcon));
    }

    if (m.signal != null) {
      box.append(tile(m.signal < 40 ? 'bad' : m.signal < 60 ? 'warn' : 'good', m.signal, '%', 'Wi-Fi Signal', SVGS.wifi));
    } else {
      box.append(tile('', m.link || '—', '', m.type ? `${m.type} Link` : 'Link', SVGS.eth));
    }

    renderRace(a);

    // Findings
    const fl = $('#findings');
    fl.textContent = '';
    a.findings.forEach((f, k) => {
      const sevIcon = SVGS[f.severity] || SVGS.info;
      fl.append(h('li', { class: 'finding spot rise ' + f.severity, style: `--i:${k}` },
        iconEl(sevIcon),
        h('div', null,
          h('strong', null, f.title),
          h('p', null, f.detail)
        )
      ));
    });

    renderFixes(a);
  }

  function renderFixes(a) {
    const list = $('#fixes'), log = $('#log');
    list.textContent = '';
    log.textContent = '';
    $('#fix-progress').hidden = true;
    state.selected = new Set();
    let dnsPicked = false;

    a.fixes.forEach((f, k) => {
      const meta = state.catalog[f.id];
      if (!meta) return;
      const isDns = f.id.startsWith('set-dns-');
      const on = meta.risk !== 'high' && !(isDns && dnsPicked);
      if (isDns && on) dnsPicked = true;
      if (on) state.selected.add(f.id);

      const cb = h('input', { type: 'checkbox', 'data-id': f.id });
      cb.checked = on;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          state.selected.add(f.id);
          if (isDns) {
            list.querySelectorAll('input[data-id^="set-dns-"]').forEach((o) => {
              if (o !== cb) { o.checked = false; state.selected.delete(o.dataset.id); }
            });
          }
        } else state.selected.delete(f.id);
        updateApply();
      });

      const tags = h('div', { class: 'tags' },
        meta.risk !== 'safe' ? h('span', { class: 'tag ' + meta.risk }, meta.risk) : null,
        meta.reboot ? h('span', { class: 'tag' }, 'restart') : null
      );

      const catIcon = iconEl(fixIconFor(f.id));

      list.append(h('li', { class: 'fix spot rise', style: `--i:${k}` },
        cb,
        h('i', { class: 'box' }),
        catIcon,
        h('div', { class: 't' },
          h('strong', null, meta.title),
          h('p', null, f.reason || meta.desc)
        ),
        tags
      ));
    });

    if (!list.children.length) {
      list.append(h('li', { class: 'empty-state' },
        a.online ? 'All adapters and network rules are optimal. Nothing to fix!' : 'No automated fix applies. Check your modem, cable, or ISP status.'
      ));
    }
    updateApply();
  }

  function updateApply() {
    const n = state.selected.size, b = $('#btn-apply');
    b.hidden = !$('#fixes input');
    b.disabled = n === 0;
    $('#btn-apply-text').textContent = n ? `Apply ${n} Fix${n > 1 ? 'es' : ''}` : 'Apply Fixes';
    const needAdmin = state.info && !state.info.admin && [...state.selected].some((id) => state.catalog[id] && state.catalog[id].admin);
    $('#fix-hint').textContent = needAdmin ? 'Administrator rights required for system-level fixes. Restart B-Z as Admin.' : '';
  }

  /* ---------- Apply Fixes Pipeline ---------- */
  let fixTotal = 0, fixDone = 0;

  bz.onFixStep((p) => {
    const row = $(`#log li[data-id="${p.id}"]`);
    if (!row) return;
    const label = (state.catalog[p.id] || {}).title || p.id;
    if (p.state === 'start') {
      row.className = 'run';
      row.children[0].textContent = '●';
      return;
    }
    row.className = p.ok ? 'ok' : 'fail';
    row.children[0].textContent = p.ok ? '✓' : '✕';
    row.children[1].textContent = `${label} — ${p.output}`;
    if (p.ok && p.id.startsWith('set-dns-')) {
      row.children[2].append(h('button', {
        class: 'undo',
        'data-cursor': 'undo',
        onclick: async () => {
          const r = await bz.fix(['reset-dns-auto']);
          toast(r[0] && r[0].ok ? 'DNS restored to automatic.' : (r[0] ? r[0].output : 'Undo failed.'));
          row.children[2].textContent = '';
        }
      }, 'undo'));
    }
    fixDone++;
    $('#fix-progress i').style.width = Math.round((fixDone / fixTotal) * 100) + '%';
  });

  async function applyFixes() {
    const ids = [...state.selected];
    if (!ids.length) return;
    const log = $('#log');
    log.textContent = '';

    for (const id of ids) {
      log.append(h('li', { 'data-id': id },
        h('span', { class: 's' }, '·'),
        h('span', null, (state.catalog[id] || {}).title || id),
        h('span')
      ));
    }

    fixTotal = ids.length;
    fixDone = 0;
    const pb = $('#fix-progress');
    pb.hidden = false;
    pb.firstElementChild.style.width = '0%';
    $('#btn-apply').disabled = true;

    let results;
    try {
      results = await bz.fix(ids);
    } catch (e) {
      toast(String(e.message || e));
      updateApply();
      return;
    }

    const okCount = results.filter((r) => r.ok).length;
    const reboot = results.some((r) => r.reboot);
    if (okCount) {
      const [x, y] = centerOf($('#btn-apply'));
      FX.burst(x, y, 65);
    }

    if (reboot) toast('Restart Windows to finish applying system network changes.');
    else toast(okCount === results.length ? 'All selected fixes successfully applied.' : `${okCount} of ${results.length} fixes applied.`);

    if (okCount && !reboot && state.info.settings.autoVerify) {
      state.verifyFrom = state.analysis.score;
      toast('Fixes applied — re-verifying network health in 6s…');
      setTimeout(runScan, 6000);
    } else {
      $('#btn-apply').disabled = false;
    }
  }

  /* ---------- Live Pulse Oscilloscope ---------- */
  const lc = $('#live-canvas'), lctx = lc.getContext('2d');
  const LIVE_N = 60;

  function liveColor() {
    return getComputedStyle(document.body).getPropertyValue('--tone').trim() || '#ff204e';
  }

  function drawLive() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = lc.clientWidth, hgt = lc.clientHeight;
    if (!w || !hgt) return;
    if (lc.width !== Math.round(w * dpr)) {
      lc.width = Math.round(w * dpr);
      lc.height = Math.round(hgt * dpr);
    }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, w, hgt);

    const pts = state.live.pts, ok = pts.filter((p) => p != null);
    const maxV = Math.max(60, ...ok) * 1.15;
    const pad = 16, bw = (w - pad * 2) / (LIVE_N - 1);
    const y = (v) => hgt - pad - (v / maxV) * (hgt - pad * 2);

    // Grid lines & labels
    lctx.strokeStyle = 'rgba(255, 32, 78, 0.08)';
    lctx.lineWidth = 1;
    lctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    lctx.font = '10px "Cascadia Mono", monospace';

    for (let i = 1; i <= 3; i++) {
      const v = (maxV / 4) * i, yy = y(v);
      lctx.beginPath();
      lctx.moveTo(pad, yy);
      lctx.lineTo(w - pad, yy);
      lctx.stroke();
      lctx.fillText(Math.round(v) + 'ms', pad + 4, yy - 4);
    }

    const off = LIVE_N - pts.length, col = liveColor();
    const x = (i) => pad + (off + i) * bw;

    // Laser Area & Trace
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const g = lctx.createLinearGradient(0, 0, 0, hgt);
        g.addColorStop(0, col + '55');
        g.addColorStop(1, col + '00');

        lctx.beginPath();
        lctx.moveTo(x(run[0]), y(pts[run[0]]));
        for (const i of run.slice(1)) lctx.lineTo(x(i), y(pts[i]));

        lctx.strokeStyle = col;
        lctx.lineWidth = 2.2;
        lctx.lineJoin = 'round';
        lctx.shadowColor = col;
        lctx.shadowBlur = 10;
        lctx.stroke();
        lctx.shadowBlur = 0;

        lctx.lineTo(x(run[run.length - 1]), hgt - pad);
        lctx.lineTo(x(run[0]), hgt - pad);
        lctx.closePath();
        lctx.fillStyle = g;
        lctx.fill();
      }
      run = [];
    };

    pts.forEach((v, i) => {
      if (v == null) {
        flush();
        // Red vertical packet drop bar
        lctx.fillStyle = '#ff1744';
        lctx.shadowColor = '#ff1744';
        lctx.shadowBlur = 8;
        lctx.fillRect(x(i) - 2, hgt - pad - 18, 4, 18);
        lctx.shadowBlur = 0;
      } else run.push(i);
    });
    flush();

    // Head pulse node
    const last = pts.length - 1;
    if (last >= 0 && pts[last] != null) {
      lctx.fillStyle = '#ffffff';
      lctx.shadowColor = col;
      lctx.shadowBlur = 12;
      lctx.beginPath();
      lctx.arc(x(last), y(pts[last]), 4, 0, Math.PI * 2);
      lctx.fill();
      lctx.shadowBlur = 0;
    }
  }

  let offTick = null;
  function startLive() {
    if (state.live.on) return;
    state.live = { on: true, pts: [], lost: 0, total: 0, rt: null };
    bz.monitorStart();
    offTick = bz.onMonitorTick((t) => {
      const L = state.live;
      if (!L.on) return;
      L.total++;
      if (t.internet == null) L.lost++;
      L.pts.push(t.internet);
      if (L.pts.length > LIVE_N) L.pts.shift();
      L.rt = t.router === undefined ? null : t.router;

      const ok = L.pts.filter((p) => p != null);
      const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
      let jit = null;
      if (ok.length > 1) {
        let s = 0;
        for (let i = 1; i < ok.length; i++) s += Math.abs(ok[i] - ok[i - 1]);
        jit = Math.round(s / (ok.length - 1));
      }

      $('#lv-now').textContent = t.internet == null ? '✕' : t.internet;
      $('#lv-avg').textContent = avg == null ? '—' : avg;
      $('#lv-jit').textContent = jit == null ? '—' : jit;
      $('#lv-loss').textContent = Math.round((L.lost / L.total) * 100) + '%';
      $('#lv-rt').textContent = t.router === undefined ? '—' : (t.router == null ? '✕' : t.router);
      drawLive();
    });
    drawLive();
  }

  function stopLive() {
    if (!state.live.on) return;
    state.live.on = false;
    bz.monitorStop();
    if (offTick) { offTick(); offTick = null; }
  }
  window.addEventListener('resize', () => { if (state.live.on) drawLive(); }, { passive: true });

  /* ---------- Settings Drawer ---------- */
  function paintHeader() {
    const s = state.info.settings;
    const ai = $('#ai-pill');
    $('#ai-pill-text').textContent = s.hasKey ? 'AI Active' : 'AI Off';
    ai.classList.toggle('on', s.hasKey);

    const ad = $('#admin-pill');
    $('#admin-pill-text').textContent = state.info.platform !== 'win32' ? 'Preview' : (state.info.admin ? 'Admin' : 'Limited');
    ad.classList.toggle('on', state.info.admin);
    $('#ver').textContent = 'v' + state.info.version;
  }

  function paintSettings() {
    const s = state.info.settings;
    $('#in-model').value = s.model;
    $('#in-verify').checked = s.autoVerify;
    $('#in-key').value = '';
    $('#in-key').placeholder = s.hasKey ? '•••••••• (Encrypted on device)' : 'sk-ant-…';
    $('#btn-clearkey').hidden = !s.hasKey;
  }

  function drawer(open) {
    const d = $('#drawer');
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', String(!open));
    if (open) paintSettings();
  }

  $('#btn-settings').addEventListener('click', () => drawer(!$('#drawer').classList.contains('open')));
  $('#btn-close').addEventListener('click', () => drawer(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  $('#btn-getkey').addEventListener('click', () => bz.openConsole());

  $('#btn-clearkey').addEventListener('click', async () => {
    state.info.settings = await bz.setSettings({ clearKey: true });
    paintSettings();
    paintHeader();
    toast('API key removed. Running local rules engine.');
  });

  $('#btn-save').addEventListener('click', async () => {
    const payload = { model: $('#in-model').value, autoVerify: $('#in-verify').checked };
    const key = $('#in-key').value.trim();
    if (key) payload.apiKey = key;
    state.info.settings = await bz.setSettings(payload);
    paintSettings();
    paintHeader();
    drawer(false);
    toast(key ? 'Saved. AI neural network engine enabled.' : 'Settings saved.');
  });

  /* ---------- Auto-Updates ---------- */
  const up = $('#update-pill');
  bz.onUpdate(({ state: s, version }) => {
    up.hidden = false;
    up.classList.toggle('wait', s !== 'ready');
    up.querySelector('span').textContent = s === 'ready' ? `Restart to update · v${version}` : `Downloading v${version}…`;
    if (s === 'ready') toast(`B-Z v${version} update downloaded — restart to install.`);
  });
  up.addEventListener('click', () => { if (!up.classList.contains('wait')) bz.installUpdate(); });

  /* ---------- Initialization ---------- */
  $('#btn-scan').addEventListener('click', runScan);
  $('#btn-apply').addEventListener('click', applyFixes);
  setAccent(store.get('bz.accent', 'crimson'), false);
  renderHistory();
  bz.info().then((info) => {
    state.info = info;
    state.catalog = info.catalog;
    paintHeader();
  });
})();
