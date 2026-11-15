'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const bz = window.bz, FX = window.FX;
  const state = { phase: 'idle', info: null, analysis: null, selected: new Set(), verifyFrom: null, catalog: {}, live: { on: false, pts: [], lost: 0, total: 0, rt: null } };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Browser storage is a per-viewer convenience only; every access is guarded.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  /* ---------- tiny DOM helper (textContent only: AI output is never parsed as HTML) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  /* ---------- custom cursor ---------- */
  const dot = $('#cur-dot'), ring = $('#cur-ring'), ringLabel = ring.querySelector('em');
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
  addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px)`;
    const root = document.documentElement.style;
    root.setProperty('--mx', mx + 'px'); root.setProperty('--my', my + 'px');
    dot.classList.add('show'); ring.classList.add('show');

    // card spotlight
    const spot = e.target.closest && e.target.closest('.spot');
    if (spot) { const r = spot.getBoundingClientRect(); spot.style.setProperty('--x', e.clientX - r.left + 'px'); spot.style.setProperty('--y', e.clientY - r.top + 'px'); }

    // magnetic buttons
    if (!reduce) {
      for (const b of $$('.magnetic')) {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = e.clientX - cx, dy = e.clientY - cy;
        const near = Math.abs(dx) < r.width / 2 + 40 && Math.abs(dy) < r.height / 2 + 40;
        b.style.transform = near ? `translate(${dx * 0.22}px, ${dy * 0.3}px)` : '';
      }
    }
  });
  document.documentElement.addEventListener('mouseleave', () => { dot.classList.remove('show'); ring.classList.remove('show'); });
  (function loop() {
    const k = reduce ? 1 : 0.17;
    rx += (mx - rx) * k; ry += (my - ry) * k;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(loop);
  })();
  const interactive = 'button, a, input, label, .fix, .toggle';
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest ? e.target : null;
    const lab = t && t.closest('[data-cursor]');
    const on = !!(t && t.closest(interactive));
    ring.classList.toggle('label', !!lab);
    ring.classList.toggle('hover', on && !lab);
    dot.classList.toggle('hover', on);
    if (lab) ringLabel.textContent = lab.dataset.cursor;
  });
  addEventListener('pointerdown', (e) => {
    ring.classList.add('down');
    if (reduce) return;
    const r = h('span', { class: 'ripple' });
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.append(r);
    r.addEventListener('animationend', () => r.remove());
  });
  addEventListener('pointerup', () => ring.classList.remove('down'));

  /* ---------- tick gauge ---------- */
  const TICKS = 72, NS = 'http://www.w3.org/2000/svg';
  const ticks = [];
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2, major = i % 6 === 0;
    const r1 = major ? 104 : 110, r2 = 124;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', 140 + Math.cos(a) * r1); l.setAttribute('y1', 140 + Math.sin(a) * r1);
    l.setAttribute('x2', 140 + Math.cos(a) * r2); l.setAttribute('y2', 140 + Math.sin(a) * r2);
    l.setAttribute('class', 'tick' + (major ? ' major' : ''));
    $('#ticks').append(l); ticks.push(l);
  }
  let sweep = null;
  function stopSweep() { if (sweep) clearInterval(sweep); sweep = null; ticks.forEach((t) => { t.style.opacity = ''; }); }
  function startSweep() {
    stopSweep();
    let head = 0;
    sweep = setInterval(() => {
      head = (head + 1) % TICKS;
      ticks.forEach((t, i) => {
        const d = (head - i + TICKS) % TICKS;
        t.classList.toggle('on', d < 18);
        t.style.opacity = d < 18 ? String(1 - d / 18) : '0.4';
      });
    }, 36);
  }
  function setGauge(pct) {
    stopSweep();
    const target = Math.round((pct / 100) * TICKS);
    let i = 0;
    (function step() {
      ticks.forEach((t, k) => t.classList.toggle('on', k < i));
      if (i < target) { i += reduce ? target : 1; requestAnimationFrame(step); }
    })();
  }
  function countTo(el, to, ms = 900) {
    if (reduce) { el.textContent = to; return; }
    const t0 = performance.now();
    (function f(t) {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  /* ---------- helpers ---------- */
  const toneFor = (s) => (s >= 75 ? 'ok' : s >= 45 ? 'warn' : 'bad');
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }
  function setPhase(p) { state.phase = p; document.body.dataset.state = p; FX.setMode(p === 'scanning' ? 'scan' : 'idle'); }
  function setTone(t) { document.body.dataset.tone = t; FX.refresh(); setTimeout(FX.refresh, 80); }
  function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }

  /* ---------- accent themes ---------- */
  function setAccent(a, save) {
    document.body.dataset.accent = a;
    $$('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.accent === a));
    if (save) store.set('bz.accent', a);
    FX.refresh(); setTimeout(FX.refresh, 80);
  }
  $('#swatches').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAccent(b.dataset.accent, true); });

  /* ---------- tabs ---------- */
  function setTab(t) {
    document.body.dataset.tab = t;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'live') startLive(); else stopLive();
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btn-live').addEventListener('click', () => { if (state.phase === 'idle') setPhase('report'); setTab('live'); });

  /* ---------- scan history (score sparkline) ---------- */
  function renderHistory() {
    const box = $('#history'); box.textContent = '';
    for (const s of store.get('bz.history', []).slice(-14)) {
      const el = h('i', { class: toneFor(s) }); el.style.height = Math.max(4, Math.round((s / 100) * 24)) + 'px'; el.title = `Score ${s}`;
      box.append(el);
    }
  }
  function pushHistory(s) { const hs = store.get('bz.history', []); hs.push(s); store.set('bz.history', hs.slice(-14)); renderHistory(); }

  /* ---------- scan steps ---------- */
  const STEPS = [['adapters', 'Adapters'], ['gateway', 'Router'], ['internet', 'Internet'], ['dns', 'DNS race'], ['web', 'Web'], ['speed', 'Speed'], ['ai', 'AI']];
  function resetSteps(withAi) {
    const ol = $('#steps'); ol.textContent = '';
    for (const [id, label] of STEPS) if (id !== 'ai' || withAi) ol.append(h('li', { 'data-id': id }, label));
  }
  bz.onScanStep(({ id, state: s }) => {
    const li = $(`#steps li[data-id="${id}"]`);
    if (li) li.className = s === 'start' ? 'active' : 'done';
  });

  /* ---------- scan ---------- */
  async function runScan() {
    if (state.phase === 'scanning') return;
    const verify = state.verifyFrom != null;
    stopLive();
    setPhase('scanning'); setTone('ok');
    $('#ring-wrap').classList.remove('healthy');
    resetSteps(state.info && state.info.settings.hasKey);
    $('#score').textContent = '…'; $('#label').textContent = 'Scanning';
    $('#headline').textContent = 'Reading your network…';
    $('#scan-text').textContent = 'Scanning';
    $$('.node').forEach((n) => { n.className = 'node'; });
    $$('.seg').forEach((n) => { n.className = 'seg'; });
    ticks.forEach((t) => t.classList.remove('on'));
    startSweep();
    let res;
    try { res = await bz.scan(); } catch (e) { res = { error: String(e.message || e) }; }
    if (!res || res.error) {
      toast((res && res.error) || 'Scan failed.');
      stopSweep();
      setPhase(state.analysis ? 'report' : 'idle');
      $('#scan-text').textContent = state.analysis ? 'Scan again' : 'Scan';
      if (state.analysis) renderScore(state.analysis); else { $('#score').textContent = '—'; $('#label').textContent = 'Ready'; $('#headline').textContent = 'Your connection, diagnosed.'; }
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
      setTimeout(() => FX.burst(x, y, 70), 700);
    }
  }

  function renderScore(a) {
    const tone = toneFor(a.score);
    setTone(tone);
    countTo($('#score'), a.score);
    $('#label').textContent = a.label;
    $('#headline').textContent = a.online ? (a.score >= 75 ? 'You’re in good shape.' : 'A few things to look at.') : 'You’re offline.';
    $('#ring-wrap').classList.toggle('healthy', tone === 'ok');
    setGauge(a.score);
  }

  /* ---------- report ---------- */
  const METRICS = [
    ['Latency', (m) => m.latencyMs, 'ms', (v) => (v > 150 ? 'bad' : v > 80 ? 'warn' : 'good')],
    ['Loss', (m) => m.lossPct, '%', (v) => (v >= 10 ? 'bad' : v > 0 ? 'warn' : 'good')],
    ['Download', (m) => m.downMbps, 'Mbps', (v) => (v < 1 ? 'bad' : v < 5 ? 'warn' : 'good')],
    ['DNS', (m) => m.dnsMs, 'ms', (v) => (v > 250 ? 'warn' : 'good')],
  ];
  function renderRace(a) {
    const box = $('#race'); box.textContent = '';
    if (!a.race) { box.append(h('div', { class: 'hint' }, 'No DNS data.')); return; }
    const lanes = [{ name: 'Your DNS', you: true, ...(a.race.yours || { ok: false, ms: null }) }, ...a.race.providers.map((p) => ({ ...p, best: p.id === a.race.best }))];
    const oks = lanes.filter((l) => l.ok && l.ms != null).map((l) => l.ms);
    const max = Math.max(40, ...oks);
    const rows = [lanes[0], ...lanes.slice(1).sort((x, y) => (x.ok ? x.ms : 1e9) - (y.ok ? y.ms : 1e9))];
    rows.forEach((l, i) => {
      const w = l.ok && l.ms != null ? Math.max(6, Math.round((l.ms / max) * 100)) : 100;
      const lane = h('div', { class: 'lane' + (l.you ? ' you' : '') + (l.best ? ' best' : '') + (!l.ok ? ' fail' : ''), style: `--i:${i};--w:${w}%` },
        h('span', { class: 'nm' }, l.name), h('div', { class: 'track' }, h('i')), h('span', { class: 'ms' }, l.ok && l.ms != null ? `${l.ms} ms` : 'no reply'));
      box.append(lane);
    });
  }
  function renderReport(a, from) {
    renderScore(a);
    const nodes = $$('.node'), segs = $$('.seg');
    a.path.forEach((p, i) => {
      nodes[i].className = 'node ' + p.status;
      if (i > 0) segs[i - 1].className = 'seg ' + (p.status === 'unknown' ? '' : p.status);
    });

    $('#source-badge').textContent = a.source === 'ai' ? `AI · ${a.model || 'Claude'}` : 'Built-in rules';
    $('#summary-text').textContent = a.summary;
    const note = $('#ai-note'); note.hidden = !a.aiError; note.textContent = a.aiError || '';
    const d = $('#delta'); d.hidden = from == null; d.textContent = from == null ? '' : `score ${from} → ${a.score}`;
    if (from != null && a.score > from) { const [x, y] = centerOf($('#ring-wrap')); setTimeout(() => FX.burst(x, y, 110), 600); }

    const m = a.metrics, box = $('#metrics'); box.textContent = '';
    let i = 0;
    const tile = (cls, big, unit, name) => h('div', { class: 'tile spot rise ' + cls, style: `--i:${i++}` }, h('b', null, big, unit ? h('small', null, unit) : null), h('span', null, name));
    for (const [name, get, unit, grade] of METRICS) { const v = get(m); box.append(tile(v == null ? '' : grade(v), v == null ? '—' : v, v == null ? '' : unit, name)); }
    if (m.signal != null) box.append(tile(m.signal < 40 ? 'bad' : m.signal < 60 ? 'warn' : 'good', m.signal, '%', 'Wi-Fi signal'));
    else box.append(tile('', m.link || '—', '', m.type ? `${m.type} link` : 'Link'));

    renderRace(a);

    const fl = $('#findings'); fl.textContent = '';
    a.findings.forEach((f, k) => fl.append(h('li', { class: 'finding spot rise ' + f.severity, style: `--i:${k}` }, h('i', { class: 'dot' }), h('div', null, h('strong', null, f.title), h('p', null, f.detail)))));
    renderFixes(a);
  }

  function renderFixes(a) {
    const list = $('#fixes'), log = $('#log');
    list.textContent = ''; log.textContent = ''; $('#fix-progress').hidden = true;
    state.selected = new Set();
    let dnsPicked = false;
    a.fixes.forEach((f, k) => {
      const meta = state.catalog[f.id]; if (!meta) return;
      const isDns = f.id.startsWith('set-dns-');
      const on = meta.risk !== 'high' && !(isDns && dnsPicked);
      if (isDns && on) dnsPicked = true;
      if (on) state.selected.add(f.id);
      const cb = h('input', { type: 'checkbox', 'data-id': f.id });
      cb.checked = on;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          state.selected.add(f.id);
          if (isDns) list.querySelectorAll('input[data-id^="set-dns-"]').forEach((o) => { if (o !== cb) { o.checked = false; state.selected.delete(o.dataset.id); } });
        } else state.selected.delete(f.id);
        updateApply();
      });
      const tags = h('div', { class: 'tags' }, meta.risk !== 'safe' ? h('span', { class: 'tag ' + meta.risk }, meta.risk) : null, meta.reboot ? h('span', { class: 'tag' }, 'restart') : null);
      list.append(h('li', { class: 'fix spot rise', style: `--i:${k}` }, cb, h('i', { class: 'box' }), h('div', { class: 't' }, h('strong', null, meta.title), h('p', null, f.reason || meta.desc)), tags));
    });
    if (!list.children.length) list.append(h('li', { class: 'hint' }, a.online ? 'Nothing to fix on this PC. ✨' : 'No automatic fix applies. Check your modem, cable or router.'));
    updateApply();
  }

  function updateApply() {
    const n = state.selected.size, b = $('#btn-apply');
    b.hidden = !$('#fixes input'); b.disabled = n === 0;
    b.textContent = n ? `Apply ${n} fix${n > 1 ? 'es' : ''}` : 'Apply fixes';
    const needAdmin = state.info && !state.info.admin && [...state.selected].some((id) => state.catalog[id] && state.catalog[id].admin);
    $('#fix-hint').textContent = needAdmin ? 'Most fixes need administrator rights. Restart B-Z as administrator.' : '';
  }

  /* ---------- apply fixes ---------- */
  let fixTotal = 0, fixDone = 0;
  bz.onFixStep((p) => {
    const row = $(`#log li[data-id="${p.id}"]`); if (!row) return;
    const label = (state.catalog[p.id] || {}).title || p.id;
    if (p.state === 'start') { row.className = 'run'; row.children[0].textContent = '●'; return; }
    row.className = p.ok ? 'ok' : 'fail';
    row.children[0].textContent = p.ok ? '✓' : '✕';
    row.children[1].textContent = `${label} — ${p.output}`;
    if (p.ok && p.id.startsWith('set-dns-')) {
      row.children[2].append(h('button', { class: 'undo', 'data-cursor': 'undo', onclick: async () => {
        const r = await bz.fix(['reset-dns-auto']);
        toast(r[0] && r[0].ok ? 'DNS restored to automatic.' : (r[0] ? r[0].output : 'Undo failed.'));
        row.children[2].textContent = '';
      } }, 'undo'));
    }
    fixDone++;
    $('#fix-progress i').style.width = Math.round((fixDone / fixTotal) * 100) + '%';
  });

  async function applyFixes() {
    const ids = [...state.selected]; if (!ids.length) return;
    const log = $('#log'); log.textContent = '';
    for (const id of ids) log.append(h('li', { 'data-id': id }, h('span', { class: 's' }, '·'), h('span', null, (state.catalog[id] || {}).title || id), h('span')));
    fixTotal = ids.length; fixDone = 0;
    const pb = $('#fix-progress'); pb.hidden = false; pb.firstElementChild.style.width = '0%';
    $('#btn-apply').disabled = true;
    let results;
    try { results = await bz.fix(ids); } catch (e) { toast(String(e.message || e)); updateApply(); return; }
    const okCount = results.filter((r) => r.ok).length;
    const reboot = results.some((r) => r.reboot);
    if (okCount) { const [x, y] = centerOf($('#btn-apply')); FX.burst(x, y, 60); }
    if (reboot) toast('Restart Windows to finish the reset.');
    else toast(okCount === results.length ? 'Fixes applied.' : `${okCount} of ${results.length} fixes applied.`);
    if (okCount && !reboot && state.info.settings.autoVerify) {
      state.verifyFrom = state.analysis.score;
      toast('Fixes applied — checking again in a moment…');
      setTimeout(runScan, 6000);
    } else {
      $('#btn-apply').disabled = false;
    }
  }

  /* ---------- live pulse ---------- */
  const lc = $('#live-canvas'), lctx = lc.getContext('2d');
  const LIVE_N = 60;
  function liveColor() { return getComputedStyle(document.body).getPropertyValue('--tone').trim() || '#c8ff3e'; }
  function drawLive() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = lc.clientWidth, hgt = lc.clientHeight;
    if (!w || !hgt) return;
    if (lc.width !== Math.round(w * dpr)) { lc.width = Math.round(w * dpr); lc.height = Math.round(hgt * dpr); }
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, hgt);
    const pts = state.live.pts, ok = pts.filter((p) => p != null);
    const maxV = Math.max(60, ...ok) * 1.15, pad = 14, bw = (w - pad * 2) / (LIVE_N - 1), y = (v) => hgt - pad - (v / maxV) * (hgt - pad * 2);
    lctx.strokeStyle = 'rgba(255,255,255,0.05)'; lctx.lineWidth = 1; lctx.fillStyle = 'rgba(255,255,255,0.28)'; lctx.font = '10px "Cascadia Mono", monospace';
    for (let i = 1; i <= 3; i++) { const v = (maxV / 4) * i, yy = y(v); lctx.beginPath(); lctx.moveTo(pad, yy); lctx.lineTo(w - pad, yy); lctx.stroke(); lctx.fillText(Math.round(v) + 'ms', pad + 2, yy - 3); }
    const off = LIVE_N - pts.length, col = liveColor();
    const x = (i) => pad + (off + i) * bw;
    // area + line over contiguous runs
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const g = lctx.createLinearGradient(0, 0, 0, hgt); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
        lctx.beginPath(); lctx.moveTo(x(run[0]), y(pts[run[0]]));
        for (const i of run.slice(1)) lctx.lineTo(x(i), y(pts[i]));
        lctx.strokeStyle = col; lctx.lineWidth = 2; lctx.lineJoin = 'round'; lctx.shadowColor = col; lctx.shadowBlur = 8; lctx.stroke(); lctx.shadowBlur = 0;
        lctx.lineTo(x(run[run.length - 1]), hgt - pad); lctx.lineTo(x(run[0]), hgt - pad); lctx.closePath(); lctx.fillStyle = g; lctx.fill();
      }
      run = [];
    };
    pts.forEach((v, i) => { if (v == null) { flush(); lctx.fillStyle = '#ff5d5d'; lctx.fillRect(x(i) - 1.5, hgt - pad - 14, 3, 14); } else run.push(i); });
    flush();
    const last = pts.length - 1;
    if (last >= 0 && pts[last] != null) { lctx.fillStyle = col; lctx.beginPath(); lctx.arc(x(last), y(pts[last]), 4, 0, 6.2832); lctx.fill(); }
  }
  let offTick = null;
  function startLive() {
    if (state.live.on) return;
    state.live = { on: true, pts: [], lost: 0, total: 0, rt: null };
    bz.monitorStart();
    offTick = bz.onMonitorTick((t) => {
      const L = state.live; if (!L.on) return;
      L.total++; if (t.internet == null) L.lost++;
      L.pts.push(t.internet); if (L.pts.length > LIVE_N) L.pts.shift();
      L.rt = t.router === undefined ? null : t.router;
      const ok = L.pts.filter((p) => p != null);
      const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
      let jit = null; if (ok.length > 1) { let s = 0; for (let i = 1; i < ok.length; i++) s += Math.abs(ok[i] - ok[i - 1]); jit = Math.round(s / (ok.length - 1)); }
      $('#lv-now').textContent = t.internet == null ? '✕' : t.internet;
      $('#lv-avg').textContent = avg == null ? '—' : avg;
      $('#lv-jit').textContent = jit == null ? '—' : jit;
      $('#lv-loss').textContent = Math.round((L.lost / L.total) * 100) + '%';
      $('#lv-rt').textContent = t.router === undefined ? '—' : t.router == null ? '✕' : t.router;
      drawLive();
    });
    drawLive();
  }
  function stopLive() {
    if (!state.live.on) return;
    state.live.on = false; bz.monitorStop();
    if (offTick) { offTick(); offTick = null; }
  }
  addEventListener('resize', () => { if (state.live.on) drawLive(); });

  /* ---------- settings drawer ---------- */
  function paintHeader() {
    const s = state.info.settings;
    const ai = $('#ai-pill'); ai.textContent = s.hasKey ? 'AI on' : 'AI off'; ai.classList.toggle('on', s.hasKey);
    const ad = $('#admin-pill');
    ad.textContent = state.info.platform !== 'win32' ? 'Preview' : state.info.admin ? 'Admin' : 'Limited';
    ad.classList.toggle('on', state.info.admin);
    $('#ver').textContent = 'v' + state.info.version;
  }
  function paintSettings() {
    const s = state.info.settings;
    $('#in-model').value = s.model; $('#in-verify').checked = s.autoVerify;
    $('#in-key').value = ''; $('#in-key').placeholder = s.hasKey ? '•••••••• (key saved)' : 'sk-ant-…';
    $('#btn-clearkey').hidden = !s.hasKey;
  }
  function drawer(open) {
    const d = $('#drawer'); d.classList.toggle('open', open); d.setAttribute('aria-hidden', String(!open));
    if (open) paintSettings();
  }
  $('#btn-settings').addEventListener('click', () => drawer(!$('#drawer').classList.contains('open')));
  $('#btn-close').addEventListener('click', () => drawer(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  $('#btn-getkey').addEventListener('click', () => bz.openConsole());
  $('#btn-clearkey').addEventListener('click', async () => {
    state.info.settings = await bz.setSettings({ clearKey: true }); paintSettings(); paintHeader(); toast('Key removed.');
  });
  $('#btn-save').addEventListener('click', async () => {
    const payload = { model: $('#in-model').value, autoVerify: $('#in-verify').checked };
    const key = $('#in-key').value.trim(); if (key) payload.apiKey = key;
    state.info.settings = await bz.setSettings(payload);
    paintSettings(); paintHeader(); drawer(false);
    toast(key ? 'Saved. AI analysis is on.' : 'Settings saved.');
  });

  /* ---------- updates ---------- */
  const up = $('#update-pill');
  bz.onUpdate(({ state: s, version }) => {
    up.hidden = false;
    up.classList.toggle('wait', s !== 'ready');
    up.textContent = s === 'ready' ? `Restart to update · v${version}` : `Downloading v${version}…`;
    if (s === 'ready') toast(`B-Z ${version} is ready — click Update to restart.`);
  });
  up.addEventListener('click', () => { if (!up.classList.contains('wait')) bz.installUpdate(); });

  /* ---------- init ---------- */
  $('#btn-scan').addEventListener('click', runScan);
  $('#btn-apply').addEventListener('click', applyFixes);
  setAccent(store.get('bz.accent', 'lime'), false);
  renderHistory();
  bz.info().then((info) => { state.info = info; state.catalog = info.catalog; paintHeader(); });
})();
