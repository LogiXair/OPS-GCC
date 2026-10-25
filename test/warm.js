const fs = require('fs');
const src = ['10-world.js', '15-util.js', '20-sim.js'].map(f => fs.readFileSync(__dirname + '/../src/js/' + f, 'utf8')).join('\n');
const M = new Function(src + '\nreturn {Sim, SCENARIOS};')();
for (const dt of [10, 5, 2]) { const t0 = Date.now(); const sim = new M.Sim(560); sim.warmUp(15.67 * 3600, dt);
  const k = M.SCENARIOS.map(s => { const q = sim.kpi(s.id); return s.id + ' sort ' + q.sorties + ' kg ' + q.kg + ' air ' + q.airborne + '/' + q.fleet + ' holds ' + q.holds + ' ot ' + (q.onTime * 100).toFixed(0); }).join(' | ');
  const base = sim.sites.HYD.pads.map(p => p.state[0] + (p.step ? ':' + p.step : '')).join(' ');
  const mx = sim.aircraft.filter(a => a.route && sim.routes[a.route].mro).map(a => a.cs + ':' + a.route + ':' + a.phase + (sim.padOf(a) ? '/' + sim.padOf(a).step : '')).join(' ');
  console.log('   MX:', mx);
  console.log('dt', dt, 'ms', Date.now() - t0, k, '\n   HYD pads:', base); }
