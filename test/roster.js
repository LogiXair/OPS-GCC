// Hour-by-hour roster check: airborne vs demand, where airframes rest, hangar limits, dry/wet mix.
const fs = require('fs');
const src = ['10-world.js', '15-util.js', '20-sim.js'].map(f => fs.readFileSync(__dirname + '/../src/js/' + f, 'utf8')).join('\n');
const M = new Function(src + '\nreturn {Sim, SCENARIOS, demandAt, AIRBORNE};')();
const sim = new M.Sim(560); let maxH = {};
for (let h = 0; h < 48; h++) {
  sim.warmUp(sim.t + 3600, 5);
  const row = {};
  for (const sc of M.SCENARIOS) { const fl = sim.aircraft.filter(a => a.scn === sc.id && a.phase !== 'STANDBY'); row[sc.id] = fl.filter(a => M.AIRBORNE[a.phase]).length + '/' + fl.length + ' want ' + Math.round(M.demandAt(sim.t) * fl.length) + ' rest ' + fl.filter(a => a.phase === 'REST').length + ' mx ' + (fl.filter(a => a.phase === 'REST' && a.mxUntil).length + fl.filter(a => a.phase === 'GROUND' && sim.padOf(a) && sim.padOf(a).step === 'MAINT').length) + ' pad ' + fl.filter(a => a.restAt === 'PAD').length + ' pos ' + fl.filter(a => a.restNext).length; }
  const hg = {}; for (const id in sim.sites) { const S = sim.sites[id], r = (S.rest || []).map(cs => sim.byCs[cs]); const n = r.filter(a => a.restAt === 'HANGAR').length; if (n) hg[id] = n; maxH[id] = Math.max(maxH[id] || 0, n); }
  if (h % 2 === 1) console.log(String(Math.floor(sim.t / 3600) % 24).padStart(2, '0') + ':00', JSON.stringify(row), 'hangars', JSON.stringify(hg));
}
console.log('max hangar occupancy', JSON.stringify(maxH));
const L = sim.days[0].tot; console.log('day1 dry kg', Math.round(L.kgDry), 'wet kg', Math.round(L.kgWet), 'ratio', (L.kgDry / L.kgWet).toFixed(2), 'rev', Math.round(L.rev), 'legs', L.legs, 'empty', L.empty);
const st = {}; for (const id in sim.sites) { const S = sim.sites[id]; const n = (S.rest || []).length; if (n) st[id] = n; } console.log('resting now by site', JSON.stringify(st));
console.log('docks', JSON.stringify(Object.fromEntries(Object.keys(sim.sites).filter(id => sim.sites[id].dock).map(id => [id, sim.sites[id].dock.trucks + ' trucks ' + sim.sites[id].dock.built + '/' + sim.sites[id].dock.broken + ' q' + sim.sites[id].dock.qBuild + ' st' + sim.sites[id].dock.staged.length]))));
