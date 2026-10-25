#!/usr/bin/env node
/* ============================================================================
   THE RECORD RUNNER — keeps the shared operation running on the calendar.
   Day 1 began at 06:00 AST on 25 Oct 2026; one simulated second is one real second.
   Each run loads the saved state, flies the operation forward to the present moment,
   saves the state again and archives every operating day that closed on the way.

     node tools/record.js --state rec/state.json.gz --logs logs [--until 2026-10-19T09:00:00Z] [--dt 1]

   Runs hourly from .github/workflows/record.yml. The state lives on the `record`
   branch (overwritten each run); the daily logs are committed to main under logs/.
   ========================================================================== */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..'), STATE = arg('state', 'rec/state.json.gz'), LOGS = arg('logs', 'logs'), DT = +arg('dt', 1);
const src = ['10-world.js', '15-util.js', '20-sim.js'].map(f => fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8')).join('\n');
const W = new Function(src + '\nreturn { Sim, SCENARIOS, SNAP_V, dayOf, dateOf, dayFactor, dayEvent, L560, costOf, COST };')();
const EPOCH = Date.UTC(2026, 9, 24, 21, 0);                       // 25 Oct 2026 00:00 AST, sim t = 0
const until = arg('until') ? Date.parse(arg('until')) : Date.now(), target = (until - EPOCH) / 1000;

const sim = new W.Sim(560);
let fresh = true;
if (fs.existsSync(STATE)) {
  try {
    const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(STATE)).toString());
    if (o.snap && o.snap.v === W.SNAP_V) { sim.restore(o.snap); fresh = false; console.log('resumed at day', W.dayOf(sim.t), new Date(EPOCH + sim.t * 1000).toISOString()); }
    else console.log('saved state is from model version', o.snap && o.snap.v, '— the record is flown again from day 1 with version', W.SNAP_V);
  } catch (e) { console.log('saved state unreadable, starting from day 1:', e.message); }
}
if (fresh) console.log('starting the record at day 1, 06:00 AST');
fs.mkdirSync(LOGS, { recursive: true });

/* ---- archive ---- */
const idxPath = path.join(LOGS, 'index.json'), csvPath = path.join(LOGS, 'days.csv');
const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : [];
const done = new Set(index.map(d => d.day));
const COLS = ['day', 'date', 'line', 'revenue_sar', 'revenue_dry_sar', 'revenue_wet_sar', 'tonnes', 'dry_t', 'wet_t', 'tonne_km', 'pods', 'consignments', 'legs', 'empty_legs', 'load_factor_pct', 'flight_hours', 'direct_cost_sar', 'contribution_sar', 'margin_pct', 'holds', 'late_legs', 'checks_opened', 'stood_down', 'demand_factor', 'event'];
const r0 = v => Math.round(v || 0), r1 = v => Math.round((v || 0) * 10) / 10;
const fleetOf = line => sim.aircraft.filter(a => line === 'ALL' || a.scn === line).length;
/* direct cost per the deck's A5 basis: hours flown, landings, and each airframe's fixed cost for the day */
const row = (d, date, line, r, df, ev, c = W.costOf(r, fleetOf(line), 24)) => [d, date, line, r0(r.rev), r0(r.revDry), r0(r.revWet), r1(r.kg / 1000), r1(r.kgDry / 1000), r1(r.kgWet / 1000), r0(r.tkm), r0(r.pods), r0(r.cons), r0(r.legs), r0(r.empty), r.capKg ? r1(r.kg / r.capKg * 100) : '', r1(r.fh), r0(c.total), r0(r.rev - c.total), r.rev ? r1((r.rev - c.total) / r.rev * 100) : '', r0(r.holds), r0(r.late), r0(r.mx), r0(r.down), df == null ? '' : df, ev || ''];
let csv = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8').trimEnd().split('\n') : [COLS.join(',')];
function archive() {
  for (const d of sim.days) {
    const n = d.day + 1; if (done.has(n)) continue;
    const date = new Date(Date.UTC(2026, 9, 25) + d.day * 86400000).toISOString().slice(0, 10), tag = String(n).padStart(3, '0');
    const legs = [];
    for (const a of sim.aircraft) for (const e of a.hist || []) if (e.k === 'L' && e.t >= d.t0 && e.t < d.t0 + 86400)
      legs.push([a.cs, a.scn, Math.round(e.t), e.a ? Math.round(e.a) : null, e.f, e.to, e.r, e.kg || 0, e.ty || '', e.rev || 0, e.km || null, e.late || 0, e.mro || 0]);
    legs.sort((p, q) => p[2] - q[2]);
    const ev = {}; for (const sc of W.SCENARIOS) { const e = W.dayEvent(n, sc.id); if (e) ev[sc.id] = e[3]; }
    fs.writeFileSync(path.join(LOGS, 'day-' + tag + '.json'), JSON.stringify({ day: n, date, opens: '06:00 AST', fleet: d.fleet, demand_factor: d.df, events: ev, total: d.tot, lines: d.scn, hubs: d.site, corridors: d.route,
      leg_columns: ['callsign', 'line', 'dep_s', 'arr_s', 'from', 'to', 'corridor', 'kg', 'cargo', 'revenue_sar', 'km', 'late', 'mro_ferry'], legs }));
    for (const sc of W.SCENARIOS) if (d.scn[sc.id]) csv.push(row(n, date, sc.id, d.scn[sc.id], d.df && d.df[sc.id], ev[sc.id]).join(','));
    csv.push(row(n, date, 'ALL', d.tot, '', Object.values(ev).join(' / ')).join(','));
    index.push({ day: n, date, revenue_sar: r0(d.tot.rev), direct_cost_sar: r0(W.costOf(d.tot, sim.aircraft.length, 24).total), tonnes: r1(d.tot.kg / 1000), legs: r0(d.tot.legs), file: 'day-' + tag + '.json' });
    done.add(n); console.log('archived day', n, date, 'SAR ' + r0(d.tot.rev).toLocaleString('en-US'), r1(d.tot.kg / 1000) + ' t', legs.length + ' legs');
  }
}

/* ---- fly forward ---- */
const t0 = Date.now(); let lastLog = sim.t;
if (target <= sim.t) console.log('nothing to fly: record is already at', new Date(EPOCH + sim.t * 1000).toISOString());
while (sim.t < target) {
  sim.step(Math.min(3600, target - sim.t), DT);
  archive();
  if (sim.t - lastLog >= 6 * 3600) { lastLog = sim.t; console.log('  at day', W.dayOf(sim.t), W.dateOf(sim.t), Math.round((Date.now() - t0) / 1000) + ' s'); }
}
archive();
index.sort((a, b) => a.day - b.day);
fs.writeFileSync(idxPath, JSON.stringify(index, null, 1));
fs.writeFileSync(csvPath, csv.join('\n') + '\n');

/* ---- save ---- */
const meta = { v: W.SNAP_V, t: sim.t, day: W.dayOf(sim.t), date: W.dateOf(sim.t), at: new Date(EPOCH + sim.t * 1000).toISOString(), savedAt: new Date().toISOString(), fleet: sim.aircraft.length };
fs.mkdirSync(path.dirname(STATE), { recursive: true });
const js = JSON.stringify({ meta, snap: sim.snapshot() });
fs.writeFileSync(STATE, zlib.gzipSync(js, { level: 9 }));
fs.writeFileSync(path.join(path.dirname(STATE), 'meta.json'), JSON.stringify(meta, null, 1));
console.log('saved', meta.at, 'day', meta.day, (js.length / 1e6).toFixed(1) + ' MB json,', (fs.statSync(STATE).size / 1e6).toFixed(2) + ' MB gz,', Math.round((Date.now() - t0) / 1000) + ' s');
