/* ============================================================================
   DASHBOARD — command bar, KPIs, detail panel, tracker, tables, feed drawer.
   Reads the simulation state a few times a second; never writes to it.
   ========================================================================== */

const $ = id => document.getElementById(id);
/* write markup only when it changed, so buttons under the pointer are not rebuilt for nothing */
/* Replace only the top-level blocks that changed, so a button is not rebuilt because a number next to it ticked. */
const setHTML = (el, h) => {
  if (el._h === h) return; el._h = h;
  const t = document.createElement('template'); t.innerHTML = h;
  const nw = Array.from(t.content.childNodes), old = Array.from(el.childNodes);
  if (nw.length !== old.length || nw.length < 2) { el.innerHTML = h; return; }
  for (let i = 0; i < nw.length; i++) { const a = old[i], b = nw[i]; if (a.nodeType !== b.nodeType || (a.nodeType === 1 ? a.outerHTML !== b.outerHTML : a.textContent !== b.textContent)) el.replaceChild(b, a); }
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const POD_CLS = { DRY: 'mute', COLD: 'info', LIQ: 'warn', SENS: 'mx', DEF: 'ok' };
/* ---------- truck-dock volume reporting ---------- */
const tn = kg => (kg / 1000).toFixed(kg >= 10000 ? 1 : 2) + ' t';
const flowSum = list => { const o = { pods: 0, pallets: 0, kg: 0, by: {}, lane: {} };
  for (const f of list) { o.pods += f.pods; o.pallets += f.pallets; o.kg += f.kg;
    for (const k in f.by) { const b = o.by[k] || (o.by[k] = { pods: 0, kg: 0 }); b.pods += f.by[k].pods; b.kg += f.by[k].kg; }
    for (const k in f.lane) { const b = o.lane[k] || (o.lane[k] = { pods: 0, kg: 0 }); b.pods += f.lane[k].pods; b.kg += f.lane[k].kg; } }
  return o; };
const drywet = f => { const d = { pods: 0, kg: 0 }, w = { pods: 0, kg: 0 }; for (const k in f.by) { const t = WET_TYPES[k] ? w : d; t.pods += f.by[k].pods; t.kg += f.by[k].kg; } return { d, w }; };
const pk = x => x && x.pods ? x.pods + ' · ' + tn(x.kg) : '—';
const volTable = (fin, fout) => { const a = drywet(fin), b = drywet(fout), tot = flowSum([fin, fout]), c = drywet(tot);
  const r = (l, x, y, z, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + l + '</td><td>' + x + '</td><td>' + y + '</td><td class="w">' + z + '</td></tr>';
  return '<table class="dt"><thead><tr><th></th><th>INBOUND</th><th>OUTBOUND</th><th>TOTAL</th></tr></thead><tbody>' +
    r('PODS', fin.pods, fout.pods, tot.pods) + r('PALLETS', fin.pallets, fout.pallets, tot.pallets) + r('WEIGHT', tn(fin.kg), tn(fout.kg), tn(tot.kg), 'tot') +
    r('VOLUME', (fin.pallets * PALLET_M3).toFixed(1) + ' m³', (fout.pallets * PALLET_M3).toFixed(1) + ' m³', (tot.pallets * PALLET_M3).toFixed(1) + ' m³') +
    r('DRY PODS', a.d.pods, b.d.pods, c.d.pods) + r('DRY WEIGHT', tn(a.d.kg), tn(b.d.kg), tn(c.d.kg)) + r('WET PODS', a.w.pods, b.w.pods, c.w.pods) + r('WET WEIGHT', tn(a.w.kg), tn(b.w.kg), tn(c.w.kg)) + '</tbody></table>'; };
const INSPECT_S = 1.5 * 3600;
/* [where, css class, status] for an airframe that is stood down */
const restState = (sim, a) => {
  const S = sim.sites[a.site], where = a.restAt === 'HANGAR' ? (S.kind === 'MRO' ? 'MRO HANGAR' : 'LINE HANGAR') : a.restAt === 'STAND' ? (S.kind === 'DC' ? 'PARKING SLOT' : 'STAND S' + (a.stand + 1)) : 'PAD ' + (S.pads[a.pad] ? S.pads[a.pad].id : '');
  if (a.mxUntil) return [where, 'mx', 'BASIC CHECK · ' + fmtDur(Math.max(0, a.mxUntil - sim.t)) + ' LEFT'];
  if (sim.t - a.tRest < INSPECT_S) return [where, 'mute', 'DAILY INSPECTION'];
  return [where, 'ok', 'READY'];
};
const kindLabel = S => S.def.port ? 'PORT DISTRIBUTION CENTRE' : KIND_LABEL[S.kind];
const KIND_LABEL = { BASE: 'BASE', DC: 'DISTRIBUTION CENTRE', MRO: 'MRO HUB', DOCKYARD: 'NAVAL BASE', SHOREBASE: 'SHORE BASE', SHIP: 'VESSEL UNDER WAY', PLATFORM: 'OFFSHORE PLATFORM' };

class UI {
  constructor(app) {
    this.app = app; this.sim = app.sim; this.tab = 'FLEET'; this.featCs = null; this.tFeat = 0; this.lastDetailKey = ''; this.qi = 0;
    this._static(); this._events(); this.ops = new OpsReport(this);
  }
  scnDef() { return this.sim.scn[this.app.scn].def; }

  /* ---------- static chrome ---------- */
  _static() {
    $('tabs').innerHTML = SCENARIOS.map(s => '<button class="tab" type="button" data-scn="' + s.id + '" style="--sc:' + s.color + '"><b>' + esc(s.name) + '</b><i>' + esc(s.stage) + '</i></button>').join('');
    $('speed').innerHTML = [['0', '❚❚'], ['1', '1×'], ['10', '10×'], ['30', '30×'], ['120', '120×'], ['600', '600×']].map(s => '<button type="button" data-v="' + s[0] + '" aria-label="' + (s[0] === '0' ? 'Pause or resume' : 'Run at ' + s[0] + ' times real time') + '">' + s[1] + '</button>').join('') + '<button type="button" class="today" data-v="today" aria-label="Back to today on the calendar" hidden>TODAY</button>';
    $('wx').innerHTML = ['CLEAR', 'HAZE', 'RAIN', 'FOG'].map(w => '<button type="button" data-v="' + w + '">' + w + '</button>').join('');
    $('light').innerHTML = ['AUTO', 'DAY', 'DUSK', 'NIGHT'].map(w => '<button type="button" data-v="' + w + '">' + w + '</button>').join('');
    $('tt').innerHTML = ['FLEET', 'CORRIDORS', 'SITES', 'REQUESTS', 'LOG'].map(t => '<button type="button" data-t="' + t + '">' + t + '</button>').join('') + '<div class="grow" id="ttNote"></div>';
  }
  _events() {
    const app = this.app, on = (id, ev, fn) => $(id).addEventListener(ev, fn), btn = (e, attr) => { const b = e.target.closest('button[' + attr + ']'); return b ? b.getAttribute(attr) : null; };
    on('tabs', 'click', e => { const v = btn(e, 'data-scn'); if (v) app.setScenario(v); });
    on('speed', 'click', e => { const v = btn(e, 'data-v'); if (v === 'today') app.backToToday(); else if (v != null) app.setSpeed(+v); });
    on('wx', 'click', e => { const v = btn(e, 'data-v'); if (v) { app.wx = v; app.sim.wx = v; this.chrome(); } });
    on('light', 'click', e => { const v = btn(e, 'data-v'); if (v) { app.light = v; this.chrome(); } });
    on('tt', 'click', e => { const v = btn(e, 'data-t'); if (v) { this.tab = v; this.tables(true); } });
    on('areas', 'click', e => { const s = btn(e, 'data-site'), a = btn(e, 'data-area'), z = btn(e, 'data-zone'); if (z) app.flyZone(z); else if (s) app.select({ type: 'site', id: s }, true); else if (a != null) app.site.goArea(+a); });
    on('crumb', 'click', e => { if (btn(e, 'data-back') != null) app.exitSite(); });
    on('tw', 'click', e => { const r = e.target.closest('tr[data-k]'); if (r) { const [type, id] = r.getAttribute('data-k').split('|'); app.select({ type, id }, true); } });
    const act = e => { const b = e.target.closest('[data-act]'); if (!b) return; const a = b.getAttribute('data-act'), v = b.getAttribute('data-v');
      if (a === 'enter') app.enterSite(v); else if (a === 'exit') app.exitSite(); else if (a === 'sel') { const [type, id] = v.split('|'); app.select({ type, id }, true); }
      else if (a === 'follow') app.toggleFollow(); else if (a === 'actab') { this.acTab = v; this.detail(true); } else if (a === 'csv-ac') this.csvAircraft(v); else if (a === 'clear') app.select(null); else if (a === 'feed') this.feed(true); else if (a === 'closefeed') this.feed(false); };
    on('detail', 'click', act); on('track', 'click', act); on('feed', 'click', act);
    on('feedBtn', 'click', () => this.feed($('feed').hidden));
    on('opsBtn', 'click', () => this.ops.show(!this.ops.open)); on('kpi', 'click', e => { if (e.target.closest('[data-ops]')) this.ops.show(true); });
    on('sheetbar', 'click', e => { const s = btn(e, 'data-s'); if (!s) return; const el = $('app'); el.setAttribute('data-sheet', el.getAttribute('data-sheet') === s ? '' : s); app._applyInsets(); this.chrome(); });
    // search
    const q = $('q'), res = $('qres');
    const run = () => {
      const t = q.value.trim().toUpperCase(); if (!t) { res.hidden = true; return; }
      const out = [];
      for (const id in this.sim.sites) { const s = this.sim.sites[id]; if (id.includes(t) || s.name.toUpperCase().includes(t)) out.push(['site', id, s.name, kindLabel(s)]); }
      for (const id in this.sim.routes) if (id.includes(t)) out.push(['route', id, id + '  ' + this.sim.routes[id].name, 'CORRIDOR']);
      for (const a of this.sim.aircraft) { if (a.cs.includes(t)) out.push(['aircraft', a.cs, a.cs, PHASE_LABEL[a.phase]]); else if (a.pod && a.pod.id.includes(t)) out.push(['aircraft', a.cs, a.pod.id + ' on ' + a.cs, 'POD']); }
      this.qres = out.slice(0, 9); this.qi = 0;
      res.innerHTML = this.qres.length ? this.qres.map((r, i) => '<button type="button" data-i="' + i + '"' + (i === 0 ? ' class="hi"' : '') + '>' + esc(r[2]) + '<span>' + esc(r[3]) + '</span></button>').join('') : '<button type="button" disabled>No match<span></span></button>';
      res.hidden = false;
    };
    const go = i => { const r = this.qres && this.qres[i]; if (!r) return; app.select({ type: r[0], id: r[1] }, true); q.value = ''; res.hidden = true; q.blur(); };
    q.addEventListener('input', run);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') go(this.qi); if (e.key === 'Escape') { q.value = ''; res.hidden = true; q.blur(); } });
    res.addEventListener('click', e => { const i = btn(e, 'data-i'); if (i != null) go(+i); });
    q.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 180));
  }

  /* ---------- frequently refreshed chrome ---------- */
  chrome() {
    const app = this.app, sim = this.sim, sc = this.scnDef();
    for (const b of $('tabs').children) b.classList.toggle('on', b.getAttribute('data-scn') === app.scn);
    for (const b of $('speed').children) { if (b.getAttribute('data-v') === 'today') { b.hidden = !app.live.shared; b.classList.toggle('on', app.live.shared && Math.abs(app.live.drift()) < 180 && !app.paused); continue; } b.classList.toggle('on', +b.getAttribute('data-v') === (app.paused ? 0 : app.speed)); }
    for (const b of $('wx').children) b.classList.toggle('on', b.getAttribute('data-v') === app.wx);
    for (const b of $('light').children) b.classList.toggle('on', b.getAttribute('data-v') === app.light);
    $('opsBtn').classList.toggle('on', !!(this.ops && this.ops.open));
    for (const b of $('tt').querySelectorAll('button')) b.classList.toggle('on', b.getAttribute('data-t') === this.tab);
    for (const b of $('sheetbar').children) b.classList.toggle('on', b.getAttribute('data-s') === $('app').getAttribute('data-sheet'));
    const inSite = app.view === 'site', S = inSite ? sim.sites[app.siteId] : null;
    $('crumb').innerHTML = inSite ? '<button type="button" data-back="1">← NETWORK</button><span>▸</span><b>' + esc(S.name.toUpperCase()) + '</b>' : '<b>NETWORK</b><span>▸</span><span>' + esc(sc.sub.toUpperCase()) + '</span>';
    $('areas').innerHTML = inSite ? app.site.areas.map((a, i) => '<button type="button" data-area="' + i + '">' + esc(a[0].toUpperCase()) + '</button>').join('')
      : (sc.zones ? Object.entries(sc.zones).map(([z, Z]) => '<button type="button" class="zone" data-zone="' + z + '">' + esc(Z.name.toUpperCase()) + ' ▸</button>').join('') : '') +
        sc.sites.filter(s => sc.sites.length <= 20 || s.kind === 'BASE' || s.kind === 'MRO').map((s, i) => '<button type="button" data-site="' + s.id + '"' + (i === 0 || s.kind === 'BASE' ? ' class="base"' : '') + '>' + esc((sc.sites.length > 8 ? s.name.replace(/ DC$/, '') : s.name).toUpperCase()) + '</button>').join('') +
        (sc.sites.length > 20 && sc.sites.some(s => s.kind === 'DC') ? '<span class="more">+ ' + sc.sites.filter(s => s.kind === 'DC').length + ' DCs · click one on the map</span>' : '');
    $('hint').hidden = app.tReal > 40; $('scale').hidden = inSite;
  }
  clock() { const t = this.sim.t, app = this.app; $('clock').textContent = fmtClock(t, true); const c = $('clockSub'); if (c) { const loc = 'AST · UAE ' + fmtClock(t + 3600) + ' · ';
      const txt = loc + 'DAY ' + dayOf(t) + ' · ' + dateOf(t).toUpperCase() + ' · ' + app.live.label(); if (c.textContent !== txt) c.textContent = txt; c.classList.toggle('pv', app.paused); } }

  kpis() {
    const sim = this.sim, k = sim.kpi(this.app.scn), sc = this.scnDef(), fl = sim.aircraft.filter(a => a.scn === sc.id);
    const stby = fl.filter(a => a.phase === 'STANDBY').length, rev = k.fleet - stby;
    // surface comparison: today's legs, each against the real road (or road + ferry, or boat) time of its own corridor
    let sw = 0, ss = 0, sMode = {}; const LR = sim.led ? sim.led.route : {};
    for (const id in LR) { const R = sim.routes[id]; if (!R || R.scn !== sc.id || R.mro) continue; const n = LR[id].legs || 0, f = surfaceOf(R); sw += n; ss += n * f.s; sMode[f.mode] = (sMode[f.mode] || 0) + n; }
    const surf = sw ? ss / sw : 0, surfLbl = (Object.entries(sMode).sort((p, q) => q[1] - p[1])[0] || ['BY ROAD'])[0].replace('BY ', '').toLowerCase();
    const D = sim.led.scn[sc.id] || ledRec();
    const cards = [
      ['AIRBORNE', k.airborne + '<small>/ ' + rev + '</small>', k.ground + ' on pads · ' + k.maint + ' in check<br>' + (k.hangar + k.stands) + ' stood down' + (stby ? ' · ' + stby + ' spare' : ''), k.airborne / Math.max(1, rev)],
      ['DELIVERED TODAY', (D.kg / 1000).toFixed(1) + '<small>t</small>', fmtInt(D.pods) + ' pods · ' + fmtInt(D.cons || 0) + ' consignments<br>load factor ' + (D.capKg ? (D.kg / D.capKg * 100).toFixed(0) : '—') + '% · since 06:00', null],
      ['REVENUE TODAY <u>→</u>', inr(D.rev), 'dry ' + inr(D.revDry) + '<br>wet ' + inr(D.revWet), null, true],
      ['AVG BLOCK TIME', fmtDur(k.avgBlockS), surfLbl + ' ≈ ' + fmtDur(surf) + '<br>on the same legs, real routes', k.avgBlockS && surf ? k.avgBlockS / surf : 0],
      ['ON TIME', (D.legs ? (1 - D.late / D.legs) * 100 : 100).toFixed(1) + '<small>%</small>', fmtInt(D.holds) + (D.holds === 1 ? ' hold' : ' holds') + ' today<br>minima ' + CORRIDOR.sepVertFt + ' ft · ' + CORRIDOR.sepTrailKm.toFixed(1) + ' km', null]
    ];
    setHTML($('kpi'), cards.map(c => '<div class="k glass' + (c[4] ? ' rv" data-ops="1" role="button" tabindex="0' : '') + '"><span class="cap">' + c[0] + '</span><b class="num">' + c[1] + '</b>' + (c[3] != null ? '<div class="meter"><i style="width:' + (clamp01(c[3]) * 100).toFixed(1) + '%"></i></div>' : '') + '<p>' + c[2] + '</p></div>').join(''));
  }

  /* ---------- helpers ---------- */
  state(a) {
    if (a.phase === 'GROUND') { const p = this.sim.padOf(a); if (p && p.step === 'MAINT') return ['IN CHECK', 'mx']; if (p && p.step === 'RELEASE' && p.why) return [p.why, 'warn']; return [p && STEP_LABEL[p.step] ? STEP_LABEL[p.step] : 'ON PAD', 'ok']; }
    if (a.phase === 'STANDBY') return ['STANDBY', 'mute'];
    if (a.phase === 'REST') { const r = restState(this.sim, a); return [r[2] + ' · ' + r[0] + ' · ' + a.site, r[1]]; }
    if (a.phase === 'HOLD') return ['HOLD', 'warn'];
    if (a.phase === 'CRUISE' || a.phase === 'CLIMB' || a.phase === 'DESCENT') return [PHASE_LABEL[a.phase], 'info'];
    return [PHASE_LABEL[a.phase], 'hot'];
  }
  pilotName(a) { if (!a.pilot) return '—'; const p = this.sim.scn[a.scn].pilots.find(p => p.id === a.pilot); return p ? p.name : a.pilot; }
  featured() {
    const app = this.app, sim = this.sim, sel = app.sel;
    if (sel && sel.type === 'aircraft' && sim.byCs[sel.id]) return sim.byCs[sel.id];
    if (sel && sel.type === 'pad') { const [sid, i] = sel.id.split(':'), p = sim.sites[sid].pads[+i]; if (p && p.cs) return sim.byCs[p.cs]; }
    const cur = this.featCs && sim.byCs[this.featCs];
    if (cur && cur.phase !== 'REST' && cur.phase !== 'STANDBY' && app.tReal - this.tFeat < 14 && cur.scn === app.scn && (app.view !== 'site' || cur.site === app.siteId || cur.to === app.siteId || cur.from === app.siteId)) return cur;
    let pool = sim.aircraft.filter(a => a.scn === app.scn && a.phase !== 'STANDBY' && a.phase !== 'REST');
    if (app.view === 'site') { const here = pool.filter(a => (a.phase === 'GROUND' && a.site === app.siteId) || (AIRBORNE[a.phase] && a.to === app.siteId && a.rem < 25) || (a.from === app.siteId && (a.phase === 'LIFT' || a.phase === 'TRANS_OUT'))); if (here.length) pool = here; }
    const score = a => (a.phase === 'LIFT' || a.phase === 'TRANS_OUT' || a.phase === 'TRANS_IN' || a.phase === 'LAND') ? 0 : a.phase === 'GROUND' ? 1 + (this.sim.padOf(a) && this.sim.padOf(a).step === 'MAINT' ? 50 : 0) : a.phase === 'DESCENT' ? 2 : 3 + a.rem / 100;
    pool.sort((a, b) => score(a) - score(b)); const f = pool[0] || null; this.featCs = f ? f.cs : null; this.tFeat = app.tReal; return f;
  }

  /* ---------- tracker ---------- */
  tracker() {
    const a = this.featured(), el = $('track'), sim = this.sim;
    if (!a) { setHTML(el, '<span class="cap">Flight tracker</span><h3>No aircraft active</h3>'); return; }
    const pad = sim.padOf(a), st = this.state(a), selected = this.app.sel && this.app.sel.type === 'aircraft' && this.app.sel.id === a.cs;
    let steps, now, meta;
    const tm = t => t ? fmtClock(t) : '';
    if (a.phase === 'GROUND') {
      const site = sim.sites[a.site], deck = site.kind === 'SHIP' || site.kind === 'PLATFORM', mx = pad && pad.step === 'MAINT';
      const order = mx ? ['SAFE', 'MAINT', 'FUELWAIT', 'PREFLIGHT', 'RELEASE'] : deck ? ['SAFE', 'POD_OUT', 'POD_IN', 'PREFLIGHT', 'RELEASE'] : ['SAFE', 'POD_OUT', 'POD_IN', 'FUELWAIT', 'PREFLIGHT', 'RELEASE'];
      const names = { SAFE: 'Touchdown', POD_OUT: 'Pod out', POD_IN: 'Pod in + seal', FUELWAIT: 'Refuel', PREFLIGHT: 'Pre-flight', RELEASE: 'Release', MAINT: 'Basic check' };
      now = Math.max(0, order.indexOf(pad.step === 'DEPARTING' ? 'RELEASE' : pad.step));
      steps = order.map((k, i) => { let s = ''; if (i === now) s = pad.step === 'RELEASE' ? (pad.why ? 'held' : 'pending') : pad.step === 'FUELWAIT' ? (pad.fuel === 'FUELLING' ? 'fuelling' : 'waiting') : pad.dur > 0 ? fmtMS(pad.dur - pad.t) : ''; if (k === 'FUELWAIT' && i > now && pad.fuel === 'DONE') s = 'done'; if (k === 'SAFE' && i < now && a.pt.GROUND) s = tm(a.pt.GROUND); return [names[k], s]; });
      meta = '<span>' + esc(site.name) + ' <b>' + pad.id + '</b></span><span>next <b>' + (a.to && a.to !== a.site ? a.to : '—') + '</b></span><span>pod <b>' + (a.pod ? a.pod.id + ' · ' + a.pod.kg + ' kg' : 'empty pod fitted') + '</b></span><span>fuel <b>' + Math.round(a.fuel) + '%</b></span>';
    } else {
      const order = ['LIFT', 'TRANS_OUT', 'CRUISE', 'DESCENT', 'TRANS_IN', 'LAND'], names = ['VTOL ascent', 'Transition →', 'Cruise', 'Descent', 'Transition ←', 'VTOL landing'];
      const idx = { LIFT: 0, TRANS_OUT: 1, CLIMB: 2, CRUISE: 2, HOLD: 3, DESCENT: 3, TRANS_IN: 4, LAND: 5 }; now = idx[a.phase] == null ? 2 : idx[a.phase];
      steps = order.map((k, i) => [names[i], i < now ? tm(a.pt[k] || (k === 'CRUISE' && a.pt.CLIMB) || a.tDep) : i === now ? (a.phase === 'HOLD' ? 'holding' : a.phase === 'CLIMB' ? 'climbing' : 'now') : (i === 5 ? tm(sim.t + a.eta) : '')]);
      meta = '<span><b>' + a.from + ' → ' + a.to + '</b> · ' + a.route + '</span><span>ETA <b>' + fmtClock(sim.t + a.eta) + '</b></span><span><b>' + Math.round(a.rem) + '</b> km to go</span><span><b>' + fmtInt(a.alt / FT) + '</b> ft · <b>' + Math.round(a.gs * 3.6) + '</b> km/h</span>';
    }
    setHTML(el, '<div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="cap">' + (a.phase === 'GROUND' ? 'Turnaround tracker' : 'Flight tracker') + (selected ? '' : ' · auto') + '</span><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span></div>' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><h3>' + a.cs + '</h3>' + (selected ? '' : '<button type="button" class="cap" data-act="sel" data-v="aircraft|' + a.cs + '" style="color:var(--fg-2)">SELECT →</button>') + '</div>' +
      '<div class="steps" style="grid-template-columns:repeat(' + steps.length + ',minmax(0,1fr))">' + steps.map((s, i) => '<div class="st ' + (i < now ? 'done' : i === now ? 'now' : '') + '"><u></u><em>' + s[0] + '</em><s class="num">' + (s[1] || '&nbsp;') + '</s></div>').join('') + '</div>' +
      '<div class="tr-meta num">' + meta + '</div>');
  }

  /* ---------- detail panel ---------- */
  detail(force) {
    const app = this.app, sim = this.sim, sel = app.sel || (app.view === 'site' ? { type: 'site', id: app.siteId } : null), dh = $('dh'), db = $('db');
    const kv = rows => '<div class="kv">' + rows.map(r => '<div><span>' + r[0] + '</span><span class="num">' + r[1] + '</span></div>').join('') + '</div>';
    const cells = (rows, two) => '<div class="grid' + (two ? ' two' : '') + '">' + rows.map(r => '<div class="cell"><span class="cap">' + r[0] + '</span><b class="num">' + r[1] + '</b></div>').join('') + '</div>';
    const bar = (label, val, pct, col) => '<div class="bar"><div class="row"><span>' + label + '</span><b class="num">' + val + '</b></div><div class="meter"><i style="width:' + (clamp01(pct) * 100).toFixed(1) + '%' + (col ? ';background:' + col : '') + '"></i></div></div>';
    const close = '<button type="button" class="x" data-act="clear" aria-label="Clear selection">×</button>';
    const scroll = db.scrollTop;
    if (sel && sel.type === 'aircraft' && sim.byCs[sel.id]) {
      const a = sim.byCs[sel.id], st = this.state(a), R = a.route ? sim.routes[a.route] : null, air = AIRBORNE[a.phase], pad = sim.padOf(a);
      const tabsH = '<div class="seg actab">' + ['NOW', 'HISTORY'].map(t => '<button type="button" data-act="actab" data-v="' + t + '"' + ((this.acTab || 'NOW') === t ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div>';
      setHTML(dh, '<div class="row"><span class="cap">L560 · ' + esc(sim.scn[a.scn].def.name) + '</span>' + close + '</div><div class="row"><h2>' + a.cs + '</h2><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span></div>' + tabsH);
      if (this.acTab === 'HISTORY') { setHTML(db, this.history(a)); db.scrollTop = scroll; return; }
      let h = '';
      if (R && a.phase !== 'STANDBY') h += bar(a.from + ' → ' + a.to + ' · ' + R.id, air ? Math.round(a.total - a.rem) + ' / ' + Math.round(a.total) + ' km · ETA ' + fmtClock(sim.t + a.eta) : (pad ? sim.sites[a.site].name + ' ' + pad.id : ''), air ? 1 - a.rem / Math.max(1, a.total) : 0, 'var(--accent)');
      h += cells([['ALT AGL', fmtInt(a.alt / FT) + '<small>ft</small>'], ['GROUND SPD', Math.round(a.gs * 3.6) + '<small>km/h</small>'], ['HEADING', pad2(Math.round(a.hdg) % 360).padStart(3, '0') + '<small>°</small>'],
        ['VERT SPD', (a.vs >= 0 ? '+' : '') + a.vs.toFixed(1) + '<small>m/s</small>'], ['WING TILT', Math.round(a.tilt) + '<small>°</small>'], ['LEVEL', air ? fmtInt(a.levelFt) + '<small>ft</small>' : '—']]);
      h += bar('BATTERY · VTOL RESERVE', Math.round(a.soc) + ' %', a.soc / 100, a.soc < 30 ? 'var(--warn)' : 'var(--ok)') + bar('FUEL · ' + (a.gen === 'ON' ? 'GENERATOR ON' : 'GENERATOR OFF'), Math.round(a.fuel) + ' %', a.fuel / 100, a.fuel < 25 ? 'var(--warn)' : null);
      h += kv([['SUPERVISORY PILOT', esc(this.pilotName(a))], ['C2 LINK', air ? (a.link === 'SATCOM' ? '<span class="c-warn">SATCOM BACKUP · ' + Math.round(a.c2km || 0) + ' km to ground</span>' : esc((a.gcs || '—').split(' · ').pop()) + ' · ' + Math.round(a.c2km || 0) + ' km · ' + (a.c2rssi || '—') + ' dBm') : 'ON THE GROUND NETWORK'], ...(air ? [['C2 HANDOFFS', (a.handoffs || 0) + ' this flight' + (a.c2alt != null ? ' · next station ' + Math.round(a.c2alt) + ' km' : '')]] : []), ['POSITION', fmtLL(a.lat, a.lon)], ['FLIGHT HOURS', a.fh.toFixed(1) + ' · check in ' + Math.max(0, a.nextCheck - a.fh).toFixed(0) + ' FH']]);
      if (a.pod) { const T = POD_TYPES[a.pod.type]; h += '<div><div class="row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px"><span class="cap">Pod ' + a.pod.id + '</span><span class="pill ' + POD_CLS[a.pod.type] + '">' + T.label + '</span></div>' +
        kv([['CARGO', a.req ? esc(a.req.desc) : '—'], ['REQUEST', a.req ? a.req.id + ' · ' + esc(a.req.consignor) : '—'], ['PAYLOAD', a.pod.kg + ' kg of ' + L560.payloadKg], ['PALLETS', POD.pallets + ' × ' + POD.palletMm[0] + ' × ' + POD.palletMm[1] + ' mm'], ['SEAL', a.pod.sealed ? '<span class="c-ok">CLOSED</span>' : 'OPEN'], ['INTERNAL TEMP', a.pod.tempC == null ? 'ambient' : a.pod.tempC.toFixed(1) + ' °C · set 2–8'], ['PEAK SHOCK', a.pod.shockG.toFixed(1) + ' g']]) + '</div>'; }
      else h += '<p class="src">Empty pod fitted: ' + (R && R.mro ? 'maintenance ferry.' : a.phase === 'STANDBY' || a.phase === 'REST' ? 'airframe parked; the pod stays on.' : 'positioning leg, no cargo on board.') + ' No LogiXair aircraft flies without a pod.</p>';
      h += '<div class="btns">' + (app.view === 'map' ? '<button type="button" class="btn ghost" data-act="follow">' + (app.following ? 'STOP FOLLOWING' : 'FOLLOW') + '</button>' : '') + (a.site && app.view === 'map' ? '<button type="button" class="btn" data-act="enter" data-v="' + a.site + '">OPEN ' + a.site + ' →</button>' : '') + '</div>';
      setHTML(db, h);
    } else if (sel && sel.type === 'site' && sim.sites[sel.id]) {
      const S = sim.sites[sel.id], sc = sim.scn[S.scn].def, inb = sim.aircraft.filter(a => AIRBORNE[a.phase] && a.to === S.id).sort((a, b) => a.eta - b.eta).slice(0, 5);
      setHTML(dh, '<div class="row"><span class="cap">' + kindLabel(S) + ' · ' + esc(sc.name) + '</span>' + close + '</div><h2>' + esc(S.name) + '</h2>');
      let h = '<div class="btns">' + (app.view === 'site' && app.siteId === S.id ? '<button type="button" class="btn ghost" data-act="exit">← BACK TO NETWORK</button>' : '<button type="button" class="btn" data-act="enter" data-v="' + S.id + '">OPEN SITE IN 3D →</button>') + '</div>';
      const crew = S.def.roc ? 'ROC: ' + sim.onShift(S.scn) + ' supervisory pilots on shift · dispatch · line maintenance' : S.kind === 'BASE' ? 'Base office: dispatch, line maintenance, security · no pilots' : S.kind === 'MRO' ? 'MRO technicians and stores · no pilots' : S.kind === 'DC' ? '1 LogiXair operator at the check-in cabin · warehouse staff handle the pallets' : S.kind === 'DOCKYARD' || S.kind === 'SHOREBASE' ? 'Shore crew and stores · no pilots' : 'Ship or platform deck crew';
      h += kv([['PEOPLE ON SITE', crew]]);
      { const r = sim.led.site[S.id]; if (r && (r.dep || r.arr)) h += '<div><span class="cap">Today at this site · since 06:00</span>' + kv([['DEPARTURES · ARRIVALS', r.dep + ' · ' + r.arr], ['PODS OUT · IN', r.podsOut + ' · ' + r.podsIn], ['CARGO OUT · IN', (r.kgOut / 1000).toFixed(2) + ' t · ' + (r.kgIn / 1000).toFixed(2) + ' t'], ['DRY · WET (BOTH WAYS)', ((r.dryOut + r.dryIn) / 1000).toFixed(2) + ' t · ' + ((r.wetOut + r.wetIn) / 1000).toFixed(2) + ' t'], ['REVENUE ORIGINATED', inr(r.revOut)]]).replace('<div class="kv">', '<div class="kv" style="margin-top:7px">') + '</div>'; }
      h += kv([['POSITION', fmtLL(S.lat, S.lon) + (S.def.src === 'model' ? ' · indicative' : '')], ...(S.moving ? [['COURSE · SPEED', pad2(Math.round(S.rot)).padStart(3, '0') + '° · ' + (S.speedMs / KT).toFixed(0) + ' kt']] : []), ['PADS', S.pads.length + (S.kind === 'SHIP' ? ' deck spot' : S.kind === 'PLATFORM' ? ' helideck' : '')], ['REFUEL ON SITE', S.def.refuel ? 'yes' : 'no · round-trip fuel']]);
      h += '<div><span class="cap">Pads</span><div class="list" style="margin-top:7px">' + S.pads.map((p, i) => '<button type="button" data-act="sel" data-v="pad|' + S.id + ':' + i + '"><span><i class="pd ' + (p.state === 'FREE' ? 'f' : p.state === 'RESERVED' ? 'r' : 'o') + '"></i>' + p.id + (p.cs ? ' · ' + p.cs : '') + '</span><span>' + (p.state === 'FREE' ? 'FREE' : p.state === 'RESERVED' ? 'INBOUND' : (STEP_LABEL[p.step] || 'DEPARTING')) + '</span></button>').join('') + '</div></div>';
      if (S.dock) { const D = S.dock, fin = flowSum(D.st.map(x => x.fin)), fout = flowSum(D.st.map(x => x.fout));
        const stTxt = x => x.state === 'IDLE' ? 'BAY FREE' : x.state === 'V_IN' ? 'TRUCK IN' : x.state === 'MOVE' ? (x.job === 'BUILD' ? 'LOADING ' : 'UNLOADING ') + Math.min(POD.pallets, x.k + 1) + ' / ' + POD.pallets : x.job === 'BUILD' ? 'POD TO STAGING' : 'TRUCK OUT';
        h += '<div><span class="cap">Truck docks · volume moved since 06:00</span>' + volTable(fin, fout) +
          '<p class="src">Inbound: pods flown in and broken down onto trucks. Outbound: pallets off trucks, loaded into pods for flight. ' + D.qBreak.length + ' pod' + (D.qBreak.length === 1 ? '' : 's') + ' waiting for a truck · ' + D.staged.length + ' loaded pod' + (D.staged.length === 1 ? '' : 's') + ' staged.</p>' +
          '<div class="list" style="margin-top:7px">' + D.st.map(x => '<button type="button" data-act="sel" data-v="asset|dock' + x.i + '"><span><i class="pd ' + (x.state === 'IDLE' ? 'f' : x.state === 'MOVE' ? 'o' : 'r') + '"></i>L' + (x.i + 1) + (x.job ? ' · ' + POD_TYPES[x.type].label + ' ' + x.kg + ' kg' : '') + ' · ' + stTxt(x) + '</span><span>IN ' + x.fin.pods + ' · OUT ' + x.fout.pods + ' →</span></button>').join('') + '</div></div>'; }
      { const rest = sim.restHere(S), cap = sim.restCap(S), inH = rest.filter(a => a.restAt === 'HANGAR').length, onS = S.stands.filter(x => x.cs).length + rest.filter(a => a.restAt === 'PAD').length;
        if (cap.hangar || S.stands.length) h += '<div><span class="cap">Stood down here</span><div class="list" style="margin-top:7px">' + (cap.hangar ? '<button type="button" data-act="' + (app.view === 'site' && app.siteId === S.id ? 'sel" data-v="asset|hangar' : 'enter" data-v="' + S.id) + '"><span>Line hangar</span><span>' + inH + ' / ' + cap.hangar + ' →</span></button>' : '') + '<button type="button" data-act="' + (app.view === 'site' && app.siteId === S.id ? 'sel" data-v="asset|' + (cap.hangar ? 'hangar' : 'stands') : 'enter" data-v="' + S.id) + '"><span>' + (S.kind === 'DC' ? 'Parking slot and pads' : 'Stands') + '</span><span>' + onS + ' / ' + (S.kind === 'DC' ? S.stands.length + S.pads.length - 1 : S.stands.length) + ' →</span></button></div></div>'; }
      if (S.kind === 'MRO') { const n = S.pads.filter(p => p.step === 'MAINT').length; h += '<div><span class="cap">MRO</span><div class="list" style="margin-top:7px"><button type="button" data-act="' + (app.view === 'site' && app.siteId === S.id ? 'sel" data-v="asset|hangar' : 'enter" data-v="' + S.id) + '"><span>In check</span><span>' + n + ' / ' + S.pads.length + ' →</span></button></div></div>'; }
      const cor = Object.values(sim.routes).filter(R => R.a === S.id || R.b === S.id);
      if (cor.length > 1 || S.kind === 'BASE') h += '<div><span class="cap">Corridors here · ' + cor.length + '</span><div class="list" style="margin-top:7px">' + cor.map(R => { const o = sim.sites[R.a === S.id ? R.b : R.a]; return '<button type="button" data-act="sel" data-v="route|' + R.id + '"><span>' + R.id + ' · ' + esc(o.name) + '</span><span>' + Math.round(R.km) + ' km · ' + sim.aircraft.filter(a => a.route === R.id && AIRBORNE[a.phase]).length + ' in flight</span></button>'; }).join('') + '</div></div>';
      h += '<div><span class="cap">Inbound</span><div class="list" style="margin-top:7px">' + (inb.length ? inb.map(a => '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · ' + a.route + '</span><span>' + Math.round(a.rem) + ' km · ' + fmtClock(sim.t + a.eta) + '</span></button>').join('') : '<button type="button" disabled><span>Nothing inbound</span><span></span></button>') + '</div></div>';
      setHTML(db, h);
    } else if (sel && sel.type === 'route' && sim.routes[sel.id]) {
      const R = sim.routes[sel.id], sc = sim.scn[R.scn].def, on = sim.aircraft.filter(a => a.route === R.id && AIRBORNE[a.phase]);
      const air = R.km / L560.cruiseKmh * 3600 + 260, sf = surfaceOf(R), surf = sf.s;
      setHTML(dh, '<div class="row"><span class="cap">' + (R.mro ? 'Maintenance ferry' : R.trunk ? 'Trunk corridor' : 'Corridor') + ' · ' + esc(sc.name) + '</span>' + close + '</div><div class="row"><h2>' + R.id + '</h2><span class="pill info">' + on.length + ' IN FLIGHT</span></div>');
      let h = cells([['AIR ROUTE', Math.round(R.km) + '<small>km</small>'], ['BY AIR', fmtDur(air)], [sf.mode, fmtDur(surf) + '<small>' + Math.round(sf.km) + ' km</small>']]);
      // corridor box, drawn to scale vertically: floor, ceiling, levels in use
      const y = ft => 96 - (ft / CORRIDOR.ceilFt) * 82, lv = {}; for (const a of on) if (a.phase === 'CRUISE' || a.phase === 'CLIMB' || a.phase === 'DESCENT') (lv[a.levelFt] = lv[a.levelFt] || []).push(a);
      let svg = '<svg class="box" viewBox="0 0 296 112" width="100%" role="img" aria-label="Corridor cross-section"><rect x="78" y="' + y(CORRIDOR.ceilFt) + '" width="140" height="' + (y(CORRIDOR.floorFt) - y(CORRIDOR.ceilFt)) + '" fill="rgba(120,170,255,.07)" stroke="#3A4049"/>' +
        '<line x1="20" y1="96" x2="276" y2="96" stroke="#3A4049"/><text x="74" y="' + (y(CORRIDOR.ceilFt) + 3) + '" text-anchor="end">' + fmtInt(CORRIDOR.ceilFt) + ' ft</text><text x="74" y="' + (y(CORRIDOR.floorFt) + 3) + '" text-anchor="end">' + fmtInt(CORRIDOR.floorFt) + ' ft</text><text x="74" y="99" text-anchor="end">ground</text>' +
        '<text x="148" y="108" text-anchor="middle">± ' + CORRIDOR.halfWidthM + ' m about the centreline</text><line x1="148" y1="' + y(CORRIDOR.ceilFt) + '" x2="148" y2="96" stroke="#3A4049" stroke-dasharray="2 3"/>';
      const used = Object.keys(lv).map(Number).sort((a, b) => a - b);
      for (const f of used) svg += '<line x1="78" x2="218" y1="' + y(f) + '" y2="' + y(f) + '" stroke="' + sc.color + '" stroke-width="1"/>' + lv[f].map((a, i) => '<rect x="' + (a.dir > 0 ? 90 + i * 12 : 198 - i * 12) + '" y="' + (y(f) - 2.5) + '" width="7" height="5" fill="#F4F4F2"/>').join('');
      if (used.length) svg += '<text x="222" y="' + (y((used[0] + used[used.length - 1]) / 2) + 3) + '" style="fill:#E9EAEC">' + (used.length > 1 ? fmtInt(used[0]) + '–' + fmtInt(used[used.length - 1]) : fmtInt(used[0])) + ' ft</text>';
      h += '<div><span class="cap">Corridor box · levels in use</span>' + svg + '</svg>' + (used.length ? '<p class="src">' + used.map(f => fmtInt(f) + ' ft ' + (lv[f][0].dir > 0 ? '→' : '←') + ' ' + lv[f].length).join(' · ') + '</p>' : '') + '</div>';
      h += kv([['ENDS', esc(sim.sites[R.a].name) + ' ↔ ' + esc(sim.sites[R.b].name)], ['GREAT CIRCLE', Math.round(R.direct) + ' km'], ['LEVEL BAND', fmtInt(R.baseFt) + '–' + fmtInt(R.baseFt + 1000) + ' ft · set by ' + esc(sim.sites[R.a].id)], ['C2 GROUND STATIONS', R.gcs.length], ['CONTINGENCY AREAS', R.cont.length ? R.cont.map(c => esc(c[0])).join(', ') : (sim.sites[R.b].kind === 'SHIP' || sim.sites[R.b].kind === 'PLATFORM' ? 'return or continue · none at sea' : '—')], ['SEPARATION', CORRIDOR.sepVertFt + ' ft vertical · ' + CORRIDOR.sepTrailKm.toFixed(1) + ' km in trail']]);
      h += '<div><span class="cap">Aircraft on corridor</span><div class="list" style="margin-top:7px">' + (on.length ? on.map(a => '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · ' + (a.dir > 0 ? '→ ' + R.b : '→ ' + R.a) + '</span><span>' + fmtInt(a.levelFt) + ' ft · ' + Math.round(a.rem) + ' km</span></button>').join('') : '<button type="button" disabled><span>None</span><span></span></button>') + '</div></div>';
      setHTML(db, h);
    } else if (sel && sel.type === 'pad') {
      const [sid, i] = sel.id.split(':'), S = sim.sites[sid], p = S.pads[+i], a = p.cs ? sim.byCs[p.cs] : null;
      setHTML(dh, '<div class="row"><span class="cap">Pad · ' + esc(S.name) + '</span>' + close + '</div><div class="row"><h2>' + p.id + '</h2><span class="pill ' + (p.state === 'FREE' ? 'ok' : p.state === 'RESERVED' ? 'warn' : 'hot') + '">' + (p.state === 'FREE' ? 'FREE' : p.state === 'RESERVED' ? 'INBOUND' : 'OCCUPIED') + '</span></div>');
      let h = kv([['TOUCHDOWN AREA', L560.footprintM[0] + ' m × ' + L560.footprintM[1] + ' m'], ['AIRCRAFT', a ? a.cs : '—'], ['STEP', p.state === 'OCCUPIED' ? (STEP_LABEL[p.step] || 'DEPARTING') + (p.dur > 0 && p.step !== 'RELEASE' && p.step !== 'FUELWAIT' ? ' · ' + fmtMS(p.dur - p.t) + ' left' : '') : '—'], ['FUEL', { NA: '—', WAIT: 'bowser called', FUELLING: 'fuelling', DONE: 'complete' }[p.fuel]], ...(p.why ? [['HELD FOR', '<span class="c-warn">' + p.why + '</span>']] : [])]);
      if (a) h += '<div class="btns"><button type="button" class="btn ghost" data-act="sel" data-v="aircraft|' + a.cs + '">SHOW ' + a.cs + '</button></div>';
      h += '<p>The pod shuttle runs a straight lane from its dock door to the pad. It lifts the pod to the latches under the spine, so a swap needs no ground crew at the aircraft.</p>';
      setHTML(db, h);
    } else if (sel && sel.type === 'asset' && app.view === 'site') {
      const as = app.site.assets.find(x => x.key === sel.id), S = app.site.site, m = /^dock(\d)$/.exec(sel.id), x = m && S.dock ? S.dock.st[+m[1]] : null;
      if (as && x) {
        const lanes = Object.keys(flowSum([x.fin, x.fout]).lane).map(k => [k, x.fin.lane[k], x.fout.lane[k]]).sort((p, q) => ((q[1] || { kg: 0 }).kg + (q[2] || { kg: 0 }).kg) - ((p[1] || { kg: 0 }).kg + (p[2] || { kg: 0 }).kg));
        const types = Object.keys(POD_TYPES).filter(k => x.fin.by[k] || x.fout.by[k]);
        const mv = S.dock.moves.filter(v => v.i === x.i).slice(-8).reverse(), tot = flowSum([x.fin, x.fout]), dw = drywet(tot);
        setHTML(dh, '<div class="row"><span class="cap">Truck dock · ' + esc(S.name) + '</span>' + close + '</div><div class="row"><h2>Bay L' + (x.i + 1) + '</h2><span class="pill ' + (x.state === 'IDLE' ? 'ok' : 'warn') + '">' + (x.state === 'IDLE' ? 'BAY FREE' : x.job === 'BUILD' ? 'LOADING A POD' : 'UNLOADING A POD') + '</span></div>');
        let h = cells([['MOVED', tn(tot.kg)], ['INBOUND', tn(x.fin.kg)], ['OUTBOUND', tn(x.fout.kg)]]);
        h += bar('Dry · ' + dw.d.pods + ' pods', tn(dw.d.kg), tot.kg ? dw.d.kg / tot.kg : 0) + bar('Wet · ' + dw.w.pods + ' pods (cold chain, liquid)', tn(dw.w.kg), tot.kg ? dw.w.kg / tot.kg : 0, '#78AAFF');
        if (x.job) h += kv([['NOW', (x.job === 'BUILD' ? 'loading ' : 'unloading ') + POD_TYPES[x.type].label + ' · ' + x.kg + ' kg'], ['CONSIGNMENT', x.job === 'BUILD' ? 'from road · to the next flight out' : 'off ' + (x.cs || '—') + ' from ' + esc(x.peer || '—')]]);
        h += '<div><span class="cap">Volume since 06:00</span>' + volTable(x.fin, x.fout) + '</div>';
        h += '<div><span class="cap">By cargo class · pods · weight</span><table class="dt"><thead><tr><th>CLASS</th><th>INBOUND</th><th>OUTBOUND</th></tr></thead><tbody>' +
          (types.length ? types.map(k => '<tr><td>' + POD_TYPES[k].label + (WET_TYPES[k] ? ' · WET' : k === 'DRY' ? '' : ' · DRY') + '</td><td>' + pk(x.fin.by[k]) + '</td><td>' + pk(x.fout.by[k]) + '</td></tr>').join('') : '<tr><td>None yet</td><td></td><td></td></tr>') + '</tbody></table></div>';
        h += '<div><span class="cap">Where it flies · by site at the other end</span><table class="dt"><thead><tr><th>SITE</th><th>FROM IT</th><th>TO IT</th></tr></thead><tbody>' +
          (lanes.length ? lanes.map(l => '<tr><td>' + esc(sim.sites[l[0]] ? sim.sites[l[0]].name : l[0]) + '</td><td>' + pk(l[1]) + '</td><td>' + pk(l[2]) + '</td></tr>').join('') : '<tr><td>None yet</td><td></td><td></td></tr>') + '</tbody></table></div>';
        h += '<div><span class="cap">Last movements</span><div class="list" style="margin-top:7px">' + (mv.length ? mv.map(v => '<button type="button"' + (v.cs ? ' data-act="sel" data-v="aircraft|' + v.cs + '"' : ' disabled') + '><span>' + fmtClock(v.t) + ' ' + v.dir + ' ' + POD_TYPES[v.type].label + ' ' + v.kg + ' kg</span><span>' + (v.dir === 'IN' ? '← ' + (v.peer || '—') : v.peer ? '→ ' + v.peer : 'STAGED') + (v.cs ? ' · ' + v.cs : '') + '</span></button>').join('') : '<button type="button" disabled><span>Nothing yet</span><span></span></button>') + '</div></div>';
        h += '<p class="src">' + esc(as.desc) + ' Volume assumes a ' + POD.loadHm.toFixed(1) + ' m load height per pallet (' + PALLET_M3.toFixed(2) + ' m³).</p>';
        setHTML(db, h);
      } else if (as && (sel.id === 'hangar' || sel.id === 'stands')) {
        const mro = S.kind === 'MRO', cap = sim.restCap(S), rest = sim.restHere(S), inH = rest.filter(a => a.restAt === 'HANGAR'), act = sim._active(S.scn);
        const row = (a, pre) => { const st = restState(sim, a), L = sim._lastLeg(a), nToday = (a.hist || []).filter(e => e.k === 'L' && dayOf(e.t) === dayOf(sim.t)).length; return '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + (pre ? pre + ' · ' : '') + a.cs + ' · in ' + fmtClock(a.tRest) + (L ? ' from ' + L.f + ' (' + L.r + ')' : '') + ' · ' + nToday + ' flights today</span><span class="c-' + st[1] + '">' + st[2] + ' · check in ' + Math.max(0, a.nextCheck - a.fh).toFixed(0) + ' FH</span></button>'; };
        const listOf = (title, arr, empty, pre) => '<div><span class="cap">' + title + '</span><div class="list" style="margin-top:7px">' + (arr.length ? arr.map(x => row(x, pre && pre(x))).join('') : '<button type="button" disabled><span>' + empty + '</span><span></span></button>') + '</div></div>';
        const stored = inH.slice().sort((p, q) => p.tRest - q.tRest), nChk = rest.filter(a => a.mxUntil).length, nIns = rest.filter(a => !a.mxUntil && sim.t - a.tRest < INSPECT_S).length;
        if (mro) {
          const pads = S.pads.filter(p => p.cs && sim.byCs[p.cs] && p.step === 'MAINT'), ferry = sim.aircraft.filter(a => AIRBORNE[a.phase] && a.to === S.id), feeders = Object.values(sim.routes).filter(r => r.mro && r.b === S.id).map(r => r.a);
          const due = sim.aircraft.filter(a => a.phase !== 'STANDBY' && a.home && feeders.includes(sim.routes[a.home].a) && a.nextCheck - a.fh < 12 && !pads.some(p => p.cs === a.cs) && !ferry.includes(a) && !a.mxUntil).sort((p, q) => (p.nextCheck - p.fh) - (q.nextCheck - q.fh)).slice(0, 10);
          setHTML(dh, '<div class="row"><span class="cap">MRO hangar · ' + esc(S.name) + '</span>' + close + '</div><div class="row"><h2>' + (pads.length + nChk) + ' in check · ' + stored.length + ' inside</h2><span class="pill ' + (stored.length >= cap.hangar ? 'warn' : 'ok') + '">' + stored.length + ' / ' + cap.hangar + ' HANGAR</span></div>');
          let h = cells([['ON CHECK BAYS', pads.length + '<small>/ ' + S.pads.length + '</small>'], ['IN HANGAR', stored.length + '<small>/ ' + cap.hangar + '</small>'], ['FERRYING IN', ferry.length]]);
          h += '<div><span class="cap">On the check bays</span><div class="list" style="margin-top:7px">' + (pads.length ? pads.map(p => { const a = sim.byCs[p.cs]; return '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · ' + p.id + ' · ' + a.fh.toFixed(0) + ' FH</span><span class="c-mx">basic check · ' + fmtDur(Math.max(0, p.dur - p.t)) + ' left</span></button>'; }).join('') : '<button type="button" disabled><span>No bay in use</span><span></span></button>') + '</div></div>';
          h += listOf('In the MRO hangar · ' + stored.length + ' of ' + cap.hangar + ' · checks and overnight storage', stored, 'Empty');
          h += '<div><span class="cap">Ferrying in</span><div class="list" style="margin-top:7px">' + (ferry.length ? ferry.map(a => '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · from ' + a.from + (a.restNext === S.id ? ' · to stand down' : '') + '</span><span>' + Math.round(a.rem) + ' km · ' + fmtClock(sim.t + a.eta) + '</span></button>').join('') : '<button type="button" disabled><span>None</span><span></span></button>') + '</div></div>';
          h += '<div><span class="cap">Coming due · bases served: ' + feeders.join(', ') + '</span><div class="list" style="margin-top:7px">' + (due.length ? due.map(a => '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · ' + esc(this.state(a)[0]) + '</span><span>' + Math.max(0, a.nextCheck - a.fh).toFixed(1) + ' FH to check</span></button>').join('') : '<button type="button" disabled><span>None within 12 FH</span><span></span></button>') + '</div></div>';
          h += '<p class="src">Basic check every ' + MX.basicFh + ' FH: about ' + (MX.basicDurS / 3600) + ' h on an MRO bay, or ' + (DUTY.lineCheckS / 3600) + ' h in a base line hangar when the airframe stands down within ' + DUTY.mxWindowFh + ' FH of it. Overnight, the MRO hangar also stores airframes its base has no room for.</p>';
          setHTML(db, h);
        } else {
          const stands = S.stands.map((st, i) => [i, st.cs ? sim.byCs[st.cs] : null]), onPads = rest.filter(a => a.restAt === 'PAD'), dc = S.kind === 'DC';
          setHTML(dh, '<div class="row"><span class="cap">' + (dc ? 'Parking · ' : 'Line hangar · ') + esc(S.name) + '</span>' + close + '</div><div class="row"><h2>' + rest.length + ' stood down</h2><span class="pill ' + (cap.hangar && inH.length >= cap.hangar ? 'warn' : 'ok') + '">' + (cap.hangar ? inH.length + ' / ' + cap.hangar + ' HANGAR' : rest.length + ' / ' + (stands.length + S.pads.length - 1) + ' OVERNIGHT') + '</span></div>');
          let h = cells(dc ? [['ON THE SLOT', stands.filter(x => x[1]).length + '<small>/ ' + stands.length + '</small>'], ['ON A PAD', onPads.length + '<small>/ ' + (S.pads.length - 1) + '</small>'], ['NETWORK NEED', Math.round(rosterLevel(sim.t, S.scn) * 100) + '<small>%</small>']]
            : [['IN HANGAR', inH.length + '<small>/ ' + cap.hangar + '</small>'], ['IN CHECK', nChk], ['IN INSPECTION', nIns]]);
          if (cap.hangar) h += listOf('In the line hangar · ' + inH.length + ' of ' + cap.hangar + ' slots', stored, 'Empty: the fleet is flying');
          if (stands.length) h += '<div><span class="cap">' + (dc ? 'Parking slot' : 'Stands') + '</span><div class="list" style="margin-top:7px">' + stands.map(([i, a]) => a ? (a.phase === 'REST' ? row(a, 'S' + (i + 1)) : '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>S' + (i + 1) + ' · ' + a.cs + '</span><span>' + esc(this.state(a)[0]) + '</span></button>') : '<button type="button" disabled><span>S' + (i + 1) + '</span><span>FREE</span></button>').join('') + '</div></div>';
          if (dc) h += listOf('Stood down on a pad · one pad always kept free', onPads, 'None', a => S.pads[a.pad].id);
          const pos = sim.aircraft.filter(a => a.restNext && AIRBORNE[a.phase] && a.from === S.id);
          if (pos.length) h += '<div><span class="cap">Sent on to stand down elsewhere</span><div class="list" style="margin-top:7px">' + pos.map(a => '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' → ' + esc(sim.sites[a.restNext].name) + '</span><span>' + (a.pod ? 'with a pod' : 'empty positioning') + '</span></button>').join('') + '</div></div>';
          h += '<p class="src">' + (dc ? 'A warehouse yard keeps its space for trucks: overnight it holds one airframe on the parking slot and one on a pad, with the other pad kept free. Anything more flies its last leg to a base or MRO hub to stand down — with a pod if there is one, empty if not.' :
            'Demand now wants ' + act.want + ' of ' + act.fl + ' ' + esc(sim.scn[S.scn].def.name.toLowerCase()) + ' airframes on the line; ' + act.n + ' are. Every stand-down starts with a daily inspection (about ' + (INSPECT_S / 3600) + ' h); airframes within ' + DUTY.mxWindowFh + ' FH of their basic check get it here (' + (DUTY.lineCheckS / 3600) + ' h). When the hangar and stands are full, the next airframe flies on to the MRO hub.') + '</p>';
          setHTML(db, h);
        }
      } else if (as) { setHTML(dh, '<div class="row"><span class="cap">' + esc(as.tag) + '</span>' + close + '</div><h2>' + esc(as.name) + '</h2>'); setHTML(db, '<p>' + esc(as.desc) + '</p>'); }
    } else {
      const sc = this.scnDef(), S = sim.scn[sc.id];
      setHTML(dh, '<div class="row"><span class="cap" style="color:' + sc.color + '">' + esc(sc.stage) + '</span></div><h2>' + esc(sc.name) + '</h2>');
      const bases = sc.sites.filter(d => d.kind === 'BASE'), bands = [...new Set(sc.sites.map(d => d.band).filter(Boolean))];
      const net = bases.length > 1 ? '<div><span class="cap">Network · ' + bases.length + ' bases · ' + sc.sites.filter(d => d.kind === 'DC').length + ' distribution centres · ' + sc.routes.filter(r => !r.mro).length + ' corridors</span><div class="list" style="margin-top:7px">' + bases.map(d => { const rs = sc.routes.filter(r => !r.mro && (r.a === d.id || r.b === d.id)).map(r => r.id), fl = sim.aircraft.filter(a => a.scn === sc.id && a.home && sim.routes[a.home].a === d.id);
        return '<button type="button" data-act="sel" data-v="site|' + d.id + '"><span>' + esc(d.name) + ' · ' + rs.length + ' corridors</span><span>' + fl.filter(a => AIRBORNE[a.phase]).length + ' / ' + fl.length + ' airborne</span></button>'; }).join('') + '</div></div>' : '';
      const fl = sim.aircraft.filter(a => a.scn === sc.id), small = fl.length <= 30;
      const fleetNow = small ? '<div><span class="cap">Fleet now · ' + fl.length + ' aircraft</span><div class="list" style="margin-top:7px">' + fl.map(a => { const st = this.state(a), where = AIRBORNE[a.phase] ? a.from + ' → ' + a.to + ' · ' + Math.round(a.rem) + ' km to go' : (a.site ? sim.sites[a.site].name : ''); return '<button type="button" data-act="sel" data-v="aircraft|' + a.cs + '"><span>' + a.cs + ' · ' + esc(where) + '</span><span class="c-' + st[1] + '">' + esc(st[0]) + '</span></button>'; }).join('') + '</div></div>' : '';
      setHTML(db, '<p>' + esc(sc.blurb) + '</p>' + net + fleetNow +
        cells([['PAYLOAD', L560.payloadKg + '<small>kg</small>'], ['RANGE', L560.rangeKm + '<small>km</small>'], ['CRUISE', L560.cruiseKmh + '<small>km/h</small>'], ['MTOW', fmtInt(L560.mtowKg) + '<small>kg</small>'], ['FOOTPRINT', L560.footprintM[0] + '×' + L560.footprintM[1] + '<small>m</small>'], ['ROTORS', L560.rotors]]) +
        '<div><span class="cap">Corridor rules in force</span>' + kv([['CONTAINMENT', '± ' + CORRIDOR.halfWidthM + ' m'], ['ALTITUDE BAND', fmtInt(CORRIDOR.floorFt) + '–' + fmtInt(CORRIDOR.ceilFt) + ' ft AGL'], bands.length > 1 ? ['LEVEL BANDS', bands.map(fmtInt).join(' · ') + ' ft'] : ['OPERATING LEVEL', 'from ' + fmtInt(CORRIDOR.baseLevelFt) + ' ft'], ['SEPARATION', CORRIDOR.sepVertFt + ' ft · ' + CORRIDOR.sepTrailKm.toFixed(1) + ' km'], ['HOLD', CORRIDOR.holdRadiusKm + ' km orbit'], ['SUPERVISION', '1 pilot : ' + CORRIDOR.pilotMax + ' aircraft']]).replace('<div class="kv">', '<div class="kv" style="margin-top:7px">') + '</div>' +
        '<div><span class="cap">Supervisory pilots · ' + sim.onShift(sc.id) + ' of ' + S.pilots.length + ' on shift at ' + esc(S.pilots[0].station) + '</span><div style="display:flex;flex-direction:column;gap:9px;margin-top:9px">' + S.pilots.map((p, i) => '<div class="bar"><div class="row"><span style="color:var(--fg-2)">' + esc(p.name) + ' · ' + (i < sim.onShift(sc.id) ? 'on shift' : p.load ? 'handing over' : 'off shift') + '</span><b class="num">' + p.load + ' / ' + CORRIDOR.pilotMax + '</b></div><div class="meter"><i style="width:' + (p.load / CORRIDOR.pilotMax * 100).toFixed(0) + '%"></i></div></div>').join('') + '</div></div>' +
        '<p class="src">Traffic is simulated. Aircraft figures are LogiXair design parameters; several sites are placeholders.</p><div class="btns"><button type="button" class="btn ghost" data-act="feed">WHAT IS REAL, WHAT IS MODELLED →</button></div>');
    }
    db.scrollTop = scroll;
  }

  /* ---------- one aircraft's own record ---------- */
  history(a) {
    const sim = this.sim, H = a.hist || [], legs = H.filter(e => e.k === 'L'), today = dayOf(sim.t), nm = id => sim.sites[id] ? sim.sites[id].name : id;
    const lt = legs.filter(e => dayOf(e.t) === today), done = lt.filter(e => e.a), last = legs.slice().reverse().find(e => e.a);
    const fh = done.reduce((n, e) => n + (e.a - e.t), 0) / 3600, rev = lt.reduce((n, e) => n + (e.rev || 0), 0), kg = lt.reduce((n, e) => n + (e.kg || 0), 0);
    const cells = rows => '<div class="grid">' + rows.map(r => '<div class="cell"><span class="cap">' + r[0] + '</span><b class="num">' + r[1] + '</b></div>').join('') + '</div>';
    let h = cells([['FLIGHTS TODAY', lt.length], ['FLIGHTS SINCE DAY 1', a.legs + (AIRBORNE[a.phase] ? 1 : 0)], ['FLOWN TODAY', fh.toFixed(1) + '<small>h</small>'], ['CARGO TODAY', (kg / 1000).toFixed(2) + '<small>t</small>'], ['REVENUE TODAY', inr(rev)], ['TO NEXT CHECK', Math.max(0, a.nextCheck - a.fh).toFixed(0) + '<small>FH</small>']]);
    const legTxt = e => e.f + ' → ' + e.to + ' · ' + e.r + ' · ' + (e.mro ? 'maintenance ferry' : e.kg ? e.kg + ' kg ' + POD_TYPES[e.ty].label : 'empty');
    h += '<div class="kv">' + [['NOW', esc(this.state(a)[0])], ['LAST FLIGHT', last ? fmtClock(last.t) + '–' + fmtClock(last.a) + ' · ' + esc(legTxt(last)) : '—'], ['TODAY\'S PATH', lt.length ? esc([lt[0].f].concat(lt.map(e => e.to)).join(' → ')) : 'not flown yet today'], ['TOTAL FLIGHT HOURS', a.fh.toFixed(1) + ' FH']].map(r => '<div><span>' + r[0] + '</span><span class="num">' + r[1] + '</span></div>').join('') + '</div>';
    // timeline, newest first, grouped by operating day
    const ev = H.slice().reverse(); let cur = null, rows = '';
    for (const e of ev) {
      const d = dayOf(e.t);
      if (d !== cur) { cur = d; const n = legs.filter(x => dayOf(x.t) === d).length; rows += '<div class="hday">DAY ' + d + ' · ' + dateOf(e.t).toUpperCase() + ' · ' + n + (n === 1 ? ' FLIGHT' : ' FLIGHTS') + '</div>'; }
      let t = '', w = '', cls = '';
      if (e.k === 'L') { t = fmtClock(e.t) + (e.a ? '–' + fmtClock(e.a) : ' →'); w = legTxt(e) + (e.a ? ' · ' + fmtDur(e.a - e.t) : ' · in the air') + (e.rev ? ' · ' + inr(e.rev) : '') + (e.late ? ' · late' : ''); cls = e.mro ? 'mx' : e.kg ? '' : 'mute'; }
      else if (e.k === 'S') { t = fmtClock(e.t); w = 'Stood down at ' + nm(e.s) + ' · ' + ({ HANGAR: sim.sites[e.s] && sim.sites[e.s].kind === 'MRO' ? 'MRO hangar' : 'line hangar', STAND: sim.sites[e.s] && sim.sites[e.s].kind === 'DC' ? 'parking slot' : 'stand', PAD: 'on its pad' }[e.w] || ''); cls = 'mute'; }
      else if (e.k === 'M') { t = fmtClock(e.t); w = 'Basic check opened at ' + nm(e.s); cls = 'mx'; }
      else if (e.k === 'X') { t = fmtClock(e.t); w = 'Basic check signed off at ' + nm(e.s); cls = 'mx'; }
      else if (e.k === 'B') { t = fmtClock(e.t); w = 'Back on the line at ' + nm(e.s); cls = 'ok'; }
      rows += '<div class="hrow"><span>' + t + '</span><span class="c-' + (cls || 'fg') + '">' + esc(w) + '</span></div>';
    }
    h += '<div><span class="cap">Its log · newest first</span><div class="hlog">' + (rows || '<div class="hrow"><span></span><span>Nothing logged yet: the record keeps the last few days of every aircraft.</span></div>') + '</div></div>';
    h += '<div class="btns"><button type="button" class="btn ghost" data-act="csv-ac" data-v="' + a.cs + '">DOWNLOAD ' + a.cs + ' LOG (CSV)</button></div>';
    return h;
  }
  async download(filename, text) {
    let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) { try { await dl.save({ filename, data: text }); } catch (e) { if (e && e.code !== 'declined') console.warn(e); } return; }
    try { const u = URL.createObjectURL(new Blob([text], { type: 'text/csv' })), el = document.createElement('a'); el.href = u; el.download = filename; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (e) { console.warn(e); }
  }
  csv(rows) { return rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n'); }
  legRows(list) {
    const rows = [['callsign', 'line', 'day', 'date', 'departed', 'arrived', 'from', 'to', 'corridor', 'kind', 'kg', 'cargo class', 'revenue_inr', 'block_min', 'late']];
    for (const a of list) for (const e of a.hist || []) if (e.k === 'L') rows.push([a.cs, a.scn, dayOf(e.t), dateOf(e.t), fmtClock(e.t), e.a ? fmtClock(e.a) : '', e.f, e.to, e.r, e.mro ? 'maintenance ferry' : e.kg ? 'revenue' : 'empty', e.kg || 0, e.ty || '', Math.round(e.rev || 0), e.a ? Math.round((e.a - e.t) / 60) : '', e.late ? 'yes' : '']);
    return rows;
  }
  csvAircraft(cs) { const a = this.sim.byCs[cs]; if (a) this.download('logixair-' + cs + '-log.csv', this.csv(this.legRows([a]))); }

  /* ---------- tables ---------- */
  tables(force) {
    const app = this.app, sim = this.sim, scn = app.scn, sel = app.sel, tw = $('tw'), keep = tw.scrollTop;
    const isSel = (t, id) => sel && sel.type === t && sel.id === id ? ' sel' : '';
    let h = '', note = '';
    if (this.tab === 'FLEET') {
      const fl = sim.aircraft.filter(a => a.scn === scn);
      note = fl.length + ' AIRFRAMES · EVERY ONE ACCOUNTED FOR';
      h = '<table><thead><tr><th>CALLSIGN</th><th>STATE</th><th>CORRIDOR</th><th>LEG</th><th>PROGRESS</th><th class="r">ALT FT</th><th class="r">KM/H</th><th>POD</th><th class="r">KG</th><th>PILOT</th><th class="r">FH TO CHECK</th></tr></thead><tbody>' +
        fl.map(a => { const st = this.state(a), air = AIRBORNE[a.phase];
          return '<tr class="c' + isSel('aircraft', a.cs) + '" data-k="aircraft|' + a.cs + '"><td class="w">' + a.cs + '</td><td class="c-' + st[1] + '">' + esc(st[0]) + '</td><td>' + (a.phase === 'STANDBY' ? '—' : a.route || '—') + '</td><td>' + (a.phase === 'STANDBY' || a.phase === 'REST' ? a.site : air ? a.from + ' → ' + a.to : a.site + ' ' + (sim.padOf(a) ? sim.padOf(a).id : '')) + '</td><td>' + (air ? '<span class="prog"><i style="width:' + ((1 - a.rem / Math.max(1, a.total)) * 100).toFixed(0) + '%"></i></span> ' + Math.round(a.rem) + ' km' : '') + '</td><td class="r">' + (air ? fmtInt(a.alt / FT) : '') + '</td><td class="r">' + (air ? Math.round(a.gs * 3.6) : '') + '</td><td class="c-' + (a.pod ? POD_CLS[a.pod.type] : 'mute') + '">' + (a.pod ? a.pod.id : 'EMPTY') + '</td><td class="r">' + (a.pod ? a.pod.kg : '') + '</td><td>' + esc(this.pilotName(a)) + '</td><td class="r">' + Math.max(0, a.nextCheck - a.fh).toFixed(0) + '</td></tr>'; }).join('') + '</tbody></table>';
    } else if (this.tab === 'CORRIDORS') {
      const sc = this.scnDef(); note = 'EACH CORRIDOR IS ONE APPROVED OPERATIONAL DESIGN DOMAIN';
      h = '<table><thead><tr><th>ID</th><th>BETWEEN</th><th class="r">ROUTE KM</th><th class="r">BY AIR</th><th class="r">SURFACE KM</th><th class="r">SURFACE TIME</th><th class="r">IN FLIGHT</th><th>LEVELS IN USE</th><th class="r">GROUND STNS</th><th>CONTINGENCY AREAS</th></tr></thead><tbody>' +
        Object.values(sim.routes).filter(r => r.scn === scn).map(R => { const on = sim.aircraft.filter(a => a.route === R.id && AIRBORNE[a.phase]), lv = [...new Set(on.filter(a => a.phase === 'CRUISE').map(a => a.levelFt))].sort((a, b) => a - b);
          return '<tr class="c' + isSel('route', R.id) + '" data-k="route|' + R.id + '"><td class="w">' + R.id + '</td><td>' + esc(sim.sites[R.a].name) + ' ↔ ' + esc(sim.sites[R.b].name) + '</td><td class="r">' + Math.round(R.km) + '</td><td class="r">' + fmtDur(R.km / L560.cruiseKmh * 3600 + 260) + '</td><td class="r c-mute">' + Math.round(surfaceOf(R).km) + '</td><td class="r c-mute">' + fmtDur(surfaceOf(R).s) + (FERRY_LEGS.has(R.id) ? ' · ferry' : '') + '</td><td class="r w">' + on.length + '</td><td>' + (lv.length ? lv.map(fmtInt).join(' · ') : '—') + '</td><td class="r">' + R.gcs.length + '</td><td class="c-mute">' + (R.cont.length ? R.cont.map(c => esc(c[0])).join(', ') : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
    } else if (this.tab === 'SITES') {
      note = 'PAD STATE: FREE · INBOUND · OCCUPIED';
      h = '<table><thead><tr><th>SITE</th><th>TYPE</th><th>PADS</th><th class="r">ON GROUND</th><th>NEXT ARRIVAL</th><th>NEXT RELEASE</th><th class="r">DOCK IN</th><th class="r">DOCK OUT</th><th class="r">DRY / WET PODS</th><th>POSITION</th></tr></thead><tbody>' +
        Object.values(sim.sites).filter(s => s.scn === scn).map(S => { const inb = sim.aircraft.filter(a => AIRBORNE[a.phase] && a.to === S.id).sort((a, b) => a.eta - b.eta)[0], gnd = S.pads.filter(p => p.state === 'OCCUPIED'), rel = gnd.find(p => p.step === 'RELEASE' || p.step === 'PREFLIGHT');
          return '<tr class="c' + isSel('site', S.id) + '" data-k="site|' + S.id + '"><td class="w">' + esc(S.name) + '</td><td>' + kindLabel(S) + '</td><td>' + S.pads.map(p => '<i class="pd ' + (p.state === 'FREE' ? 'f' : p.state === 'RESERVED' ? 'r' : 'o') + '"></i>').join('') + '</td><td class="r">' + gnd.length + '</td><td>' + (inb ? inb.cs + ' · ' + fmtClock(sim.t + inb.eta) : '—') + '</td><td>' + (rel ? rel.cs + ' · ' + STEP_LABEL[rel.step] : '—') + '</td>' + (S.dock ? (() => { const fi = flowSum(S.dock.st.map(x => x.fin)), fo = flowSum(S.dock.st.map(x => x.fout)), dw = drywet(flowSum([fi, fo])); return '<td class="r">' + pk(fi) + '</td><td class="r">' + pk(fo) + '</td><td class="r">' + dw.d.pods + ' / ' + dw.w.pods + '</td>'; })() : '<td class="r c-mute">—</td><td class="r c-mute">—</td><td class="r c-mute">—</td>') + '<td class="c-mute">' + fmtLL(S.lat, S.lon) + '</td></tr>'; }).join('') + '</tbody></table>';
    } else if (this.tab === 'REQUESTS') {
      const rq = sim.requests.filter(r => r.scn === scn).slice(-40).reverse(); note = 'ONE RECORD FROM REQUEST TO DELIVERY';
      const cls = { ASSIGNED: 'mx', SEALED: 'ok', AIRBORNE: 'info', DELIVERED: 'mute' };
      h = '<table><thead><tr><th>REQUEST</th><th>STATE</th><th>LANE</th><th>CARGO</th><th>POD</th><th class="r">KG</th><th>AIRCRAFT</th><th class="r">RELEASED</th><th class="r">DELIVERED</th></tr></thead><tbody>' +
        rq.map(r => '<tr class="c" data-k="aircraft|' + r.cs + '"><td class="w">' + r.id + '</td><td class="c-' + cls[r.state] + '">' + r.state + '</td><td>' + r.from + ' → ' + r.to + '</td><td>' + esc(r.desc) + '</td><td class="c-' + POD_CLS[r.type] + '">' + r.pod + '</td><td class="r">' + r.kg + '</td><td>' + r.cs + '</td><td class="r">' + (r.tDep ? fmtClock(r.tDep) : '') + '</td><td class="r">' + (r.tDel ? fmtClock(r.tDel) : '') + '</td></tr>').join('') + '</tbody></table>';
    } else {
      const lg = sim.log.filter(l => l.scn === scn).slice(-60).reverse(); note = 'EVERY RELEASE, SEAL AND HANDOFF CARRIES A TIME';
      const cls = { AIR: 'hot', GROUND: 'ok', ROSTER: 'mx', MX: 'warn', C2: 'info' };
      h = '<table><thead><tr><th>TIME</th><th>FROM</th><th>EVENT</th></tr></thead><tbody>' + lg.map(l => '<tr' + (l.cs ? ' class="c" data-k="aircraft|' + l.cs + '"' : '') + '><td>' + fmtClock(l.t, true) + '</td><td class="c-' + cls[l.src] + '">' + l.src + '</td><td class="wrap">' + esc(l.text) + '</td></tr>').join('') + '</tbody></table>';
    }
    setHTML(tw, h); tw.scrollTop = force ? 0 : keep; $('ttNote').textContent = note;
    if (force) this.chrome();
  }

  /* ---------- feed and sources drawer ---------- */
  feed(open) {
    const el = $('feed'); el.hidden = !open; if (!open) return;
    const row = (a, b, c) => '<tr><td class="w">' + a + '</td><td>' + b + '</td><td class="c-mute">' + c + '</td></tr>';
    el.innerHTML = '<div class="dh"><div class="row"><span class="cap">Data feed and sources</span><button type="button" class="x" data-act="closefeed" aria-label="Close">×</button></div><h2>Simulated today, wired for live data</h2></div><div class="db">' +
      '<p>The views read one state object and nothing else. The simulation writes that state now; a telemetry feed can write it instead. Each aircraft publishes this record:</p>' +
      '<div><h4>Live record · <span id="feedCs"></span></h4><pre id="feedJson"></pre></div>' +
      '<div><h4>The record · ' + esc(this.app.live.label()) + '</h4><p>Day 1 began at 06:00 AST on 25 Oct 2026 and the operation is one continuous record on the calendar: one simulated day is one real day. A backend job in the GitHub repository flies the record forward every hour, saves the full state and archives each closed day (totals per line, hub and corridor, and every leg flown) in <a href="' + REC.logs + '" target="_blank" rel="noopener">logs/</a>. Everyone who opens the page lands on today. The speed buttons fast-forward your own view; TODAY brings it back to the shared record.</p></div>' +
      '<div><h4>Going live</h4><pre>VectorTwin.ingest({ aircraft: [ record, … ] })\n// ingested aircraft stop being simulated and follow the feed\nVectorTwin.state()      // sites, pads, requests, log\nVectorTwin.config       // routes, sites and every constant below</pre></div>' +
      '<div><h4>What is real, what is modelled</h4><div class="tw" style="border:1px solid var(--line)"><table><thead><tr><th>ITEM</th><th>VALUE</th><th>SOURCE</th></tr></thead><tbody>' +
      row('Payload · range', L560.payloadKg + ' kg · ' + L560.rangeKm + ' km', 'LogiXair thesis') + row('MTOW · cruise · fuel', 'about ' + fmtInt(L560.mtowKg) + ' kg · ' + L560.cruiseKmh + ' km/h · ' + L560.fuelLph + ' L per flight hour', 'Saudi Brothers deck, Oct 2026') + row('Footprint · rotors', '7 m × 5 m · 6+2', 'LogiXair thesis') +
      row('Corridor box', '± ' + CORRIDOR.halfWidthM + ' m · ' + fmtInt(CORRIDOR.floorFt) + '–' + fmtInt(CORRIDOR.ceilFt) + ' ft · ' + fmtInt(CORRIDOR.baseLevelFt) + ' ft operating', 'LogiXair ConOps') + row('Separation · hold', CORRIDOR.sepVertFt + ' ft / ' + CORRIDOR.sepTrailKm.toFixed(1) + ' km · ' + CORRIDOR.holdRadiusKm + ' km orbit', 'Vector Air') +
      row('Pod', POD.lenM.toFixed(2) + ' × ' + POD.widthM.toFixed(2) + ' × ' + POD.heightM.toFixed(2) + ' m · ' + POD.pallets + ' pallets in tandem', 'LogiXair') + row('Price', 'SAR ' + TARIFF.DRY.toFixed(3) + ' per kg·km, dry and chilled (cautious case SAR ' + TARIFF.CAUTIOUS.toFixed(3) + ')', 'Saudi Brothers deck (A9)') + row('Offshore price', 'SAR ' + fmtInt(TARIFF.SORTIE.OF) + ' per loaded sortie', 'deck says per-sortie pricing; the figure is a placeholder') + row('Operating cost', 'SAR ' + COST.deckFh + ' per flight hour (ownership 227 · insurance 113 · fuel 60 · maintenance 210 · remote pilot 113 · ops centre 100 · satcom 25) + SAR ' + COST.landing + ' per landing', 'Saudi Brothers deck (A5)') + row('Fixed cost per airframe', 'SAR ' + fmtInt(COST.fixedDay) + ' a day: ownership, insurance and ops centre at the deck\'s 1,800 FH a year', 'derived from the deck') + row('Aircraft unit cost', 'SAR ' + (COST.unitSar / 1e6).toFixed(1) + 'M, early Saudi-built units', 'Saudi Brothers deck (A5)') + row('Helicopter · road comparison', 'SAR ' + fmtInt(COST.heliSarH) + ' an hour · SAR ' + COST.roadSarKm + ' a km', 'deck estimates') + row('Billed distance', 'great-circle km between the two sites', 'modelled') + row('Road comparison', 'real road km and drive time per corridor (typical Google Maps figures incl. border crossings; desert track where there is no road; boat for islands and offshore', 'estimated, Oct 2026') + row('Demand by hour', 'peak 10:00–15:00 (97% of roster), evening taper, night ' + Math.round(DEMAND[2] * 100) + '%', 'your brief, curve modelled') + row('Stand-down', 'where the last leg ended · daily inspection ≥ ' + (DUTY.minRestS / 3600) + ' h · max ' + DUTY.maxFh + ' FH per duty', 'modelled') + row('Line hangar', LAYOUTS.base.hangar + ' slots per base · ' + LAYOUTS.quay.hangar + ' per shore base · 4 stands per base and outstation', 'your brief / modelled') + row('Cargo mix', 'dry 20% above wet', 'your brief') + row('Pallet footprint', POD.palletMm[0] + ' × ' + POD.palletMm[1] + ' mm (EUR)', 'modelled') +
      row('Supervision', '1 pilot : ' + CORRIDOR.pilotMax + ' aircraft · all pilots at one ROC per operation · shifts follow demand', 'Vector Air / modelled') + row('C2 ground stations', 'about every ' + C2.spacingKm + ' km on land corridors · handoff hysteresis ' + C2.hystKm + ' km · SATCOM beyond ' + C2.satKm + ' km', 'modelled') + row('Pads', '10 × 10 m, fenced, for a 7 × 5 m aircraft', 'your brief') + row('Check pull-forward', 'within ' + DUTY.mxWindowFh + ' FH: overnight at the MRO hub if within ' + DUTY.mroNearKm + ' km of the base · MRO hangars ' + LAYOUTS.mro.hangar + ' slots', 'your brief') + row('Checks', 'basic ' + MX.basicFh + ' FH · full ' + MX.fullFh + ' FH', 'LogiXair MRO calculator') + 
      row('Coast, state lines, rivers, cities, airports', 'true position', 'Natural Earth 1:10m') + row('Relief and land colour', 'indicative, about 10 km per sample', 'NASA Blue Marble derivatives') +
      row('All bases, distribution centres, shore bases and camps', 'placeholder sites near the named towns, ports and fields', 'modelled') + row('Offshore fields and islands', 'approximate positions; no operator agreement implied', 'modelled') + row('Red Sea resort islands, NEOM, Empty Quarter camps', 'indicative positions', 'modelled') + row('Corridor paths, fleet per corridor', 'kept within the L560 range with reserve; the Taif corridor routes north of Makkah', 'modelled') + row('Level band per base', '2,200 · 3,400 · 4,600 ft; DC-to-DC lines at 5,000 ft', 'modelled inside the ConOps box') +
      row('Airframe geometry', 'built from the Fig. 01 plan schematic', 'modelled, not CAD') + row('Climb, transition and landing profile', L560.hoverAltM + ' m hover · ' + L560.transOutS + ' s out · ' + L560.transInS + ' s in', 'modelled') + row('Turnaround durations', 'pod swap under 10 min', 'modelled to the thesis figure') + row('Truck dock cycle', DOCK.move + ' s per pallet by forklift', 'modelled') + row('Dock volume', 'pallet load height ' + POD.loadHm.toFixed(1) + ' m · ' + PALLET_M3.toFixed(2) + ' m³ per pallet', 'modelled') + row('Dry / wet split', 'wet = cold chain and liquid pods; all others dry', 'modelled') + row('Battery and fuel curves', 'per cent only', 'modelled') + row('Airport rings', '5 NM, for orientation', 'not airspace data') +
      '</tbody></table></div></div><p class="src">Not for operational use. No operator, customer or site agreement is implied by any place shown.</p></div>';
    this.feedTick();
  }
  feedTick() { if ($('feed').hidden) return; const a = this.featured(); if (!a) return; $('feedCs').textContent = a.cs; $('feedJson').textContent = JSON.stringify(this.sim.telemetry(a), null, 1).replace(/\n\s+/g, m => m.length > 3 ? ' ' : m); }

  /* ---------- scheduler ---------- */
  tick(dt) {
    this.acc = (this.acc || 0) + dt; this.acc2 = (this.acc2 || 0) + dt;
    this.clock();
    if (this.acc > 0.25) { this.acc = 0; this.tracker(); this.detail(); this.feedTick(); this.scale(); }
    if (this.acc2 > 1.0) { this.acc2 = 0; this.kpis(); this.tables(); this.ops.render(); }
  }
  scale() {
    if (this.app.view !== 'map') return; const rig = this.app.map.rig, kmpx = rig.dist * 2 * Math.tan(this.app.map.cam.fov * DEG / 2) / this.app.map.H;
    const want = kmpx * 110, nice = [5, 10, 20, 50, 100, 200, 500].reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a);
    $('scaleTxt').textContent = nice + ' KM'; $('scaleBar').style.width = (nice / kmpx).toFixed(0) + 'px';
  }
  refresh() { this.chrome(); this.kpis(); this.tracker(); this.detail(true); this.tables(true); }
}
