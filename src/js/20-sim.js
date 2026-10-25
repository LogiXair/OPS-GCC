/* ============================================================================
   OPERATIONS SIMULATION
   One world state, stepped in simulated seconds. The renderers and the dashboard
   read this state only, so a real telemetry feed can replace the stepping
   (see Twin.ingest at the bottom of the file) without touching the views.
   ========================================================================== */

const PHASE_LABEL = {
  STANDBY: 'STANDBY', GROUND: 'TURNAROUND', LIFT: 'VTOL ASCENT', TRANS_OUT: 'TRANSITION →', CLIMB: 'CLIMB', CRUISE: 'CRUISE',
  DESCENT: 'DESCENT', HOLD: 'HOLD', TRANS_IN: 'TRANSITION ←', LAND: 'VTOL LANDING', MAINT: 'MAINTENANCE', REST: 'STOOD DOWN'
};
const STEP_LABEL = {
  SAFE: 'ON PAD', REST: 'STOOD DOWN', POD_OUT: 'POD OUT', POD_IN: 'POD IN + SEAL', FUELWAIT: 'REFUEL', PREFLIGHT: 'PRE-FLIGHT', RELEASE: 'AWAIT RELEASE', MAINT: 'BASIC CHECK'
};
const AIRBORNE = { LIFT: 1, TRANS_OUT: 1, CLIMB: 1, CRUISE: 1, DESCENT: 1, HOLD: 1, TRANS_IN: 1, LAND: 1 };

/* per-dock volume counters: pods, pallets, kg, split by cargo class and by the site at the other end of the flight */
const flowStat = () => ({ pods: 0, pallets: 0, kg: 0, by: {}, lane: {} });
const tally = (f, type, kg) => { f.pods++; f.pallets += POD.pallets; f.kg += kg; const b = f.by[type] || (f.by[type] = { pods: 0, kg: 0 }); b.pods++; b.kg += kg; };
const lane = (f, peer, kg) => { const l = f.lane[peer] || (f.lane[peer] = { pods: 0, kg: 0 }); l.pods++; l.kg += kg; };

/* ---------- business ledger: one record per operating day (06:00 to 06:00 AST), with hourly buckets ---------- */
const ledRec = () => ({ cons: 0, rev: 0, revSortie: 0, revDry: 0, revWet: 0, kg: 0, kgDry: 0, kgWet: 0, tkm: 0, pods: 0, legs: 0, empty: 0, capKg: 0, fh: 0, dep: 0, arr: 0, holds: 0, late: 0,
  podsOut: 0, kgOut: 0, podsIn: 0, kgIn: 0, revOut: 0, revIn: 0, dryOut: 0, wetOut: 0, dryIn: 0, wetIn: 0, mx: 0, down: 0 });
const ledAdd = (o, k, v) => { o[k] += v; };
const isWet = type => !!WET_TYPES[type];

const SNAP_V = 2;

class Sim {
  constructor(seed) {
    this.rnd = seededRng(seed || 560);
    this.t = 6 * 3600;                 // seconds since local midnight (AST)
    this.t0 = this.t;
    this.wx = 'CLEAR';
    this.sites = {}; this.routes = {}; this.scn = {}; this.aircraft = []; this.byCs = {};
    this.requests = []; this.log = []; this.reqSeq = 4400; this.podSeq = 100;
    this.live = false;
    this.led = null; this.days = []; this.biz = []; this._fh = {}; this._fhR = {};
    this._build(); this._seedRest(); this._ledger();
  }

  /* ---------- construction ---------- */
  _build() {
    const vT = L560.transSpeedMs;
    this.dTI = vT * L560.transInS / 2;             // metres covered in the inbound transition
    for (const sc of SCENARIOS) {
      const S = this.scn[sc.id] = { def: sc, id: sc.id, pilots: sc.pilots.map(p => ({ ...p, load: 0 })),
        kpi: { sorties: 0, kg: 0, onTime: 0, legs: 0, blockS: 0, holds: 0, kmFlown: 0 }, lastRel: {} };
      for (const d of sc.sites) {
        const L = LAYOUTS[d.layout];
        const site = this.sites[d.id] = {
          id: d.id, def: d, scn: sc.id, name: d.name, kind: d.kind, L, lat: d.lat || 0, lon: d.lon || 0, rot: 0, speedMs: 0,
          padElev: L.padElev || 0, moving: !!d.track,
          pads: L.pads.slice(0, d.npads).map((p, i) => ({ ...p, i, door: L.doors[i], state: 'FREE', cs: null, step: null, t: 0, dur: 0, fuel: 'NA' })),
          bowsers: d.refuel ? L.lanes.filter(l => l.pads.some(pi => pi < d.npads)).map((l, i) => ({ i, z: l.z, home: l.home, x: l.home, lanePads: l.pads, state: 'IDLE', pad: -1, t: 0, queue: [], dir: -1 })) : [],
          stands: L.stands.map(s => ({ ...s, cs: null })), wind: { dir: 250, kt: 9 }
        };
        // truck dock: each station turns a vehicle-load of two pallets into a pod (BUILD) or a delivered pod back into a vehicle-load (BREAK)
        site.dock = L.dock ? { st: L.dock.slice(0, d.kind === 'BASE' ? 2 : 1).map((c, i) => ({ i, state: 'IDLE', t: 0, dur: 15 + this.rnd() * 60, job: null, k: 0, type: 'DRY', veh: 0, kg: 0, peer: null, cs: null, fin: flowStat(), fout: flowStat() })),
          need: 2, qBreak: [], qBuild: 0, acc: this.rnd(), staged: [], moves: [], built: 0, broken: 0, pallets: 0, qMax: 0, trucks: 0,
          rate: d.kind === 'BASE' ? TRUCKS.base : L === LAYOUTS.quay ? TRUCKS.quay : TRUCKS.spoke, cap: d.kind === 'BASE' ? TRUCKS.stagedBase : TRUCKS.stagedSpoke } : null;
        if (d.track) this._moveShip(site, 0);
      }
      for (const r of sc.routes) {
        const R = this.routes[r.id] = { id: r.id, scn: sc.id, a: r.a, b: r.b, wps: r.wps, mro: !!r.mro, cont: r.cont || [], color: sc.color, n: r.n,
          trunk: !!r.trunk, sea: !!r.sea, baseFt: r.band || this.sites[r.a].def.band || CORRIDOR.baseLevelFt };
        R.name = this.sites[r.a].id + ' → ' + this.sites[r.b].id;
        this._routeGeom(R);
      }
    }
    // fleet
    for (const sc of SCENARIOS) {
      let k = 0;
      const mk = () => this._newAircraft(sc, k++);
      for (const r of sc.routes) {
        for (let i = 0; i < r.n; i++) {
          const a = mk(); a.home = r.id;
          const f = (i + 0.37) / r.n, dir = f < 0.5 ? 1 : -1, p = 0.10 + 0.8 * ((f % 0.5) / 0.5);
          this._placeCruise(a, this.routes[r.id], dir, p, i);
        }
      }
      // spare airframes on the stands of each base
      for (const d of sc.sites) {
        const base = this.sites[d.id], own = sc.routes.filter(r => r.a === d.id && !r.mro);
        for (let i = 0; i < Math.min(d.spares || 0, base.stands.length); i++) {
          const a = mk(); a.home = own[i % own.length].id; a.phase = 'STANDBY'; a.pt.STANDBY = this.t; a.site = base.id; a.stand = i; base.stands[i].cs = a.cs;
          a.tilt = 90; a.fuel = 100; a.soc = 96; this._lockToStand(a, base);
        }
      }
      // one airframe from each base already in its MRO hub for a basic check
      for (const mroR of sc.routes.filter(r => r.mro)) {
        const site = this.sites[mroR.b], pad = site.pads.find(p => p.state === 'FREE'), own = sc.routes.filter(r => r.a === mroR.a && !r.mro);
        if (!pad || !own.length) continue;
        const a = mk();
        a.home = own[Math.min(1, own.length - 1)].id; a.phase = 'GROUND'; a.pt.GROUND = this.t; a.site = site.id; a.pad = pad.i; a.tilt = 90; a.route = mroR.id; a.dir = 1;
        a.from = mroR.a; a.to = mroR.b; a.fh = a.nextCheck + 0.4;
        pad.state = 'OCCUPIED'; pad.cs = a.cs; pad.step = 'MAINT'; pad.t = MX.basicDurS * (0.25 + 0.4 * this.rnd()); pad.dur = MX.basicDurS;
        this._lockToPad(a, site, pad);
        // a few more airframes of that base come due through the day, so the ferry and the hub stay in use
        const due = this.aircraft.filter(x => x.scn === sc.id && x.phase === 'CRUISE' && this.routes[x.home].a === mroR.a);
        [5.0, 6.3, 7.6, 9.4].forEach((h, j) => { const x = due[(j * 5 + 2) % due.length]; if (x) x.fh = x.nextCheck - h; });
      }
    }
  }

  _newAircraft(sc, k) {
    const cs = sc.prefix + '-' + (sc.csBase + k);
    const fh = Math.floor(this.rnd() * 160) + (k % 9 === 4 ? 171 : 0) + 175 * Math.floor(this.rnd() * 6);
    const a = {
      cs, scn: sc.id, home: null, route: null, dir: 1, from: null, to: null, phase: 'STANDBY',
      lat: 0, lon: 0, alt: 0, gs: 0, hdg: 0, vs: 0, tilt: 90, levelFt: 0, rpm: 0,
      soc: 80 + this.rnd() * 14, fuel: 60 + this.rnd() * 35, gen: 'OFF', pod: null, req: null,
      pilot: null, gcs: null, link: 'GROUND', fh, nextCheck: Math.ceil((fh + 0.01) / MX.basicFh) * MX.basicFh,
      rem: 0, total: 0, eta: 0, pad: -1, stand: -1, site: null, wps: [], wpi: 0, tPhase: 0, tDep: 0, plannedS: 0,
      desc: null, hold: null, trail: [], tTrail: 0, tC2: 0, legs: 0, ext: false, pt: {},
      duty: this.rnd() * 2, restAt: null, tRest: 0, restNext: null, mxUntil: 0
    };
    this.aircraft.push(a); this.byCs[cs] = a;
    return a;
  }

  /* ---------- geometry ---------- */
  _moveShip(site, dt) {
    const tr = site.def.track, a = tr.rKm[0], b = tr.rKm[1];
    const circ = 2 * Math.PI * Math.sqrt((a * a + b * b) / 2), period = circ / (tr.kt * KT * 3.6) * 3600;
    const th = tr.phase + 2 * Math.PI * (this.t - this.t0 + 40000) / period;
    site.lat = tr.lat + b * Math.cos(th) / KM_LAT;
    site.lon = tr.lon + a * Math.sin(th) / (KM_LON * Math.cos(tr.lat * DEG));
    const dE = a * Math.cos(th), dN = -b * Math.sin(th), w = 2 * Math.PI / period;
    site.rot = wrap360(Math.atan2(dE, dN) / DEG);
    site.speedMs = Math.hypot(dE, dN) * w * 1000;
  }
  /* site-local metres (x east, z south before rotation) -> lat/lon */
  localToLL(site, x, z) {
    const c = Math.cos(site.rot * DEG), s = Math.sin(site.rot * DEG);
    const E = x * c - z * s, N = -x * s - z * c;
    return [site.lat + N / (KM_LAT * 1000), site.lon + E / (KM_LON * 1000 * Math.cos(site.lat * DEG))];
  }
  /* lat/lon -> site-local metres */
  llToLocal(site, lat, lon) {
    const E = (lon - site.lon) * KM_LON * 1000 * Math.cos(site.lat * DEG), N = (lat - site.lat) * KM_LAT * 1000;
    const c = Math.cos(site.rot * DEG), s = Math.sin(site.rot * DEG);
    return [E * c - N * s, -(E * s + N * c)];
  }
  padLL(site, pi) { const p = site.pads[Math.max(0, pi)]; return this.localToLL(site, p.x, p.z); }
  _routeGeom(R) {
    const A = this.sites[R.a], B = this.sites[R.b];
    const pts = [[A.lat, A.lon], ...R.wps, [B.lat, B.lon]];
    let km = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { km += distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); cum.push(km); }
    R.pts = pts; R.cum = cum; R.km = km; R.direct = distKm(A.lat, A.lon, B.lat, B.lon);
    // C2 ground stations: four along a long corridor [conops], one at each end of a short or sea leg
    const sea = R.sea || A.kind === 'SHIP' || B.kind === 'SHIP' || B.kind === 'PLATFORM';
    // C2 ground stations: one at each end and about every C2.spacingKm between on land; at sea only the shore end and the deck
    const n = sea ? 2 : Math.max(2, Math.round(km / C2.spacingKm) + 1);
    R.gcs = [];
    for (let i = 0; i < n; i++) { const d = km * i / (n - 1), p = this._alongRoute(R, d), end = i === 0 ? 'a' : i === n - 1 ? 'b' : null;
      R.gcs.push({ name: end ? R.id + ' · ' + (end === 'a' ? A.id : B.id) : R.id + ' · GS ' + String(Math.round(d)).padStart(3, '0'), lat: p[0], lon: p[1], end, km: d }); }
  }
  _alongRoute(R, d) {
    const { pts, cum } = R; d = clamp(d, 0, R.km);
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f), i];
  }
  _resolve(wp) {
    if (wp.t === 'LL' || wp._c) return wp;
    const site = this.sites[wp.site];
    wp._c = !site.moving;
    if (wp.t === 'PAD') { const ll = this.padLL(site, wp.pad); wp.lat = ll[0]; wp.lon = ll[1]; return wp; }
    const p = site.pads[Math.max(0, wp.pad)], b = (wp.brg) * DEG;                     // REL: bearing relative to the site's own heading
    const ll = this.localToLL(site, p.x + Math.sin(b) * wp.d, p.z - Math.cos(b) * wp.d);
    wp.lat = ll[0]; wp.lon = ll[1]; return wp;
  }
  _legWps(R, dir, padTo) {
    const from = this.sites[dir > 0 ? R.a : R.b], to = this.sites[dir > 0 ? R.b : R.a];
    const mid = (dir > 0 ? R.wps : R.wps.slice().reverse()).map(w => ({ t: 'LL', lat: w[0], lon: w[1] }));
    const w = [];
    if (from.L.dep != null) w.push({ t: 'REL', site: from.id, pad: 0, brg: from.L.dep, d: 520 });
    w.push(...mid);
    if (to.L.app != null) { w.push({ t: 'REL', site: to.id, pad: 0, brg: to.L.app, d: 3200 }); w.push({ t: 'REL', site: to.id, pad: 0, brg: to.L.app, d: this.dTI + 450 }); }
    w.push({ t: 'PAD', site: to.id, pad: padTo == null ? 0 : padTo });
    return w;
  }
  _remKm(a) {
    let w = this._resolve(a.wps[a.wpi]);
    const d = distKm(a.lat, a.lon, w.lat, w.lon);
    // distance beyond the active waypoint is cached; legs that end on a moving vessel are refreshed every few seconds
    if (a._sfxI !== a.wpi || a._sfxW !== a.wps || (a._sfxMov && this.t - a._sfxT > 4)) {
      let s = 0, mov = false;
      for (let i = a.wpi + 1; i < a.wps.length; i++) { const n = this._resolve(a.wps[i]); s += distKm(w.lat, w.lon, n.lat, n.lon); w = n; if (n.site && this.sites[n.site].moving) mov = true; }
      a._sfx = s; a._sfxI = a.wpi; a._sfxW = a.wps; a._sfxT = this.t; a._sfxMov = mov;
    }
    return d + a._sfx;
  }
  _legKm(R, dir) {
    const A = this.sites[R.a], B = this.sites[R.b];
    if (!A.moving && !B.moving) return R.km;
    this._routeGeom(R); return R.km;
  }
  _lockToPad(a, site, pad) {
    const ll = this.localToLL(site, pad.x, pad.z);
    a.lat = ll[0]; a.lon = ll[1]; a.hdg = wrap360(pad.hdg + site.rot); a.alt = 0; a.gs = site.speedMs; a.vs = 0;
  }
  _lockToStand(a, site) {
    const s = site.stands[a.stand], ll = this.localToLL(site, s.x, s.z);
    a.lat = ll[0]; a.lon = ll[1]; a.hdg = wrap360(s.hdg + site.rot); a.alt = 0; a.gs = 0;
  }
  _placeCruise(a, R, dir, p, idx) {
    const from = dir > 0 ? R.a : R.b, to = dir > 0 ? R.b : R.a;
    a.route = R.id; a.dir = dir; a.from = from; a.to = to; a.phase = 'CRUISE'; a.pt.CRUISE = this.t; a.tilt = 0; a.gs = L560.cruiseKmh / 3.6;
    a.levelFt = R.baseFt + (dir > 0 ? 0 : 200) + 400 * (idx % 3); a.alt = a.levelFt * FT;
    a.wps = this._legWps(R, dir, 0);
    const d = dir > 0 ? R.km * p : R.km * (1 - p), q = this._alongRoute(R, d);
    a.lat = q[0]; a.lon = q[1];
    // next waypoint index along the leg in flight order
    const nMid = R.wps.length, seg = q[2];                         // seg: index into R.pts of the vertex ahead (a->b order)
    const off = this.sites[from].L.dep != null ? 1 : 0;
    a.wpi = dir > 0 ? off + (seg - 1) : off + (nMid - (seg - 1));
    a.wpi = clamp(a.wpi, off, a.wps.length - 1);
    const w = this._resolve(a.wps[a.wpi]); a.hdg = bearing(a.lat, a.lon, w.lat, w.lon);
    a.total = R.km; a.rem = this._remKm(a); a.tDep = this.t - (a.total - a.rem) / (a.gs * 3.6) * 3600;
    a.plannedS = this._planS(a.total); a.gen = 'ON'; a.site = null;
    a.fuel = Math.max(a.fuel, a.rem * 100 / (L560.rangeKm * (1 + L560.reservePct / 100)) + 24);          // enough on board for the rest of the leg
    this._loadPod(a, from, to, true);
    this._assignPilot(a);
    if (a.req) a.req.state = 'AIRBORNE';
  }
  _planS(km) { return km / L560.cruiseKmh * 3600 + 260; }

  /* ---------- cargo ---------- */
  _loadPod(a, from, to, silent) {
    const sc = this.scn[a.scn], def = sc.def, R = this.routes[a.route];
    if (R.mro) { a.pod = null; a.req = null; return; }
    const outbound = from === R.a || this.sites[from].kind === 'BASE';         // loaded at a base: a full consignor pod
    if (!outbound && this.rnd() < 0.02) { a.pod = null; a.req = null; return; }       // rare: nothing consolidated in time, the empty pod flies back
    const fs0 = this.sites[from], stg = !silent && fs0.dock && fs0.dock.staged.length ? fs0.dock.staged.shift() : null;     // the oldest pod built at this site's truck dock
    const c = this._cargo(def, stg ? stg.type : null), T = POD_TYPES[c[0]];
    const ld = stg ? { kg: stg.kg, n: stg.n || 1 } : this._podLoad(a.scn, from, outbound), kg = ld.kg;
    if (stg) { lane(fs0.dock.st[stg.st].fout, to, kg); const m = fs0.dock.moves.find(x => x.t === stg.mv.t && x.i === stg.mv.i) || stg.mv; m.peer = to; m.cs = a.cs; }
    const pod = { id: T.prefix + '-' + (this.podSeq += 1 + Math.floor(this.rnd() * 6)), type: c[0], kg, n: ld.n, sealed: !!silent,
      tempC: c[0] === 'COLD' ? 4 + this.rnd() * 1.5 : null, setC: c[0] === 'COLD' ? 5 : null, shockG: 0.2, batt: 70 + Math.round(this.rnd() * 28) };
    const win0 = this.t + 600 + this.rnd() * 900;
    const req = { id: 'REQ-' + (++this.reqSeq), scn: a.scn, from, to, kg, n: ld.n, type: c[0], desc: c[1], consignor: outbound ? c[2] : this.sites[from].name,
      state: silent ? 'SEALED' : 'ASSIGNED', cs: a.cs, pod: pod.id, tReq: this.t - 300 - this.rnd() * 1500, tDep: 0, tDel: 0, late: false };
    a.pod = pod; a.req = req;
    const fs = this.sites[from]; if (fs.dock && !silent) fs.dock.need = Math.min(3, fs.dock.need + 1);      // a staged pod was used: build its replacement
    this.requests.push(req); if (this.requests.length > 90) this.requests.shift();
  }
  /* what goes into one pod: consignments are added until the pod reaches the load the demand at this site supports right now */
  _podLoad(scn, siteId, outbound) {
    // hold-for-load: the pod is closed once it reaches the fill the day's cargo supports, never below RULES.minFill
    const lvl = clamp(demandLevel(this.t, scn) * laneFactor(dayOf(this.t), siteId), 0, 1.6);
    const target = L560.payloadKg * clamp(RULES.minFill + (RULES.maxFill - RULES.minFill) * clamp01((lvl - 0.7) / 1.2 + (this.rnd() - 0.5) * 0.3), RULES.minFill, RULES.maxFill);
    let kg = 0, n = 0;
    for (let tries = 0; tries < 200 && kg < target; tries++) {
      const r = this.rnd(), w = r < CONSIGN.small ? 2 + 33 * Math.pow(this.rnd(), 1.5) : r < CONSIGN.small + CONSIGN.medium ? 35 + 85 * this.rnd() : 120 + 180 * this.rnd();
      if (kg + w > L560.payloadKg) continue;                                   // does not fit: the next consignment in the queue is tried
      kg += w; n++;
    }
    return { kg: Math.max(2, Math.round(kg)), n };
  }
  /* one consignment line: of a given class, or drawn to the network's dry/wet mix */
  _cargo(def, type) {
    let pool = type ? def.cargo.filter(x => x[0] === type) : null;
    if (!pool || !pool.length) { const wet = def.cargo.filter(x => WET_TYPES[x[0]]), dry = def.cargo.filter(x => !WET_TYPES[x[0]]); pool = wet.length && dry.length ? (this.rnd() < (CARGO_MIX[def.id] || CARGO_MIX.wet) ? wet : dry) : def.cargo; }
    return pool[Math.floor(this.rnd() * pool.length)];
  }
  /* pilots on shift at the ROC follow demand; an off-shift pilot keeps the aircraft already handed to them until they land */
  onShift(scn) { const ps = this.scn[scn].pilots; return Math.min(ps.length, Math.max(Math.min(scn === 'SEA' ? 4 : 2, ps.length), Math.ceil(rosterLevel(this.t, scn) * ps.length * 1.1))); }
  _assignPilot(a) {
    const ps = this.scn[a.scn].pilots, k = this.onShift(a.scn);
    const fs = this.sites[a.from], z = fs && fs.def.zone, inZ = p => !z || !p.zone || p.zone === z;          // a country's aircraft are supervised from that country's ROC
    let best = null; for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (i < k && inZ(p) && p.load < CORRIDOR.pilotMax && (!best || p.load < best.load)) best = p; }
    if (!best) for (const p of ps) if (inZ(p) && p.load < CORRIDOR.pilotMax && (!best || p.load < best.load)) best = p;     // call in the next pilot rather than ground the aircraft
    if (!best) return false;
    best.load++; a.pilot = best.id; return true;
  }
  _releasePilot(a) {
    if (!a.pilot) return;
    const p = this.scn[a.scn].pilots.find(p => p.id === a.pilot); if (p) p.load = Math.max(0, p.load - 1);
    a.pilot = null;
  }
  _log(src, scn, text, cs) {
    this.log.push({ t: this.t, src, scn, text, cs: cs || null });
    if (this.log.length > 120) this.log.shift();
  }

  /* ---------- stepping ---------- */
  step(dtTotal, chunk) {
    let left = dtTotal; const c = chunk || 1;
    while (left > 1e-6) {
      const dt = Math.min(left, c); left -= dt;
      this.t += dt;
      for (const id in this.sites) { const s = this.sites[id]; if (s.moving) this._moveShip(s, dt); }
      this._ledger();
      if (this.live) continue;
      for (const id in this.sites) this._stepSite(this.sites[id], dt);
      for (const a of this.aircraft) if (!a.ext) this._stepAircraft(a, dt);
      this._bookFh();
    }
  }
  warmUp(untilSec, dt) { while (this.t < untilSec) this._coarse(Math.min(dt || 5, untilSec - this.t)); }
  _coarse(dt) {
    this.t += dt; this._ledger();
    for (const id in this.sites) { const s = this.sites[id]; if (s.moving) this._moveShip(s, dt); }
    for (const id in this.sites) this._stepSite(this.sites[id], dt);
    for (const a of this.aircraft) this._stepAircraft(a, dt);
    this._bookFh();
  }
  _bookFh() { for (const scn in this._fh) { if (this._fh[scn]) this._book(scn, null, null, 'fh', this._fh[scn]); this._fh[scn] = 0; }
    const L = this.led; if (L) for (const rid in this._fhR) { if (this._fhR[rid]) (L.route[rid] || (L.route[rid] = ledRec())).fh += this._fhR[rid]; this._fhR[rid] = 0; } }

  /* ----- ground: pads, pods, fuel ----- */
  _stepSite(site, dt) {
    for (const b of site.bowsers) this._stepBowser(site, b, dt);
    if (site.dock) this._stepDock(site, dt);
    this._fromRest(site);
    for (const pad of site.pads) {
      if (pad.state !== 'OCCUPIED') continue;
      const a = this.byCs[pad.cs]; if (!a || a.phase !== 'GROUND') continue;
      pad.t += dt;
      const T = site.kind === 'SHIP' || site.kind === 'PLATFORM' ? TURN.deck : TURN.land;
      const vary = base => base * (0.86 + this.rnd() * 0.28);
      switch (pad.step) {
        case 'SAFE':
          a.rpm = Math.max(0, a.rpm - dt * 0.06);
          if (pad.t >= pad.dur) {
            this._releasePilot(a);
            const mxHere = a.fh >= a.nextCheck && (site.kind === 'MRO' || (!this._mroFrom(site.id) && site.id === this.routes[a.home].a));       // no hub reachable: checked on the pad at its own base
            if (mxHere) { this._book(a.scn, site.id, null, 'mx', 1); this._hist(a, { k: 'M', t: this.t, s: site.id }); pad.step = 'MAINT'; pad.t = 0; pad.dur = site.kind === 'MRO' ? MX.basicDurS : 2700; this._log('MX', a.scn, a.cs + ' basic check opened at ' + site.name + ' · ' + a.fh.toFixed(0) + ' FH', a.cs); break; }
            pad.step = 'POD_OUT'; pad.t = 0; pad.dur = a.pod ? vary(T.POD_OUT) : 20;
            if (site.def.refuel && site.bowsers.length) { pad.fuel = 'WAIT'; const b = site.bowsers.find(b => b.lanePads.includes(pad.i)) || site.bowsers[0]; b.queue.push(pad.i); }
            else pad.fuel = 'NA';
          }
          break;
        case 'MAINT':
          if (pad.t >= pad.dur) {
            a.nextCheck = Math.ceil((a.fh + 0.01) / MX.basicFh) * MX.basicFh; this._hist(a, { k: 'X', t: this.t, s: site.id });
            this._log('MX', a.scn, a.cs + ' basic check closed · next at ' + a.nextCheck + ' FH · returned to roster', a.cs);
            pad.step = 'POD_OUT'; pad.t = 0; pad.dur = 15;
            if (site.def.refuel && site.bowsers.length) { pad.fuel = 'WAIT'; (site.bowsers.find(b => b.lanePads.includes(pad.i)) || site.bowsers[0]).queue.push(pad.i); }
          }
          break;
        case 'POD_OUT':
          if (pad.t >= pad.dur) {
            this._deliver(a, site);
            if (this._wantsRest(a, site) && this._standDown(a, site, pad)) continue;
            this._planNext(a, site);
            pad.step = 'POD_IN'; pad.t = 0; pad.dur = a.pod ? vary(T.POD_IN) : 25;
          }
          break;
        case 'POD_IN':
          if (a.pod && a.pod.type === 'COLD') a.pod.tempC += (a.pod.setC - 0.6 - a.pod.tempC) * dt / 240;
          if (pad.t >= pad.dur) {
            if (a.pod) { a.pod.sealed = true; if (a.req) a.req.state = 'SEALED'; this._log('GROUND', a.scn, a.pod.id + ' sealed on ' + a.cs + ' · ' + a.pod.kg + ' kg ' + POD_TYPES[a.pod.type].label + ' · manifest verified', a.cs); }
            pad.step = 'FUELWAIT'; pad.t = 0; pad.dur = 0;
          }
          break;
        case 'FUELWAIT':
          if (pad.fuel === 'DONE' || pad.fuel === 'NA') { pad.step = 'PREFLIGHT'; pad.t = 0; pad.dur = vary(T.PREFLIGHT); }
          break;
        case 'PREFLIGHT':
          if (pad.t >= pad.dur) { pad.step = 'RELEASE'; pad.t = 0; pad.dur = site.kind === 'BASE' ? 20 + this.rnd() * 70 : 15 + this.rnd() * 100; pad.why = ''; }   // the base holds for its outbound wave
          break;
        case 'RELEASE':
          a.rpm = Math.min(1, a.rpm + dt * 0.05);                      // rotors run up while the release is pending
          if (site.def.refuel && a.soc < 55) { pad.why = 'CHARGING'; break; }                // short hops drain the battery in hover: top up before release
          if (pad.t >= pad.dur) this._tryRelease(a, site, pad);
          break;
      }
      if (site.def.refuel && a.soc < 96) a.soc = Math.min(96, a.soc + dt * 0.1);          // fast charger on every refuelling pad
      this._lockToPad(a, site, pad);
    }
  }
  _stepDock(site, dt) {
    const D = site.dock, moving = D.st.some(s => s.state === 'V_IN' || s.state === 'V_OUT');
    // trucks keep arriving with pallets for the network, in step with demand: a few an hour at night, many at the peak
    D.acc += dt * D.rate * demandLevel(this.t, site.scn) * laneFactor(dayOf(this.t), site.id) / 3600;
    while (D.acc >= 1) { D.acc -= 1; D.trucks++; if (D.qBuild < 6) D.qBuild++; }
    for (const s of D.st) {
      s.t += dt;
      if (s.state === 'IDLE') {
        if (s.t < s.dur || moving) continue;                       // one vehicle on the yard lanes at a time
        if (D.qBreak.length && (D.need === 0 || D.qBreak.length > 2 || this.rnd() < 0.5)) { s.job = 'BREAK'; const j = D.qBreak.shift(); s.type = j.type; s.kg = j.kg; s.peer = j.from; s.cs = j.cs; }
        else if ((D.qBuild > 0 || D.need > 0) && D.staged.length < D.cap) { s.job = 'BUILD'; if (D.qBuild > 0) D.qBuild--; if (D.need > 0) D.need--; s.type = this._cargo(this.scn[site.scn].def, null)[0];
          const ld = this._podLoad(site.scn, site.id, site.kind === 'BASE'); s.kg = ld.kg; s.n = ld.n; s.peer = null; s.cs = null; }
        else continue;
        s.state = 'V_IN'; s.t = 0; s.dur = DOCK.vIn; s.k = 0; s.veh = Math.floor(this.rnd() * 6);
        this._log('GROUND', site.scn, (s.job === 'BUILD' ? 'Light truck at ' + site.id + ' gate · ' + POD.pallets + ' pallets ' + POD_TYPES[s.type].label + ' for loading bay L' + (s.i + 1) : 'Empty truck called to ' + site.id + ' bay L' + (s.i + 1) + ' · collecting ' + POD.pallets + ' pallets ' + POD_TYPES[s.type].label));
        return;
      } else if (s.t >= s.dur) {
        if (s.state === 'V_IN') { s.state = 'MOVE'; s.t = 0; s.dur = DOCK.move; }
        else if (s.state === 'MOVE') {
          s.k++; D.pallets++;
          if (s.k < POD.pallets) { s.t = 0; }
          else { s.state = 'V_OUT'; s.t = 0; s.dur = DOCK.vOut;
            const mv = { t: this.t, i: s.i, dir: s.job === 'BUILD' ? 'OUT' : 'IN', type: s.type, kg: s.kg, peer: s.peer, cs: s.cs };
            D.moves.push(mv); if (D.moves.length > 16) D.moves.shift();
            if (s.job === 'BUILD') { D.built++; tally(s.fout, s.type, s.kg); D.staged.push({ type: s.type, kg: s.kg, n: s.n || 1, st: s.i, mv }); if (D.staged.length > D.cap) D.staged.shift();
              this._log('GROUND', site.scn, 'Pod loaded at ' + site.id + ' bay L' + (s.i + 1) + ' · ' + POD.pallets + ' pallets ' + POD_TYPES[s.type].label + ' · ' + s.kg + ' kg · door closed · to staging'); }
            else { D.broken++; tally(s.fin, s.type, s.kg); if (s.peer) lane(s.fin, s.peer, s.kg);
              this._log('GROUND', site.scn, 'Pod unloaded at ' + site.id + ' bay L' + (s.i + 1) + ' · ' + POD.pallets + ' pallets ' + POD_TYPES[s.type].label + ' · ' + s.kg + ' kg from ' + (s.peer || '—') + ' · released to road'); } }
        }
        else if (s.state === 'V_OUT') { s.state = 'IDLE'; s.t = 0; s.dur = (D.qBreak.length || D.qBuild || D.need) ? 6 + this.rnd() * 14 : 20 + this.rnd() * 70; s.job = null; }
      }
    }
  }
  _mroFrom(siteId) { for (const id in this.routes) { const r = this.routes[id]; if (r.mro && r.a === siteId) return r; } return null; }
  _stepBowser(site, b, dt) {
    const V = 3.2;
    const goto = (x) => { const d = x - b.x; if (Math.abs(d) <= V * dt) { b.x = x; return true; } b.dir = Math.sign(d); b.x += b.dir * V * dt; return false; };
    switch (b.state) {
      case 'IDLE': if (b.queue.length) { b.pad = b.queue.shift(); b.state = 'TO_PAD'; } break;
      case 'TO_PAD': if (goto(site.pads[b.pad].x + 3.2)) { b.state = 'FUELLING'; b.t = 0; site.pads[b.pad].fuel = 'FUELLING'; } break;
      case 'FUELLING': {
        b.t += dt; const pad = site.pads[b.pad], a = this.byCs[pad.cs];
        if (a) a.fuel = Math.min(100, a.fuel + dt * 100 / TURN.land.FUEL * 0.9);
        if (b.t >= TURN.land.FUEL || (a && a.fuel >= 100)) { pad.fuel = 'DONE'; if (a) a.fuel = 100; b.pad = -1; b.state = b.queue.length ? 'IDLE' : 'RETURN'; }
        break;
      }
      case 'RETURN': if (b.queue.length) { b.state = 'IDLE'; break; } if (goto(b.home)) b.state = 'IDLE'; break;
    }
  }
  _deliver(a, site) {
    const S = this.scn[a.scn];
    if (a.pod && a.req) {
      a.req.state = 'DELIVERED'; a.req.tDel = this.t;
      S.kpi.kg += a.pod.kg;
      const from = this.sites[a.from], km = distKm(from.lat, from.lon, site.lat, site.lon), wet = isWet(a.pod.type), rate = wet ? TARIFF.WET : TARIFF.DRY, kg = a.pod.kg, sortie = TARIFF.SORTIE[a.scn], rev = sortie != null ? sortie : kg * km * rate;
      a.req.km = km; a.req.rev = rev; { const L = this._lastLeg(a); if (L && L.to === site.id) L.rev = Math.round(rev); }
      const bk = (sid, k, v) => this._book(a.scn, sid, null, k, v), rid = a.route;
      this._book(a.scn, null, rid, 'rev', rev); if (sortie != null) this._book(a.scn, null, rid, 'revSortie', rev); this._book(a.scn, null, rid, wet ? 'revWet' : 'revDry', rev); this._book(a.scn, null, rid, 'kg', kg); this._book(a.scn, null, rid, wet ? 'kgWet' : 'kgDry', kg);
      this._book(a.scn, null, rid, 'tkm', kg / 1000 * km); this._book(a.scn, null, rid, 'pods', 1); this._book(a.scn, null, rid, 'cons', a.pod.n || 1);
      bk(from.id, 'revOut', rev); bk(site.id, 'revIn', rev); bk(site.id, 'podsIn', 1); bk(site.id, 'kgIn', kg); bk(site.id, wet ? 'wetIn' : 'dryIn', kg);
      if (site.dock) { site.dock.qBreak.push({ type: a.pod.type, kg: a.pod.kg, from: a.from, cs: a.cs }); site.dock.qMax = Math.max(site.dock.qMax, site.dock.qBreak.length); }          // its two pallets go out by road
      this._log('GROUND', a.scn, a.pod.id + ' opened at ' + site.name + ' · chain of custody closed · ' + a.pod.kg + ' kg', a.cs);
    }
    a.pod = null; a.req = null;
  }
  _planNext(a, site) {
    const mro = this._mroFrom(site.id);
    let R, dir;
    const toward = a.restNext ? Object.values(this.routes).find(r => (r.a === site.id && r.b === a.restNext) || (r.b === site.id && r.a === a.restNext)) : null;
    if (toward) { R = toward; dir = site.id === R.a ? 1 : -1; }                      // last leg of the duty: to where it can stand down
    else if (site.kind === 'MRO') { R = this.routes[a.route]; dir = -1; }                  // back to the base it was ferried from
    else if (mro && a.fh >= a.nextCheck && this.aircraft.filter(x => x.cs !== a.cs && x.phase !== 'STANDBY' && x.route && this.routes[x.route].mro && this.routes[x.route].b === mro.b).length < 3) {
      R = mro; dir = 1;
      this._log('MX', a.scn, a.cs + ' at ' + a.fh.toFixed(0) + ' FH · withdrawn from roster · ferry to ' + this.sites[R.b].name, a.cs);
    } else {
      R = this.routes[a.home];
      if (R.a !== site.id && R.b !== site.id) {                                  // stood down away from its own corridor: rostered onto one from here
        const own = Object.values(this.routes).filter(r => !r.mro && r.scn === a.scn && (r.a === site.id || r.b === site.id));
        R = own.find(r => r.a === this.routes[a.home].a || r.b === this.routes[a.home].a) || own[0] || R;
        if (R.a === site.id || R.b === site.id) a.home = R.id;
      }
      if (site.kind === 'BASE' && R.a === site.id && !a.restNext) R = this._rebalance(a, site, R);
      dir = site.id === R.a ? 1 : -1;
    }
    a.route = R.id; a.dir = dir; a.from = dir > 0 ? R.a : R.b; a.to = dir > 0 ? R.b : R.a;
    this._loadPod(a, a.from, a.to, false);
    if (a.req) this._log('ROSTER', a.scn, a.req.id + ' matched to ' + a.cs + ' · ' + a.from + ' → ' + a.to + ' · ' + a.req.kg + ' kg ' + POD_TYPES[a.req.type].label, a.cs);
  }
  /* demand-driven roster: at its base an airframe moves to the corridor whose cargo today most outweighs the aircraft working it */
  _rebalance(a, site, R) {
    const day = dayOf(this.t), cand = Object.values(this.routes).filter(r => r.a === site.id && !r.mro && r.scn === a.scn); if (cand.length < 2) return R;
    const cnt = {}; for (const x of this.aircraft) if (x.scn === a.scn && x.phase !== 'REST' && x.phase !== 'STANDBY' && x.home) cnt[x.home] = (cnt[x.home] || 0) + 1;
    const score = r => r.n * laneFactor(day, r.b) / Math.max(0.5, cnt[r.id] || 0);
    let best = R; for (const r of cand) if ((cnt[r.id] || 0) < r.n * 1.6 + 1 && score(r) > score(best)) best = r;
    if (best === R || score(best) < score(R) * 1.3 || (cnt[R.id] || 0) <= 1) return R;
    a.home = best.id;
    if (this.rnd() < 0.35) this._log('ROSTER', a.scn, a.cs + ' moved from ' + R.id + ' to ' + best.id + ' · more cargo waiting for ' + this.sites[best.b].name + ' today', a.cs);
    return best;
  }
  _tryRelease(a, site, pad) {
    const S = this.scn[a.scn], R = this.routes[a.route], key = R.id + a.dir;
    // low visibility: land sites keep flying, but one release at a time with five minutes between them
    if (this.wx === 'FOG' && site.kind !== 'PLATFORM' && site.kind !== 'SHIP' && site.lastRel && this.t - site.lastRel < 300) { pad.why = 'LOW-VISIBILITY SPACING'; return; }
    if (S.lastRel[key] && this.t - S.lastRel[key] < 100) { pad.why = 'TRAIL SEPARATION'; return; }
    // lowest free level in this direction: 200 ft between opposite directions, 400 ft within a stack of three.
    // Each base owns a 1,200 ft band, so corridors of different bases never share a level where they cross.
    const base = R.baseFt + (a.dir > 0 ? 0 : 200);
    let lvl = base;
    for (; lvl <= base + 800; lvl += 400) {
      const busy = this.aircraft.some(x => x !== a && x.route === R.id && x.dir === a.dir && AIRBORNE[x.phase] && x.levelFt === lvl && (x.total - x.rem) < 28);
      if (!busy) break;
    }
    if (lvl > base + 800) { pad.why = 'LEVELS OCCUPIED'; return; }
    if (!this._assignPilot(a)) { pad.why = 'NO SUPERVISORY CAPACITY'; return; }
    pad.why = '';
    S.lastRel[key] = this.t; site.lastRel = this.t;
    a.levelFt = lvl;
    a.wps = this._legWps(R, a.dir, null); a.wpi = 0;
    a.total = this._legKm(R, a.dir); a.rem = a.total; a.plannedS = this._planS(a.total);
    a.handoffs = 0; a.pt = {}; a.phase = 'LIFT'; a.pt.LIFT = this.t; a.tPhase = 0; a.tDep = this.t; a.trail = []; a.desc = null; a.hold = null; a.resv = null;
    pad.step = 'DEPARTING';
    this._hist(a, { k: 'L', t: this.t, f: site.id, to: a.to, r: R.id, p: pad.id, kg: a.pod ? a.pod.kg : 0, ty: a.pod ? a.pod.type : null, pod: a.pod ? a.pod.id : null, mro: R.mro ? 1 : 0, lvl: a.levelFt });
    this._book(a.scn, site.id, R.id, 'dep', 1); if (a.pod) { this._book(a.scn, site.id, null, 'podsOut', 1); this._book(a.scn, site.id, null, 'kgOut', a.pod.kg); this._book(a.scn, site.id, null, isWet(a.pod.type) ? 'wetOut' : 'dryOut', a.pod.kg); }
    if (a.req) { a.req.state = 'AIRBORNE'; a.req.tDep = this.t; }
    const pn = S.pilots.find(p => p.id === a.pilot);
    this._log('AIR', a.scn, a.cs + ' released ' + site.id + ' ' + pad.id + ' · ' + R.id + ' · ' + fmtInt(a.levelFt) + ' ft · ' + (pn ? pn.name : ''), a.cs);
  }

  /* ----- flight ----- */
  _nav(a, dt, speedMs, free) {
    const w = this._resolve(a.wps[a.wpi]);
    const dKm = distKm(a.lat, a.lon, w.lat, w.lon), want = bearing(a.lat, a.lon, w.lat, w.lon);
    const v = Math.max(speedMs, 0.01);
    const rate = free ? 40 : Math.min(18, 9.81 * Math.tan(L560.bankDeg * DEG) / Math.max(v, 12) / DEG);
    const dh = wrap180(want - a.hdg), turn = clamp(dh, -rate * dt, rate * dt);
    a.hdg = wrap360(a.hdg + turn); a.bank = clamp(turn / (rate * dt || 1), -1, 1) * (free ? 0 : 1);
    const step = v * dt / 1000;
    if (a.wpi === a.wps.length - 1 && step >= dKm) { a.lat = w.lat; a.lon = w.lon; return 0; }
    const ll = moveLL(a.lat, a.lon, a.hdg, step); a.lat = ll[0]; a.lon = ll[1];
    if (a.wpi < a.wps.length - 1) {
      const R = v / (rate * DEG) / 1000;                        // turn radius, km
      if (dKm < Math.max(0.12, R * 0.95)) a.wpi++;
    }
    return dKm;
  }
  _reserve(a) {
    const site = this.sites[a.to];
    if (a.phase !== 'HOLD') { for (const x of this.aircraft) if (x !== a && x.phase === 'HOLD' && x.to === site.id && x.resv == null) return false; }   // first come, first served: join the hold
    else { for (const x of this.aircraft) if (x !== a && x.phase === 'HOLD' && x.to === site.id && x.resv == null && x.pt.HOLD < a.pt.HOLD) return false; }
    const pad = site.pads.find(p => p.state === 'FREE');
    if (!pad) return false;
    pad.state = 'RESERVED'; pad.cs = a.cs; a.resv = pad.i;
    for (const w of a.wps) if (w.site === site.id) { w.pad = pad.i; w._c = false; }
    a._sfxI = -1;
    return true;
  }
  _stepAircraft(a, dt) {
    const ph = a.phase;
    if (ph === 'STANDBY' || ph === 'REST') { a.rpm = 0; return; }
    if (ph === 'GROUND') return;
    const vT = L560.transSpeedMs, vC = L560.cruiseKmh / 3.6, hov = L560.hoverAltM, S = this.scn[a.scn];
    const from = this.sites[a.from], to = this.sites[a.to];
    a.tPhase += dt; a.fh += dt / 3600; a.duty += dt / 3600; a.rpm = 1; this._fh[a.scn] = (this._fh[a.scn] || 0) + dt / 3600; if (a.route) this._fhR[a.route] = (this._fhR[a.route] || 0) + dt / 3600;
    const prevAlt = a.alt, plat = a.lat, plon = a.lon;
    switch (ph) {
      case 'LIFT': {
        const pad = from.pads.find(p => p.cs === a.cs) || from.pads[0];
        const ll = this.localToLL(from, pad.x, pad.z); a.lat = ll[0]; a.lon = ll[1];
        a.alt = Math.min(hov, a.alt + L560.liftMs * dt * (a.alt < 4 ? 0.6 : 1)); a.tilt = 90; a.gs = from.speedMs;
        const w = this._resolve(a.wps[0]), want = bearing(a.lat, a.lon, w.lat, w.lon);
        if (a.alt > 6) a.hdg = wrap360(a.hdg + clamp(wrap180(want - a.hdg), -14 * dt, 14 * dt));
        a.soc -= dt * 0.20;
        if (a.alt >= hov && Math.abs(wrap180(want - a.hdg)) < 4) { a.phase = 'TRANS_OUT'; a.pt.TRANS_OUT = this.t; a.tPhase = 0; a.vrel = 0; a.gen = 'ON'; }
        break;
      }
      case 'TRANS_OUT': {
        a.vrel = Math.min(vT, a.vrel + vT / L560.transOutS * dt);
        const k = a.vrel / vT;
        a.tilt = 90 * (1 - smooth(k)); a.alt += 0.9 * dt;
        this._nav(a, dt, a.vrel, k < 0.4);
        if (from.moving) { const f = 1 - k, ll = moveLL(a.lat, a.lon, from.rot, from.speedMs * f * dt / 1000); a.lat = ll[0]; a.lon = ll[1]; }
        a.gs = a.vrel + from.speedMs * (1 - k);
        a.soc -= dt * 0.20 * (1 - k * 0.8);
        const pad = from.pads.find(p => p.cs === a.cs);
        if (pad && a.vrel > 9) { pad.state = 'FREE'; pad.cs = null; pad.step = null; pad.fuel = 'NA'; }
        if (k >= 1) { a.phase = 'CLIMB'; a.pt.CLIMB = this.t; a.tPhase = 0; if (pad) { pad.state = 'FREE'; pad.cs = null; pad.step = null; } }
        break;
      }
      case 'CLIMB': {
        a.gs = Math.min(vC, a.gs + L560.accelMs2 * dt); a.tilt = 0;
        a.alt = Math.min(a.levelFt * FT, a.alt + L560.climbMs * dt);
        this._nav(a, dt, a.gs);
        if (a.alt >= a.levelFt * FT - 0.5 && a.gs >= vC - 0.1) { a.phase = 'CRUISE'; a.pt.CRUISE = this.t; a.tPhase = 0; }
        this._checkTOD(a);
        break;
      }
      case 'CRUISE': {
        a.gs = vC; a.tilt = 0; a.alt = a.levelFt * FT;
        this._nav(a, dt, a.gs);
        if (a.soc < 96) a.soc = Math.min(96, a.soc + dt * 0.012);
        this._checkTOD(a);
        break;
      }
      case 'DESCENT': {
        const d = a.desc, remM = a.rem * 1000;
        if (d.then === 'HOLD' && this._reserve(a)) {                 // a pad freed on the way down: continue straight in
          a.desc = { alt0: a.alt, gs0: a.gs, d0: Math.max(remM, this.dTI + 50), alt: hov, gs: vT, dEnd: this.dTI, then: 'TRANS_IN' };
          this._log('AIR', a.scn, a.cs + ' pad ' + to.pads[a.resv].id + ' confirmed at ' + to.id + ' · hold cancelled', a.cs);
          break;
        }
        const u = clamp01((remM - d.dEnd) / Math.max(1, d.d0 - d.dEnd));
        a.alt = d.alt + (d.alt0 - d.alt) * smooth(u); a.gs = d.gs + (d.gs0 - d.gs) * u; a.tilt = 0;
        this._nav(a, dt, a.gs);
        if (remM <= d.dEnd) {
          if (d.then === 'HOLD') {
            a.phase = 'HOLD'; a.pt.HOLD = this.t; a.tPhase = 0; S.kpi.holds++; this._book(a.scn, to.id, a.route, 'holds', 1);
            const c = moveLL(a.lat, a.lon, a.hdg + 90, CORRIDOR.holdRadiusKm);
            a.hold = { lat: c[0], lon: c[1], ang: wrap360(a.hdg - 90), turns: 0 };
            this._log('AIR', a.scn, a.cs + ' holding ' + CORRIDOR.holdRadiusKm + ' km orbit · ' + to.name + (to.kind === 'SHIP' ? ' deck occupied' : ' has no free pad'), a.cs);
          } else { a.phase = 'TRANS_IN'; a.pt.TRANS_IN = this.t; a.tPhase = 0; a.alt = hov; a.wpi = a.wps.length - 1; }
        }
        break;
      }
      case 'HOLD': {
        const h = a.hold, R = CORRIDOR.holdRadiusKm, w = (a.gs / 1000) / R / DEG * dt;
        h.ang = h.ang + w; if (h.ang >= 360) { h.ang -= 360; h.turns++; }
        const p = moveLL(h.lat, h.lon, h.ang, R); a.lat = p[0]; a.lon = p[1]; a.hdg = wrap360(h.ang + 90); a.bank = 1;
        a.gs = 55; a.alt = 300; a.tilt = 0;
        const tgt = this._resolve(a.wps[a.wps.length - 1]);
        const toward = Math.abs(wrap180(bearing(a.lat, a.lon, tgt.lat, tgt.lon) - a.hdg)) < 25;
        if (toward && (a.resv != null || this._reserve(a))) {
          a.wpi = Math.max(a.wpi, a.wps.length - (to.L.app != null ? 2 : 1));
          const remM = this._remKm(a) * 1000;
          a.desc = { alt0: a.alt, gs0: a.gs, d0: Math.max(remM, this.dTI + 50), alt: hov, gs: vT, dEnd: this.dTI, then: 'TRANS_IN' };
          a.phase = 'DESCENT'; a.pt.DESCENT = this.t; a.tPhase = 0; a.hold = null;
          this._log('AIR', a.scn, a.cs + ' cleared from hold · ' + to.id + ' ' + to.pads[a.resv].id, a.cs);
        }
        break;
      }
      case 'TRANS_IN': {
        const tgt = this._resolve(a.wps[a.wps.length - 1]);
        const remM = distKm(a.lat, a.lon, tgt.lat, tgt.lon) * 1000;
        const k = Math.sqrt(clamp01(remM / this.dTI)), v = Math.max(1.4, vT * k);
        a.tilt = 90 * (1 - smooth(k)); a.alt = hov;
        const left = this._nav(a, dt, v, k < 0.5);
        if (to.moving) { const f = 1 - k, ll = moveLL(a.lat, a.lon, to.rot, to.speedMs * f * dt / 1000); a.lat = ll[0]; a.lon = ll[1]; }
        a.gs = v + to.speedMs * (1 - k);
        a.soc -= dt * 0.20 * (1 - k * 0.8);
        // settle the nose onto the pad heading over the last metres
        const pad = to.pads[a.resv || 0], ph2 = wrap360(pad.hdg + to.rot);
        if (remM < 60) a.hdg = wrap360(a.hdg + clamp(wrap180(ph2 - a.hdg), -16 * dt, 16 * dt));
        if (left === 0 || remM < 0.8) { a.phase = 'LAND'; a.pt.LAND = this.t; a.tPhase = 0; }
        break;
      }
      case 'LAND': {
        const pad = to.pads[a.resv || 0], ll = this.localToLL(to, pad.x, pad.z), ph2 = wrap360(pad.hdg + to.rot);
        a.lat = ll[0]; a.lon = ll[1]; a.gs = to.speedMs; a.tilt = 90;
        a.hdg = wrap360(a.hdg + clamp(wrap180(ph2 - a.hdg), -16 * dt, 16 * dt));
        if (Math.abs(wrap180(ph2 - a.hdg)) < 3 || a.alt < hov - 1) a.alt = Math.max(0, a.alt - (a.alt > 7 ? L560.landMs : 0.75) * dt);
        a.soc -= dt * 0.20;
        if (a.alt <= 0) this._touchdown(a, to, pad);
        break;
      }
    }
    a.vs = (a.alt - prevAlt) / dt;
    if (AIRBORNE[a.phase]) {
      const dk = distKm(plat, plon, a.lat, a.lon);
      a.fuel = Math.max(0, a.fuel - dk * 100 / (L560.rangeKm * (1 + L560.reservePct / 100)));
      S.kpi.kmFlown += dk;
      a.rem = a.phase === 'LAND' ? 0 : this._remKm(a);
      const vAvg = a.phase === 'CRUISE' || a.phase === 'CLIMB' ? vC : Math.max(20, (a.gs + vC) / 2);
      a.eta = a.rem * 1000 / vAvg + (a.phase === 'LAND' ? a.alt / L560.landMs : 55);
      if (a.pod) {
        if (a.pod.type === 'COLD') a.pod.tempC += ((a.pod.setC - 0.4 + Math.sin(this.t / 140 + a.fh) * 0.5) - a.pod.tempC) * dt / 90;
        if (this.rnd() < dt * 0.004) a.pod.shockG = Math.max(a.pod.shockG, 0.3 + this.rnd() * 0.9);
      }
      a.tTrail -= dt;
      if (a.tTrail <= 0) { a.tTrail = 18; a.trail.push(a.lat, a.lon, a.alt); if (a.trail.length > 3 * 110) a.trail.splice(0, 3); }
      a.tC2 -= dt;
      if (a.tC2 <= 0) { a.tC2 = 6; this._c2(a); }
    }
  }
  _checkTOD(a) {
    const vT = L560.transSpeedMs, hov = L560.hoverAltM;
    const tDesc = Math.max(20, (a.alt - hov) / 4), dTOD = this.dTI + tDesc * (a.gs + vT) / 2;
    const remM = a.rem * 1000;
    if (remM > dTOD) return;
    const got = this._reserve(a);
    a.phase = 'DESCENT'; a.pt.DESCENT = this.t; a.tPhase = 0;
    a.desc = got ? { alt0: a.alt, gs0: a.gs, d0: remM, alt: hov, gs: vT, dEnd: this.dTI, then: 'TRANS_IN' }
                 : { alt0: a.alt, gs0: a.gs, d0: remM, alt: 300, gs: 55, dEnd: 3600, then: 'HOLD' };
    if (got) this._log('AIR', a.scn, a.cs + ' top of descent · ' + this.sites[a.to].id + ' ' + this.sites[a.to].pads[a.resv].id + ' reserved', a.cs);
  }
  _touchdown(a, site, pad) {
    const S = this.scn[a.scn], T = site.kind === 'SHIP' || site.kind === 'PLATFORM' ? TURN.deck : TURN.land;
    a.phase = 'GROUND'; a.pt.GROUND = this.t; a.alt = 0; a.vs = 0; a.site = site.id; a.pad = pad.i; a.gen = 'OFF'; a.rem = 0; a.eta = 0; a.legs++;
    pad.state = 'OCCUPIED'; pad.cs = a.cs; pad.step = 'SAFE'; pad.t = 0; pad.dur = T.SAFE; pad.fuel = 'NA';
    const block = this.t - a.tDep;
    S.kpi.sorties++; S.kpi.legs++; S.kpi.blockS += block;
    const late = block > a.plannedS + 300; if (!late) S.kpi.onTime++;
    const R0 = this.routes[a.route];
    this._book(a.scn, site.id, R0.id, 'arr', 1);
    if (!R0.mro) { this._book(a.scn, null, R0.id, 'legs', 1); this._book(a.scn, null, R0.id, 'capKg', L560.payloadKg); if (!a.pod) this._book(a.scn, null, R0.id, 'empty', 1); if (late) this._book(a.scn, null, R0.id, 'late', 1); }
    if (a.req) a.req.late = late;
    a.lastBlock = block; a.resv = null; a.gcs = null;
    { const L = this._lastLeg(a); if (L && L.to === site.id && !L.a) { L.a = this.t; L.tp = pad.id; L.bl = Math.round(block); L.late = late ? 1 : 0; L.km = Math.round(a.total); } }
    this._log('AIR', a.scn, a.cs + ' touchdown ' + site.id + ' ' + pad.id + ' · block ' + fmtDur(block) + ' · ' + Math.round(a.total) + ' km', a.cs);
  }
  _c2(a) {
    const R = this.routes[a.route]; let best = null, bd = 1e9, cur = null, cd = 1e9, second = 1e9;
    for (const g of R.gcs) {
      let lat = g.lat, lon = g.lon;
      if (g.end) { const s = this.sites[g.end === 'a' ? R.a : R.b]; lat = s.lat; lon = s.lon; }
      const d = distKm(a.lat, a.lon, lat, lon);
      if (d < bd) { second = bd; bd = d; best = g; } else if (d < second) second = d;
      if (g.name === a.gcs) { cur = g; cd = d; }
    }
    if (cur && cd - bd < C2.hystKm) { best = cur; bd = cd; }                 // stay on the serving station until another is clearly nearer
    const link = bd <= C2.satKm ? 'GROUND' : 'SATCOM';
    if (best && a.gcs && link !== a.link && a.phase === 'CRUISE') {
      this._log('C2', a.scn, link === 'SATCOM' ? a.cs + ' beyond ground network · SATCOM backup carrying critical commands' : a.cs + ' ground network restored via ' + best.name, a.cs);
    }
    if (best && a.gcs && best.name !== a.gcs && link === 'GROUND') { a.handoffs = (a.handoffs || 0) + 1; if (a.phase === 'CRUISE' && this.rnd() < 0.25) this._log('C2', a.scn, a.cs + ' C2 handoff ' + a.gcs.split(' · ').pop() + ' → ' + best.name.split(' · ').pop() + ' · ' + R.id, a.cs); }
    a.gcs = best ? best.name : null; a.link = link; a.c2km = bd; a.c2rssi = Math.round(-52 - 20 * Math.log10(Math.max(1, bd))); a.c2alt = second < 1e8 ? second : null;
  }
  /* ---------- ledger ---------- */
  _ledger() {
    const day = Math.floor((this.t - 6 * 3600) / 86400), L = this.led;
    if (!L || L.day !== day) {
      if (L) { this._closeHour(true); this._closeDay(L); }
      this.led = { day, t0: 6 * 3600 + day * 86400, h: 0, tot: ledRec(), scn: {}, site: {}, route: {}, hours: [{ tot: ledRec(), scn: {}, site: {} }] };
      return;
    }
    const h = Math.floor((this.t - L.t0) / 3600);
    if (h !== L.h) { this._closeHour(false); L.h = h; L.hours[h] = { tot: ledRec(), scn: {}, site: {} }; }
  }
  /* add v to field k on every record the event belongs to: day and hour totals, its business line, and optionally a site and a route */
  _book(scn, siteId, routeId, k, v) {
    const L = this.led; if (!L) return; const H = L.hours[L.h];
    L.tot[k] += v; H.tot[k] += v; (L.scn[scn] || (L.scn[scn] = ledRec()))[k] += v; (H.scn[scn] || (H.scn[scn] = ledRec()))[k] += v;
    if (siteId) { (L.site[siteId] || (L.site[siteId] = ledRec()))[k] += v; (H.site[siteId] || (H.site[siteId] = ledRec()))[k] += v; }
    if (routeId) (L.route[routeId] || (L.route[routeId] = ledRec()))[k] += v;
  }
  _closeHour(final) {
    const L = this.led, H = L.hours[L.h]; if (!H) return;
    const t0 = L.t0 + L.h * 3600, win = fmtClock(t0) + '–' + fmtClock(t0 + 3600);
    for (const id in H.site) {
      const r = H.site[id], S = this.sites[id]; if (!S || !(r.dep || r.arr || r.podsIn || r.podsOut)) continue;
      const notes = [r.holds ? r.holds + (r.holds === 1 ? ' hold' : ' holds') : '', r.mx ? r.mx + ' check' + (r.mx > 1 ? 's' : '') + ' opened' : '', r.down ? r.down + ' stood down' : ''].filter(Boolean).join(' · ');
      this.biz.push({ t: t0 + 3600, day: L.day, kind: 'HUB', scn: S.scn, site: id, win, r: { ...r }, notes });
    }
    for (const scn in H.scn) { const r = H.scn[scn]; if (!(r.dep || r.arr)) continue; this.biz.push({ t: t0 + 3600, day: L.day, kind: 'LINE', scn, site: null, win, r: { ...r }, notes: '' }); }
    if (this.biz.length > 1000) this.biz.splice(0, this.biz.length - 1000);
  }
  _closeDay(L) {
    this.days.push({ day: L.day, t0: L.t0, tot: { ...L.tot }, scn: JSON.parse(JSON.stringify(L.scn)), site: JSON.parse(JSON.stringify(L.site)), route: JSON.parse(JSON.stringify(L.route)), fleet: this.aircraft.length,
      df: Object.fromEntries(SCENARIOS.map(sc => [sc.id, +dayFactor(L.day + 1, sc.id).toFixed(3)])) });
    if (this.days.length > 60) this.days.shift();
    for (let i = 0; i < this.days.length - 1; i++) { delete this.days[i].site; delete this.days[i].route; }          // hub and corridor detail only until archived; the archive keeps it for good
    this.biz.push({ t: L.t0 + 86400, day: L.day, kind: 'DAY', scn: null, site: null, win: 'Day ' + (L.day + 1), r: { ...L.tot }, notes: '' });
  }
  /* ----- roster: stand-downs follow demand, rest happens where the last leg ended ----- */
  _active(scn) {
    let n = 0, fl = 0; for (const a of this.aircraft) { if (a.scn !== scn || a.phase === 'STANDBY') continue; fl++; if (a.phase !== 'REST' && !(a.phase === 'GROUND' && a.site && this.sites[a.site].pads[a.pad] && this.sites[a.site].pads[a.pad].step === 'MAINT')) n++; }
    return { n, fl, want: Math.round(rosterLevel(this.t, scn) * fl) };
  }
  restCap(site) { const L = site.L; return { hangar: site.def.hangar != null ? site.def.hangar : L.hangar || 0, stands: site.stands.length }; }
  restHere(site) { return (site.rest || []).map(cs => this.byCs[cs]); }
  _hist(a, ev) { (a.hist || (a.hist = [])).push(ev); if (a.hist.length > 140) a.hist.splice(0, a.hist.length - 140); }
  _lastLeg(a) { const h = a.hist || []; for (let i = h.length - 1; i >= 0; i--) if (h[i].k === 'L') return h[i]; return null; }
  _wantsRest(a, site) {
    if (a.restNext === site.id) return true;                                  // flew here to stand down
    if (site.kind === 'SHIP' || site.kind === 'PLATFORM' || site.kind === 'MRO') return false;
    if (a.duty >= DUTY.maxFh) return true;
    if (a.duty < DUTY.minDutyFh) return false;
    const A = this._active(a.scn), surplus = A.n - A.want;
    return surplus > 0 && this.rnd() < clamp(surplus / Math.max(4, 0.1 * A.fl), 0.2, 1);
  }
  /* where an airframe could stand down here: a hangar slot, a stand, or (at a warehouse) its pad while another pad stays free */
  _restSlot(site, pad) {
    const cap = this.restCap(site), here = this.restHere(site);
    if (here.filter(x => x.restAt === 'HANGAR').length < cap.hangar) return { where: 'HANGAR' };
    const st = site.stands.findIndex(s => !s.cs); if (st >= 0) return { where: 'STAND', stand: st };
    const hod = hodOf(this.t, site.scn);
    if (site.kind === 'DC' && pad && (hod >= 20.5 || hod < 5)) {                // pads only overnight
      const freeOther = site.pads.filter(p => p !== pad && p.state === 'FREE').length, onPads = here.filter(x => x.restAt === 'PAD').length; if (freeOther >= 1 && onPads < site.pads.length - 1) return { where: 'PAD' }; }
    return null;
  }
  /* nearest site one corridor away that can take it overnight */
  _restTarget(a, site) {
    let best = null, bd = 1e9;
    for (const id in this.routes) {
      const r = this.routes[id]; if (r.scn !== a.scn || (r.a !== site.id && r.b !== site.id)) continue;
      const o = this.sites[r.a === site.id ? r.b : r.a]; if (o.kind === 'SHIP' || o.kind === 'PLATFORM') continue;
      const cap = this.restCap(o), here = this.restHere(o), pending = this.aircraft.filter(x => x.restNext === o.id).length;
      const room = Math.max(0, cap.hangar - here.filter(x => x.restAt === 'HANGAR').length) + o.stands.filter(s => !s.cs).length - pending;
      if (room > 0 && r.km < bd) { bd = r.km; best = o.id; }
    }
    return best;
  }
  _standDown(a, site, pad) {
    // a check within mxWindowFh: if the MRO hub is next door, its last leg is the short ferry there and the check is done overnight
    const mroR = this._mroFrom(site.id);
    if (site.kind === 'BASE' && mroR && mroR.km <= DUTY.mroNearKm && a.restNext !== site.id && a.nextCheck - a.fh <= DUTY.mxWindowFh) {
      const M = this.sites[mroR.b], used = this.restHere(M).filter(x => x.restAt === 'HANGAR').length + this.aircraft.filter(x => x.restNext === M.id).length;
      if (used < this.restCap(M).hangar) { a.restNext = M.id; this._log('MX', a.scn, a.cs + ' ' + Math.max(0, a.nextCheck - a.fh).toFixed(0) + ' FH to its basic check · pulled forward · ferry to ' + M.name + ' for the night', a.cs); return false; }
    }
    // evening: keep each outstation's parking slot filled so its first wave can leave from there in the morning
    const hod = hodOf(this.t, a.scn);
    if (site.kind === 'BASE' && !a.restNext && hod >= 17 && hod < 23.5) {
      const out = Object.values(this.routes).filter(r => !r.mro && r.scn === a.scn && r.a === site.id && this.sites[r.b].kind === 'DC').map(r => this.sites[r.b])
        .filter(D => D.stands.some(s => !s.cs) && !(D.rest || []).length && !this.aircraft.some(x => x.restNext === D.id));
      if (out.length) { const D = out[Math.floor(this.rnd() * out.length)]; a.restNext = D.id; this._log('ROSTER', a.scn, a.cs + ' last leg of the day to ' + D.name + ' · night stop for the first wave out', a.cs); return false; }
    }
    const slot = this._restSlot(site, pad);
    if (!slot) {                                                              // no room here: the next leg is its last of the duty
      if (!a.restNext || a.restNext === site.id) { const t = this._restTarget(a, site); if (t) { a.restNext = t; this._log('ROSTER', a.scn, a.cs + ' no overnight space at ' + site.name + ' · last leg to ' + this.sites[t].name + ' to stand down', a.cs); } else a.restNext = null; }
      return false;
    }
    a.restNext = null;
    if (slot.where !== 'PAD') { pad.state = 'FREE'; pad.cs = null; pad.step = null; pad.fuel = 'NA'; }
    else { pad.step = 'REST'; pad.t = 0; pad.dur = 0; pad.fuel = 'NA'; }
    for (const b of site.bowsers) b.queue = b.queue.filter(i => i !== pad.i);
    a.phase = 'REST'; a.pt = { REST: this.t }; a.site = site.id; a.restAt = slot.where; a.tRest = this.t; a.rpm = 0; a.pod = null; a.req = null; a.gs = 0; a.tilt = 90; a.mxUntil = 0;
    if (slot.where === 'STAND') { a.stand = slot.stand; site.stands[slot.stand].cs = a.cs; a.pad = -1; this._lockToStand(a, site); }
    else if (slot.where === 'PAD') { a.stand = -1; this._lockToPad(a, site, pad); }
    else { a.stand = -1; a.pad = -1; }
    (site.rest || (site.rest = [])).push(a.cs);
    this._book(a.scn, site.id, null, 'down', 1);
    this._hist(a, { k: 'S', t: this.t, s: site.id, w: slot.where });
    // a check coming due is done while it stands down, in the base line hangar or the MRO hub
    const mx = slot.where === 'HANGAR' && a.nextCheck - a.fh <= DUTY.mxWindowFh;
    if (mx) { this._hist(a, { k: 'M', t: this.t, s: site.id }); a.mxUntil = this.t + (site.kind === 'MRO' ? MX.basicDurS : DUTY.lineCheckS) * (0.9 + this.rnd() * 0.25); this._book(a.scn, site.id, null, 'mx', 1); }
    this._log(mx ? 'MX' : 'ROSTER', a.scn, a.cs + ' stood down at ' + site.name + ' · ' + ({ HANGAR: site.kind === 'MRO' ? 'MRO hangar' : 'line hangar', STAND: 'stand S' + ((slot.stand || 0) + 1), PAD: 'pad ' + pad.id }[slot.where]) + ' · ' + a.duty.toFixed(1) + ' FH on duty' + (mx ? ' · basic check opened at ' + a.fh.toFixed(0) + ' FH' : ' · daily inspection'), a.cs);
    return true;
  }
  _fromRest(site) {
    if (!site.rest || !site.rest.length) return;
    const q = Math.floor(this.t / 5); if (site._frQ === q) return; site._frQ = q;          // looked at every five seconds
    for (const a of this.restHere(site)) if (a.mxUntil && this.t >= a.mxUntil) {     // check signed off
      a.mxUntil = 0; a.nextCheck = Math.ceil((a.fh + 0.01) / MX.basicFh) * MX.basicFh; this._hist(a, { k: 'X', t: this.t, s: site.id });
      this._log('MX', a.scn, a.cs + ' basic check closed at ' + site.name + ' · next at ' + a.nextCheck + ' FH', a.cs);
    }
    const ready = this.restHere(site).filter(x => !x.mxUntil && this.t - x.tRest >= DUTY.minRestS).sort((p, q) => (p.restAt === 'PAD' ? -1 : 0) - (q.restAt === 'PAD' ? -1 : 0) || p.tRest - q.tRest);
    if (!ready.length) return;
    const hod = hodOf(this.t, site.scn), padDay = ready[0].restAt === 'PAD' && hod >= 5.5 && hod < 22;   // a warehouse pad is working space by day
    const cand = ready[0], A = this._active(cand.scn); if (A.n >= A.want && !padDay) return;      // demand does not need it yet
    let pad;
    if (cand.restAt === 'PAD') pad = site.pads[cand.pad];
    else {
      const free = site.pads.filter(p => p.state === 'FREE'); if (!free.length) return;
      let pend = 0; for (const x of this.aircraft) if (x.to === site.id && AIRBORNE[x.phase] && x.resv == null && x.rem < 25) pend++;
      if (free.length < pend + (site.pads.length > 2 ? 2 : 1)) return;        // arrivals first
      pad = free[0];
    }
    const a = cand; site.rest.splice(site.rest.indexOf(a.cs), 1);
    if (a.stand >= 0 && site.stands[a.stand]) site.stands[a.stand].cs = null;
    const from = a.restAt; a.phase = 'GROUND'; a.pt = { GROUND: this.t }; a.site = site.id; a.pad = pad.i; a.stand = -1; a.restAt = null; a.duty = 0; a.soc = 96; a.tilt = 90; a.alt = 0; a.restNext = null;
    if (site.def.refuel) a.fuel = 100;
    pad.state = 'OCCUPIED'; pad.cs = a.cs; pad.fuel = 'DONE'; pad.t = 0;
    this._planNext(a, site);
    pad.step = 'POD_IN'; pad.dur = a.pod ? TURN.land.POD_IN : 25;
    this._lockToPad(a, site, pad);
    this._hist(a, { k: 'B', t: this.t, s: site.id });
    this._log('ROSTER', a.scn, a.cs + ' back on the line at ' + site.name + ' · from ' + ({ HANGAR: site.kind === 'MRO' ? 'the MRO hangar' : 'the line hangar', STAND: 'a stand', PAD: 'its pad' }[from]) + ' · ' + pad.id, a.cs);
  }
  /* at 06:00 on the first day most of the fleet is still on the ground: put the share demand does not need yet to rest at its home base or out on its corridor's far end */
  _seedRest() {
    for (const sc of SCENARIOS) {
      const fl = this.aircraft.filter(a => a.scn === sc.id && a.phase === 'CRUISE'), want = Math.round(demandAt(this.t, sc.id) * fl.length);
      for (let i = want, k = 0; i < fl.length; i++, k++) {
        const a = fl[(k * 7) % fl.length]; if (a.phase !== 'CRUISE') { continue; }
        const R = this.routes[a.home], tries = k % 3 === 0 ? [R.b, R.a] : [R.a, R.b];
        for (const sid of tries) {
          const site = this.sites[sid]; if (site.moving || site.kind === 'PLATFORM') continue;
          const slot = this._restSlot(site, null); if (!slot) continue; const where = slot.where, stand = slot.stand;
          this._releasePilot(a);
          a.phase = 'REST'; a.pt = { REST: this.t }; a.site = sid; a.restAt = where; a.tRest = this.t - DUTY.minRestS - this.rnd() * 3600; a.duty = 0; a.rpm = 0; a.alt = 0; a.gs = 0; a.tilt = 90; a.fuel = 100; a.pod = null; a.req = null; a.trail = []; a.pad = -1;
          a.route = R.id; a.dir = sid === R.a ? -1 : 1; a.from = sid === R.a ? R.b : R.a; a.to = sid;
          if (where === 'STAND') { a.stand = stand; site.stands[stand].cs = a.cs; this._lockToStand(a, site); } else { a.stand = -1; a.lat = site.lat; a.lon = site.lon; }
          if (where === 'HANGAR' && a.nextCheck - a.fh <= DUTY.mxWindowFh) a.mxUntil = this.t + this.rnd() * DUTY.lineCheckS;     // night-shift checks still running at 06:00
          (site.rest || (site.rest = [])).push(a.cs);
          break;
        }
      }
    }
    this.requests = this.requests.filter(r => this.byCs[r.cs].phase !== 'REST');
  }

  /* ---------- snapshot: the whole running state as plain JSON, and back ---------- */
  snapshot() {
    const sites = {}, scn = {};
    for (const id in this.sites) { const s = this.sites[id]; sites[id] = { lat: s.lat, lon: s.lon, rot: s.rot, speedMs: s.speedMs, pads: s.pads.map(p => ({ state: p.state, cs: p.cs, step: p.step, t: p.t, dur: p.dur, fuel: p.fuel, why: p.why || '' })),
      bowsers: s.bowsers.map(b => ({ state: b.state, x: b.x, pad: b.pad, t: b.t, queue: b.queue, dir: b.dir })), stands: s.stands.map(x => x.cs), dock: s.dock, rest: s.rest || [], lastRel: s.lastRel || 0 }; }
    for (const id in this.scn) { const S = this.scn[id]; scn[id] = { pilots: S.pilots, kpi: S.kpi, lastRel: S.lastRel }; }
    const aircraft = this.aircraft.map(a => { const o = Object.assign({}, a); o.trail = []; o._sfxOk = a._sfxW === a.wps; delete o._sfxW; return o; });
    return { v: SNAP_V, t: this.t, t0: this.t0, wx: this.wx, rng: this.rnd.state.a, reqSeq: this.reqSeq, podSeq: this.podSeq, sites, scn, aircraft,
      requests: this.requests, log: this.log, led: this.led, days: this.days, biz: this.biz,
      geo: Object.values(this.routes).filter(R => this.sites[R.a].moving || this.sites[R.b].moving).map(R => ({ id: R.id, pts: R.pts, cum: R.cum, km: R.km, direct: R.direct, gcs: R.gcs })) };
  }
  restore(S) {
    this.t = S.t; this.t0 = S.t0; this.wx = S.wx; this.rnd.state.a = S.rng; this.reqSeq = S.reqSeq; this.podSeq = S.podSeq;
    for (const id in S.sites) {
      const s = this.sites[id], d = S.sites[id]; if (!s) continue;
      s.lat = d.lat; s.lon = d.lon; s.rot = d.rot; s.speedMs = d.speedMs; s.rest = d.rest; s.lastRel = d.lastRel;
      d.pads.forEach((p, i) => { if (s.pads[i]) Object.assign(s.pads[i], p); });
      d.bowsers.forEach((b, i) => { if (s.bowsers[i]) Object.assign(s.bowsers[i], b); });
      d.stands.forEach((cs, i) => { if (s.stands[i]) s.stands[i].cs = cs; });
      if (s.dock && d.dock) s.dock = d.dock;
    }
    for (const id in S.scn) { const T = this.scn[id], d = S.scn[id]; if (!T) continue; d.pilots.forEach((p, i) => { if (T.pilots[i]) T.pilots[i].load = p.load; }); T.kpi = d.kpi; T.lastRel = d.lastRel; }
    this.requests = S.requests; const reqs = {}; for (const r of this.requests) reqs[r.id] = r;
    for (const d of S.aircraft) {
      const a = this.byCs[d.cs]; if (!a) continue;
      for (const k in a) if (!(k in d)) delete a[k];
      Object.assign(a, d); a.trail = []; a._sfxW = d._sfxOk ? a.wps : null; delete a._sfxOk;
      if (a.req && reqs[a.req.id]) a.req = reqs[a.req.id];
    }
    this.log = S.log; this.led = S.led; this.days = S.days || []; this.biz = S.biz || [];
    for (const g of S.geo || []) { const R = this.routes[g.id]; if (R) Object.assign(R, g); }
  }

  /* ---------- read-side helpers ---------- */
  siteOf(a) { return a.site ? this.sites[a.site] : null; }
  kpi(scnId) {
    const S = this.scn[scnId], fl = this.aircraft.filter(a => a.scn === scnId);
    const air = fl.filter(a => AIRBORNE[a.phase]).length, mx = fl.filter(a => a.phase === 'GROUND' && this.padOf(a) && this.padOf(a).step === 'MAINT').length;
    const hg = fl.filter(a => a.phase === 'REST' && a.restAt === 'HANGAR' && !a.mxUntil).length, ns = fl.filter(a => a.phase === 'REST' && a.restAt !== 'HANGAR').length, rmx = fl.filter(a => a.phase === 'REST' && a.mxUntil).length;
    return { fleet: fl.length, airborne: air, ground: fl.length - air - mx - hg - ns - rmx - fl.filter(a => a.phase === 'STANDBY').length, maint: mx + rmx, hangar: hg, stands: ns, sorties: S.kpi.sorties, kg: S.kpi.kg,
      onTime: S.kpi.legs ? S.kpi.onTime / S.kpi.legs : 1, avgBlockS: S.kpi.legs ? S.kpi.blockS / S.kpi.legs : 0, holds: S.kpi.holds, kmFlown: S.kpi.kmFlown };
  }
  padOf(a) { return a.phase === 'GROUND' && a.site ? this.sites[a.site].pads[a.pad] : null; }
  /* the record a real feed would publish for one aircraft */
  telemetry(a) {
    return {
      cs: a.cs, t: fmtClock(this.t, true) + ' AST', phase: a.phase, route: a.route, from: a.from, to: a.to,
      lat: +a.lat.toFixed(5), lon: +a.lon.toFixed(5), alt_ft_agl: Math.round(a.alt / FT), gs_kmh: Math.round(a.gs * 3.6), hdg_deg: Math.round(a.hdg),
      vs_ms: +a.vs.toFixed(1), tilt_deg: Math.round(a.tilt), level_ft: a.levelFt, soc_pct: Math.round(a.soc), fuel_pct: Math.round(a.fuel), gen: a.gen,
      pod: a.pod ? { id: a.pod.id, type: a.pod.type, kg: a.pod.kg, sealed: a.pod.sealed, temp_c: a.pod.tempC == null ? null : +a.pod.tempC.toFixed(1) } : null,
      pilot: a.pilot, c2: { station: a.gcs, link: a.link }, fh: +a.fh.toFixed(1), rem_km: +a.rem.toFixed(1)
    };
  }
  /* live feed: upsert aircraft records; ingested aircraft are no longer stepped by the simulation */
  ingest(msg) {
    for (const r of (msg.aircraft || [])) {
      let a = this.byCs[r.cs]; if (!a) continue;
      a.ext = true;
      if (r.lat != null) a.lat = r.lat; if (r.lon != null) a.lon = r.lon;
      if (r.alt_ft_agl != null) a.alt = r.alt_ft_agl * FT; if (r.gs_kmh != null) a.gs = r.gs_kmh / 3.6;
      if (r.hdg_deg != null) a.hdg = r.hdg_deg; if (r.tilt_deg != null) a.tilt = r.tilt_deg; if (r.phase) a.phase = r.phase;
      if (r.soc_pct != null) a.soc = r.soc_pct; if (r.fuel_pct != null) a.fuel = r.fuel_pct;
    }
  }
}
