'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const bz = window.bz;
  const state = { phase: 'idle', info: null, analysis: null, selected: new Set(), verifyFrom: null, catalog: {} };

  /* ---------- tiny DOM helper (textContent only: AI output is never parsed as HTML) ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  /* ---------- custom cursor ---------- */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dot = $('#cur-dot'), ring = $('#cur-ring');
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
  addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px)`;
    document.documentElement.style.setProperty('--mx', mx + 'px');
    document.documentElement.style.setProperty('--my', my + 'px');
    dot.classList.add('show'); ring.classList.add('show');
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
    const on = !!(e.target.closest && e.target.closest(interactive));
    ring.classList.toggle('hover', on); dot.classList.toggle('hover', on);
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
  function setPhase(p) { state.phase = p; document.body.dataset.state = p; }
  function setTone(t) { document.body.dataset.tone = t; }

  /* ---------- scan steps ---------- */
  const STEPS = [['adapters', 'Adapters'], ['gateway', 'Router'], ['internet', 'Internet'], ['dns', 'DNS'], ['web', 'Web'], ['speed', 'Speed'], ['ai', 'AI']];
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
    setPhase('scanning'); setTone('ok');
    resetSteps(state.info && state.info.settings.hasKey);
    $('#score').textContent = '…'; $('#label').textContent = 'Scanning';
    $('#headline').textContent = 'Reading your network…';
    $('#scan-text').textContent = 'Scanning';
    document.querySelectorAll('.node').forEach((n) => { n.className = 'node'; });
    document.querySelectorAll('.seg').forEach((n) => { n.className = 'seg'; });
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
    renderReport(res.analysis, verify ? state.verifyFrom : null);
    state.verifyFrom = null;
    setPhase('report');
    $('#scan-text').textContent = 'Scan again';
  }

  function renderScore(a) {
    setTone(toneFor(a.score));
    countTo($('#score'), a.score);
    $('#label').textContent = a.label;
    $('#headline').textContent = a.online ? (a.score >= 75 ? 'You’re in good shape.' : 'A few things to look at.') : 'You’re offline.';
    setGauge(a.score);
  }

  /* ---------- report ---------- */
  const METRICS = [
    ['Latency', (m) => m.latencyMs, 'ms', (v) => (v > 150 ? 'bad' : v > 80 ? 'warn' : 'good')],
    ['Loss', (m) => m.lossPct, '%', (v) => (v >= 10 ? 'bad' : v > 0 ? 'warn' : 'good')],
    ['Download', (m) => m.downMbps, 'Mbps', (v) => (v < 1 ? 'bad' : v < 5 ? 'warn' : 'good')],
    ['DNS', (m) => m.dnsMs, 'ms', (v) => (v > 250 ? 'warn' : 'good')],
  ];
  function renderReport(a, from) {
    renderScore(a);

    // path
    const nodes = [...document.querySelectorAll('.node')], segs = [...document.querySelectorAll('.seg')];
    a.path.forEach((p, i) => {
      nodes[i].className = 'node ' + p.status;
      if (i > 0) segs[i - 1].className = 'seg ' + (p.status === 'unknown' ? '' : p.status);
    });

    // summary
    $('#source-badge').textContent = a.source === 'ai' ? `AI · ${a.model || 'Claude'}` : 'Built-in rules';
    $('#summary-text').textContent = a.summary;
    const note = $('#ai-note');
    note.hidden = !a.aiError; note.textContent = a.aiError || '';
    const d = $('#delta');
    d.hidden = from == null; d.textContent = from == null ? '' : `score ${from} → ${a.score}`;

    // metrics
    const m = a.metrics, box = $('#metrics'); box.textContent = '';
    for (const [name, get, unit, grade] of METRICS) {
      const v = get(m);
      box.append(h('div', { class: 'tile ' + (v == null ? '' : grade(v)) }, h('b', null, v == null ? '—' : v, v == null ? null : h('small', null, unit)), h('span', null, name)));
    }
    if (m.signal != null) box.append(h('div', { class: 'tile ' + (m.signal < 40 ? 'bad' : m.signal < 60 ? 'warn' : 'good') }, h('b', null, m.signal, h('small', null, '%')), h('span', null, 'Wi-Fi signal')));
    else box.append(h('div', { class: 'tile' }, h('b', null, m.link || '—'), h('span', null, m.type ? `${m.type} link` : 'Link')));

    // findings
    const fl = $('#findings'); fl.textContent = '';
    for (const f of a.findings) fl.append(h('li', { class: 'finding ' + f.severity }, h('i', { class: 'dot' }), h('div', null, h('strong', null, f.title), h('p', null, f.detail))));

    renderFixes(a);
  }

  function renderFixes(a) {
    const list = $('#fixes'), log = $('#log');
    list.textContent = ''; log.textContent = '';
    state.selected = new Set();
    let dnsPicked = false;
    for (const f of a.fixes) {
      const meta = state.catalog[f.id]; if (!meta) continue;
      const isDns = f.id.startsWith('set-dns-');
      const on = meta.risk !== 'high' && !(isDns && dnsPicked);
      if (isDns && on) dnsPicked = true;
      if (on) state.selected.add(f.id);
      const cb = h('input', { type: 'checkbox', 'data-id': f.id, checked: on });
      cb.checked = on;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          state.selected.add(f.id);
          if (isDns) list.querySelectorAll('input[data-id^="set-dns-"]').forEach((o) => { if (o !== cb) { o.checked = false; state.selected.delete(o.dataset.id); } });
        } else state.selected.delete(f.id);
        updateApply();
      });
      const tags = h('div', { class: 'tags' }, meta.risk !== 'safe' ? h('span', { class: 'tag ' + meta.risk }, meta.risk) : null, meta.reboot ? h('span', { class: 'tag' }, 'restart') : null);
      list.append(h('li', { class: 'fix' }, cb, h('i', { class: 'box' }), h('div', { class: 't' }, h('strong', null, meta.title), h('p', null, f.reason || meta.desc)), tags));
    }
    if (!list.children.length) list.append(h('li', { class: 'empty' }, a.online ? 'Nothing to fix on this PC.' : 'No automatic fix applies. Check your modem, cable or router.'));
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
  bz.onFixStep((p) => {
    const row = $(`#log li[data-id="${p.id}"]`); if (!row) return;
    if (p.state === 'start') { row.className = 'run'; row.firstChild.textContent = '●'; return; }
    row.className = p.ok ? 'ok' : 'fail';
    row.firstChild.textContent = p.ok ? '✓' : '✕';
    row.lastChild.textContent = `${(state.catalog[p.id] || {}).title || p.id} — ${p.output}`;
  });

  async function applyFixes() {
    const ids = [...state.selected]; if (!ids.length) return;
    const log = $('#log'); log.textContent = '';
    for (const id of ids) log.append(h('li', { 'data-id': id }, h('span', { class: 's' }, '·'), h('span', null, (state.catalog[id] || {}).title || id)));
    $('#btn-apply').disabled = true;
    let results;
    try { results = await bz.fix(ids); } catch (e) { toast(String(e.message || e)); updateApply(); return; }
    const okCount = results.filter((r) => r.ok).length;
    const reboot = results.some((r) => r.reboot);
    if (reboot) toast('Restart Windows to finish the reset.');
    else toast(okCount === results.length ? 'Fixes applied.' : `${okCount} of ${results.length} fixes applied.`);
    if (okCount && !reboot && (state.info.settings.autoVerify)) {
      state.verifyFrom = state.analysis.score;
      toast('Fixes applied — checking again in a moment…');
      setTimeout(runScan, 6000);
    } else {
      $('#btn-apply').disabled = false;
    }
  }

  /* ---------- settings drawer ---------- */
  function paintHeader() {
    const s = state.info.settings;
    const ai = $('#ai-pill'); ai.textContent = s.hasKey ? 'AI on' : 'AI off'; ai.classList.toggle('on', s.hasKey);
    const ad = $('#admin-pill');
    ad.textContent = state.info.platform !== 'win32' ? 'Preview' : state.info.admin ? 'Admin' : 'Limited';
    ad.classList.toggle('on', state.info.admin);
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

  /* ---------- init ---------- */
  $('#btn-scan').addEventListener('click', runScan);
  $('#btn-apply').addEventListener('click', applyFixes);
  bz.info().then((info) => { state.info = info; state.catalog = info.catalog; paintHeader(); });
})();
