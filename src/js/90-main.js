/* ============================================================================
   APPLICATION — owns the simulation clock, the two views and the selection.
   ========================================================================== */
const regionOf = scn => { const d = SCENARIOS.find(x => x.id === scn); return (d && d.region) || 'IN'; };
class App {
  get map() { return this.maps[regionOf(this.scn)] || this.maps.IN; }
  constructor() {
    this.maps = {};
    this.canvas = $('gl');
    this.renderer = makeRenderer(this.canvas);
    this.sim = new Sim(560);
    this.scn = 'MM'; this.sel = null; this.view = 'map'; this.speed = 1; this.paused = false; this.live = new Live(this); this.wx = 'CLEAR'; this.light = 'AUTO'; this.siteId = null;
    this.following = false; this.tInput = 0; this.calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); this.tReal = 0; this.last = 0; this.fpsAcc = 0; this.fpsN = 0; this.busy = false; this.uiHold = false;
  }
  async start() {
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));          // let the loading card paint first
    // signage and liveries are drawn to canvas, so give the web fonts a moment to arrive first
    if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load('800 20px Archivo'), document.fonts.load('600 20px "JetBrains Mono"')]).catch(() => 0), new Promise(r => setTimeout(r, 1800))]);
    buildTextures(); buildMaterials();
    const say = t => { const p = $('loadTxt'); if (p) p.textContent = t; };
    await this.live.boot(say);
    if (this.live.speed != null) { if (this.live.speed === 0) this.paused = true; else this.speed = this.live.speed; }
    this.maps.IN = new MapView(this, 'IN'); await this.maps.IN.init();
    this.site = new SiteView(this);
    this.ui = new UI(this);
    this._input();
    // deep link: #MM, #NV, #OF or a site id such as #HYD
    const tag = (location.hash || '').replace('#', '').toUpperCase();
    if (this.sim.scn[tag]) this.scn = tag; else if (this.sim.sites[tag]) this.scn = this.sim.sites[tag].scn;
    await this._ensureMap(regionOf(this.scn)); this._mapLabels(true);
    const v = this.sim.scn[this.scn].def.view; this.map.flyTo(v.lat, v.lon, v.dist * this._fit(), v.az, v.tilt, true);
    this.ui.refresh();
    if (this.sim.sites[tag]) this.enterSite(tag, true);
    window.VectorTwin = { ingest: m => this.sim.ingest(m), state: () => ({ time: this.sim.t, wx: this.sim.wx, sites: this.sim.sites, aircraft: this.sim.aircraft.map(a => this.sim.telemetry(a)), requests: this.sim.requests, log: this.sim.log }), config: { L560, CORRIDOR, MX, SCENARIOS } };
    requestAnimationFrame(t => this.frame(t));
    setTimeout(() => $('load').classList.add('off'), 120);
    this.live.loop();
  }
  /* screen area the panels leave free; the cameras are re-centred on it */
  insets() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (W <= 900) return { l: 0, r: 0, t: 210, b: $('app').getAttribute('data-sheet') ? Math.min(H * 0.46, 360) + 38 : 38 };
    return { l: 0, r: W <= 1180 ? 320 : 348, t: 190, b: 256 };
  }
  _applyInsets() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, i = this.insets();
    for (const c of [...Object.values(this.maps).map(m => m.cam), this.site.cam]) c.setViewOffset(W, H, (i.r - i.l) / 2, (i.b - i.t) / 2, W, H);
  }
  /* scenario views are authored for a clear 16:9 frame: pull back until they fit the free area */
  _fit() { const W = this.canvas.clientWidth, H = this.canvas.clientHeight, i = this.insets(); return clamp(Math.max(H / Math.max(120, H - i.t - i.b), (16 / 9) * H / Math.max(160, W - i.l - i.r)) * 0.9, 1, 3.2); }

  lightHour() { return this.light === 'AUTO' ? (this.sim.t / 3600) % 24 : { DAY: 11.4, DUSK: 17.62, NIGHT: 22.5 }[this.light]; }
  /* any speed: the record is saved every minute and on close, whatever the speed */
  setSpeed(v) {
    if (v === 0) this.paused = !this.paused; else { this.paused = false; this.speed = v; }
    this.ui.chrome();
    if (this.live.writer) this.live.save().catch(() => 0);
  }
  /* the Southeast Asia map is built the first time it is opened */
  async _ensureMap(region) {
    if (this.maps[region]) return this.maps[region];
    const v = $('veil'); v.classList.add('on'); await new Promise(r => setTimeout(r, 60));
    const m = new MapView(this, region); await m.init(); this.maps[region] = m; this._size = null;
    const def = SCENARIOS.find(x => x.region === region), w = def.view; m.flyTo(w.lat, w.lon, w.dist * this._fit(), w.az, w.tilt, true);
    v.classList.remove('on'); return m;
  }
  _mapLabels(on) { for (const r of ['IN', 'SEA']) { const el = $(r === 'SEA' ? 'labels-map-sea' : 'labels-map'); if (el) el.hidden = !(on && regionOf(this.scn) === r); } }
  /* shared record: drop whatever was fast-forwarded here and load today's record again */
  backToToday() {
    const v = $('veil'); v.classList.add('on');
    this.live.today(t => { const c = $('clockSub'); if (c) c.textContent = t; }).then(ok => { this.speed = 1; this.paused = false; v.classList.remove('on'); this.ui.refresh(); });
  }
  setScenario(id) {
    const go = () => {
      const jump = regionOf(id) !== regionOf(this.scn);
      this._ensureMap(regionOf(id)).then(() => {
        this.scn = id; this.sel = null; this.following = false; this._size = null; this._mapLabels(true);
        const v = this.sim.scn[id].def.view; this.map.flyTo(v.lat, v.lon, v.dist * this._fit(), v.az, v.tilt, jump); this.ui.refresh();
      });
    };
    if (this.view === 'site') this.exitSite(go); else go();
  }
  /* within Southeast Asia: fly to one country */
  flyZone(z) { const d = this.sim.scn[this.scn].def, Z = d.zones && d.zones[z]; if (!Z) return; this.map.flyTo(Z.lat, Z.lon, Z.dist * this._fit(), 0, 60); }
  _veil(fn) {
    if (this.busy) return; this.busy = true; const v = $('veil'); v.classList.add('on');
    setTimeout(() => { fn(); this._size = null; requestAnimationFrame(() => requestAnimationFrame(() => { v.classList.remove('on'); this.busy = false; })); }, 350);
  }
  enterSite(id, instant) {
    const S = this.sim.sites[id]; if (!S || (this.view === 'site' && this.siteId === id)) return;
    const run = () => {
      this.view = 'site'; this.siteId = id; this.scn = S.scn; this.site.enter(id); this.following = false;
      if (this.sel && this.sel.type !== 'aircraft') this.sel = null;
      this._mapLabels(false); $('labels-site').hidden = false; this._size = null; this.ui.refresh();
    };
    if (instant) return run();
    if (this.view === 'map') this.map.rig.goto(this.map.pos(S.lat, S.lon, 0), 70, null, 50);
    this._veil(run);
  }
  exitSite(then) {
    if (this.view !== 'site') return;
    if (!this.maps[regionOf(this.scn)]) { this._ensureMap(regionOf(this.scn)).then(() => this.exitSite(then)); return; }
    this._veil(() => {
      const S = this.sim.sites[this.siteId]; this.view = 'map';
      if (this.sel && this.sel.type !== 'aircraft') this.sel = { type: 'site', id: S.id };
      this._mapLabels(true); $('labels-site').hidden = true;
      this.map.rig.follow = null; this.map.rig.goto(this.map.pos(S.lat, S.lon, 0), 90, null, 50, true);
      const v = this.sim.scn[this.scn].def.view; this.map.rig.goto(this.map.pos(S.lat, S.lon, 0), Math.min(520, v.dist), v.az, v.tilt);
      this.ui.refresh(); if (then) then();
    });
  }
  rig() { return this.view === 'map' ? this.map.rig : this.site.rig; }
  cur() { return this.view === 'map' ? this.map : this.site; }
  selPos() {
    const s = this.sel; if (!s) return null;
    if (this.view === 'site') return this.site.selPos();
    if (s.type === 'aircraft') { const i = this.sim.aircraft.findIndex(a => a.cs === s.id); return i >= 0 && (AIRBORNE[this.sim.aircraft[i].phase]) ? this.map.acPos[i] : (i >= 0 && this.sim.aircraft[i].site ? this.map.siteObj[this.sim.aircraft[i].site].g.position : null); }
    if (s.type === 'site') return this.map.siteObj[s.id] ? this.map.siteObj[s.id].g.position : null;
    return null;
  }
  toggleFollow() { this.following = !this.following; this._applyFollow(); this.ui.detail(true); }
  _applyFollow() {
    const rig = this.rig(), s = this.sel;
    rig.follow = (this.following && s && s.type === 'aircraft') ? () => { const p = this.selPos(); return p ? p : null; } : null;
  }
  /* select something; fly = move the camera to it */
  select(s, fly) {
    const sim = this.sim, to = s && (s.type === 'aircraft' && sim.byCs[s.id] ? sim.byCs[s.id].scn : s.type === 'site' && sim.sites[s.id] ? sim.sites[s.id].scn : s.type === 'route' && sim.routes[s.id] ? sim.routes[s.id].scn : null);
    if (to && this.view === 'map' && regionOf(to) !== regionOf(this.scn)) {               // the other side of the map: switch region first
      this._ensureMap(regionOf(to)).then(() => { this.scn = to; this._size = null; this._mapLabels(true); const v = sim.scn[to].def.view; this.map.flyTo(v.lat, v.lon, v.dist * this._fit(), v.az, v.tilt, true); this.select(s, true); });
      return;
    }
    if (s && s.type === 'aircraft' && sim.byCs[s.id] && sim.byCs[s.id].scn !== this.scn && this.view === 'map') { this.scn = sim.byCs[s.id].scn; }
    if (s && s.type === 'site' && sim.sites[s.id] && sim.sites[s.id].scn !== this.scn && this.view === 'map') this.scn = sim.sites[s.id].scn;
    this.sel = s; this.following = false; this.tInput = this.tReal;
    if ($('app').getAttribute('data-sheet') === '' && s && window.innerWidth <= 900) $('app').setAttribute('data-sheet', 'detail');
    if (s && this.view === 'map') {
      const rig = this.map.rig;
      if (s.type === 'aircraft') { this.following = true; if (fly || rig.dist > 900) rig.gdist = Math.min(rig.gdist, 520); }
      else if (s.type === 'site' && fly) { const S = sim.sites[s.id]; rig.goto(this.map.pos(S.lat, S.lon, 0), Math.min(rig.gdist, 420)); }
      else if (s.type === 'route' && fly) { const R = sim.routes[s.id], o = this.map.routeObj[s.id]; rig.goto(o.mid.clone().setY(0), clamp(R.km * 2.4, 160, 1500)); }
    }
    if (s && this.view === 'site') {
      const rig = this.site.rig, p = this.site.selPos();
      if (s.type === 'site' && s.id !== this.siteId) { this.sel = null; }
      else if (s.type === 'aircraft') { if (p) { this.following = true; rig.gdist = Math.min(rig.gdist, Math.hypot(p.x, p.z) > 300 ? 160 : 46); } }
      else if (p && fly !== false) { rig.follow = null; rig.goto(p.clone(), s.type === 'pad' ? 38 : Math.min(rig.gdist, 90)); }
    }
    this._applyFollow(); this.ui.refresh();
  }
  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0.016); this.last = t; this.tReal += dt;
    const c = this.canvas, W = c.clientWidth, H = c.clientHeight, key = W + 'x' + H + this.view;
    if (key !== this._size && W > 0 && H > 0) { this._size = key; this.renderer.setSize(W, H, false); this.map.resize(W, H); this.site.resize(W, H); this._applyInsets(); }
    if (!this.paused) this.sim.step(dt * this.speed, this.speed >= 300 ? 4 : this.speed >= 60 ? 2 : 1);
    // a followed aircraft that leaves the site scene releases the camera
    if (this.following && !this.selPos()) { this.following = false; this._applyFollow(); }
    const V = this.cur(); V.update(dt, this.tReal); V.render(this.renderer);
    if (!this.uiHold) this.ui.tick(dt);
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 1) { window.__fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    window.__twinReady = true;
    requestAnimationFrame(t => this.frame(t));
  }
  _input() {
    const el = this.canvas, pts = new Map(); let moved = 0, last2 = null, btn = 0, lastTap = 0, lastPick = null;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { this.tInput = this.tReal; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; btn = e.button; last2 = null; el.classList.add('drag'); });
    el.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy); this.tInput = this.tReal;
      const rig = this.rig();
      if (pts.size === 1) { if (btn === 2 || e.ctrlKey || e.shiftKey || e.altKey) rig.orbit(dx, dy); else { rig.pan(dx, dy); if (moved > 6 && this.following) { this.following = false; this._applyFollow(); } } }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
        if (last2) { rig.zoom(last2.d / Math.max(1, d)); rig.gaz -= wrap180((ang - last2.ang) / DEG); rig.gtilt += (my - last2.my) * 0.25; rig.clampGoal(); }
        last2 = { d, ang, my };
      }
    });
    const up = e => {
      const had = pts.has(e.pointerId); pts.delete(e.pointerId); last2 = null; if (!pts.size) el.classList.remove('drag');
      if (!had || moved >= 6 || e.type !== 'pointerup' || btn === 2) return;
      const r = el.getBoundingClientRect(), hit = this.cur().pick(e.clientX - r.left, e.clientY - r.top), now = performance.now();
      if (hit && hit.type === 'site' && this.view === 'map' && lastPick && lastPick.id === hit.id && now - lastTap < 420) { this.enterSite(hit.id); return; }
      lastTap = now; lastPick = hit; this.select(hit, false);
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); this.tInput = this.tReal; this.rig().zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)); }, { passive: false });
    window.addEventListener('keydown', e => { if (e.key !== 'Escape' || e.target.tagName === 'INPUT') return; if (!$('ops').hidden) this.ui.ops.show(false); else if (!$('feed').hidden) this.ui.feed(false); else if (this.sel) this.select(null); else if (this.view === 'site') this.exitSite(); });
    // keep panel buttons alive under a pointer: pause panel re-rendering while a press is in progress
    for (const id of ['detail', 'tables', 'track', 'areas', 'ops', 'kpi']) { const p = $(id); p.addEventListener('pointerdown', () => { this.uiHold = true; }); }
    window.addEventListener('pointerup', () => setTimeout(() => { this.uiHold = false; }, 60)); window.addEventListener('pointercancel', () => { this.uiHold = false; });
  }
}
const fail = e => { const p = $('loadTxt'); if (p) p.textContent = 'COULD NOT START THE 3D VIEW: ' + (e && e.message ? e.message : e) + ' · THIS PAGE NEEDS WEBGL'; console.error(e); };
try { const APP = new App(); window.__app = APP; APP.start().catch(fail); } catch (e) { fail(e); }
