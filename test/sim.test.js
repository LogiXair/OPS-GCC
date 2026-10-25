// Headless check of the operations simulation: run a simulated day and assert the invariants.
const fs = require('fs'), vm = require('vm');
const src = ['10-world.js', '15-util.js', '20-sim.js'].map(f => fs.readFileSync(__dirname + '/../src/js/' + f, 'utf8')).join('\n') + '\nthis.Sim=Sim;this.SCENARIOS=SCENARIOS;this.distKm=distKm;this.AIRBORNE=AIRBORNE;this.fmtDur=fmtDur;this.FT=FT;this.CORRIDOR=CORRIDOR;';
const ctx = new Function(src.split('\nthis.Sim=')[0] + '\nreturn {Sim,SCENARIOS,distKm,AIRBORNE,fmtDur,FT,CORRIDOR};')();
const { Sim, SCENARIOS, distKm, AIRBORNE, fmtDur, FT, CORRIDOR } = ctx;
const t0 = Date.now(); const sim = new Sim(560);
console.log('ROUTES'); for (const id in sim.routes) { const r = sim.routes[id]; console.log(' ', id.padEnd(5), r.name.padEnd(18), 'band', String(r.baseFt).padStart(4), 'route', r.km.toFixed(0).padStart(4), 'km  direct', r.direct.toFixed(0).padStart(4), 'km  gcs', r.gcs.length); }
const pairs = {}; let crossViol = 0, crossMeet = 0, bad = 0, maxAge = {}, phaseCount = {}, minSep = 1e9, sepViol = 0, maxHoldTurns = 0;
const H = +process.env.H || 20; // simulated hours
const endT = sim.t + H * 3600; let n = 0;
while (sim.t < endT) {
  sim._coarse(1); n++;
  if (n % 5 === 0) {
    for (const id in sim.sites) { const s = sim.sites[id]; const seen = {};
      for (const p of s.pads) if (p.state === 'OCCUPIED') { if (seen[p.cs]) { bad++; console.log('DOUBLE PAD', id, p.cs); } seen[p.cs] = 1; } }
    for (const a of sim.aircraft) {
      if (!isFinite(a.lat) || !isFinite(a.lon) || !isFinite(a.alt) || !isFinite(a.gs)) { bad++; if (bad < 5) console.log('NaN', a.cs, a.phase); }
      if (a.phase !== 'GROUND' && a.phase !== 'STANDBY' && a.phase !== 'CRUISE' && a.phase !== 'REST') maxAge[a.phase] = Math.max(maxAge[a.phase] || 0, a.tPhase);
      if (a.fuel <= 0.5 && AIRBORNE[a.phase]) { bad++; if (bad < 8) console.log('FUEL OUT', a.cs, a.route, a.phase); }
      if (a.soc <= 5) { bad++; if (bad < 8) console.log('SOC LOW', a.cs, a.phase, a.soc); }
      if (a.hold) maxHoldTurns = Math.max(maxHoldTurns, a.hold.turns);
    }
    // separation between cruising aircraft on the same route
    const cr = sim.aircraft.filter(a => a.phase === 'CRUISE');
    for (let i = 0; i < cr.length; i++) for (let j = i + 1; j < cr.length; j++) {
      const a = cr[i], b = cr[j]; if (a.route !== b.route) continue;
      const d = distKm(a.lat, a.lon, b.lat, b.lon), dv = Math.abs(a.alt - b.alt) / FT;
      if (dv < CORRIDOR.sepVertFt - 1 && d < CORRIDOR.sepTrailKm) { sepViol++; minSep = Math.min(minSep, d); }
    }
    // corridors that cross away from their terminals must be vertically separated
    for (let i = 0; i < cr.length; i++) for (let j = i + 1; j < cr.length; j++) {
      const a = cr[i], b = cr[j]; if (a.route === b.route || a.scn !== b.scn || a.scn !== 'MM') continue;
      if (Math.min(a.rem, a.total - a.rem, b.rem, b.total - b.rem) < 30) continue;
      const d = distKm(a.lat, a.lon, b.lat, b.lon), dv = Math.abs(a.alt - b.alt) / FT;
      if (dv < CORRIDOR.sepVertFt - 1 && d < CORRIDOR.sepTrailKm) { crossViol++; const pk = a.route + '×' + b.route; pairs[pk] = (pairs[pk] || 0) + 1; if (pairs[pk] === 1) console.log('CROSSING', a.cs, a.route, a.dir, a.rem.toFixed(0), a.lat.toFixed(2), a.lon.toFixed(2), b.cs, b.route, b.dir, b.rem.toFixed(0), b.lat.toFixed(2), b.lon.toFixed(2), d.toFixed(2), 'km', a.levelFt, b.levelFt, a.alt.toFixed(0), b.alt.toFixed(0)); }
      if (d < CORRIDOR.sepTrailKm) crossMeet++;
    }
  }
}
console.log('wall ms', Date.now() - t0, 'steps', n, 'invariant failures', bad, 'separation violations', sepViol, 'max hold turns', maxHoldTurns, 'crossing violations', crossViol, 'crossing encounters', crossMeet);
console.log('max phase age (s)', JSON.stringify(Object.fromEntries(Object.entries(maxAge).map(([k, v]) => [k, Math.round(v)]))));
for (const sc of SCENARIOS) { const k = sim.kpi(sc.id); console.log(sc.id, JSON.stringify({ ...k, onTime: +(k.onTime * 100).toFixed(1), avgBlock: fmtDur(k.avgBlockS), kmFlown: Math.round(k.kmFlown) })); }
const per = {}; for (const a of sim.aircraft) { per[a.home] = per[a.home] || { n: 0, legs: 0 }; per[a.home].n++; per[a.home].legs += a.legs; }
console.log('legs per home route', JSON.stringify(per));
const ph = {}; for (const a of sim.aircraft) ph[a.phase] = (ph[a.phase] || 0) + 1; console.log('phases now', JSON.stringify(ph));
console.log('fuel min now', Math.min(...sim.aircraft.map(a => a.fuel)).toFixed(0), 'soc min', Math.min(...sim.aircraft.map(a => a.soc)).toFixed(0));
console.log(sim.log.slice(-14).map(l => fmtDur(0) && (Math.floor(l.t / 3600) % 24 + ':' + String(Math.floor(l.t % 3600 / 60)).padStart(2, '0')) + ' ' + l.src.padEnd(6) + l.text).join('\n'));
console.log(JSON.stringify(sim.telemetry(sim.aircraft[0])));
const site = {}; for (const id in sim.sites) { const S = sim.sites[id]; if (S.scn !== 'MM') continue; site[id] = S.dock ? S.dock.built + '/' + S.dock.broken + ' q' + S.dock.qBreak.length + ' max' + S.dock.qMax + ' in' + S.dock.st.reduce((a, x) => a + x.fin.kg, 0) + 'kg out' + S.dock.st.reduce((a, x) => a + x.fout.kg, 0) + 'kg' : '-'; }
console.log('dock built/unloaded', JSON.stringify(site));
const hs = {}; for (const d of [...sim.days.map(x => null)]) {} const L = sim.led; for (const id in L.site) if (L.site[id].holds) hs[id] = L.site[id].holds; console.log('holds today by site', JSON.stringify(hs), 'days', JSON.stringify(sim.days.map(d => ({ rev: Math.round(d.tot.rev), t: Math.round(d.tot.kg / 1000), legs: d.tot.legs, empty: d.tot.empty, fh: Math.round(d.tot.fh), holds: d.tot.holds }))), 'today', Math.round(L.tot.rev));
console.log('crossing pairs', JSON.stringify(pairs));

process.exit(bad || sepViol || crossViol ? 1 : 0);
