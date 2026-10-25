/* ============================================================================
   OPERATIONS REPORT — company-wide revenue, hub volumes and a high-level hub log.
   Reads the simulation's daily ledger (sim.led, sim.days, sim.biz) only, so a
   real billing or TMS feed can fill the same records later.
   ========================================================================== */

const inr = v => { const a = Math.abs(v); return 'SAR ' + (a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString('en-US')); };
const inrFull = v => 'SAR ' + Math.round(v).toLocaleString('en-US');
const tt = kg => (kg / 1000).toFixed(kg >= 100000 ? 0 : 1);
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const LINE_NAME = { MM: 'Middle-mile', NV: 'Navy ship-to-shore', OF: 'Offshore', RS: 'Red Sea islands', DS: 'Desert camps' };
const sgn = v => (v < 0 ? '−' : '') + inr(Math.abs(v));
const mcls = (num, den) => den && num / den < 0 ? ' c-hot' : '';
/* the venture plan in the deck (A7, A9), SAR millions */
const DECK_PLAN = { years: [2027, 2028, 2029, 2030, 2031], mil: [0, 2, 6, 12, 20], com: [0, 1, 4, 10, 20], rev: [0, 10.9, 37.1, 84.4, 159.9], direct: [0, 7.0, 23.0, 49.7, 90.8], overhead: [6.6, 9.6, 10.6, 13.1, 16.1], ebitda: [-6.6, -5.7, 3.5, 21.6, 53.0], net: [-7.2, -7.9, -0.2, 13.7, 38.3] };

class OpsReport {
  constructor(ui) {
    this.ui = ui; this.sim = ui.sim; this.tab = 'TODAY'; this.scope = 'ALL'; this.price = TARIFF.DRY; this.period = 'LAST'; this.hub = 'ALL'; this.open = false;
    const el = $('ops');
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const t = b.getAttribute('data-otab'), s = b.getAttribute('data-oscope'), pr = b.getAttribute('data-oprice'), h = b.getAttribute('data-ohub'), a = b.getAttribute('data-oact');
      const pd = b.getAttribute('data-operiod');
      if (pd) { this.period = pd; this.render(true); } else if (pr) { this.price = +pr; this.render(true); } else if (t) { this.tab = t; this.render(true); } else if (s) { this.scope = s; this.hub = 'ALL'; this.render(true); } else if (h) { this.hub = h; this.render(true); }
      else if (a === 'close') this.show(false);
      else if (a === 'site') { this.show(false); this.ui.app.select({ type: 'site', id: b.getAttribute('data-v') }, true); }
      else if (a === 'csv') this.exportCsv(b.getAttribute('data-v'));
      else if (a === 'ac') { this.show(false); this.ui.app.select({ type: 'aircraft', id: b.getAttribute('data-v') }, true); }
      else if (a === 'route') { this.show(false); this.ui.app.select({ type: 'route', id: b.getAttribute('data-v') }, true); }
    });
  }
  show(on) { this.open = on; $('ops').hidden = !on; if (on) this.render(true); this.ui.chrome(); }

  /* ledger slices for the chosen business line */
  inScope(scn) { return this.scope === 'ALL' || scn === this.scope; }
  dayRec(L) { if (this.scope === 'ALL') return L.tot; return L.scn[this.scope] || ledRec(); }
  fleet() { return this.sim.aircraft.filter(a => this.inScope(a.scn) && a.phase !== 'STANDBY').length; }
  airframes(scn) { return this.sim.aircraft.filter(a => scn ? a.scn === scn : this.inScope(a.scn)).length; }          // every airframe owned, spares included
  hrsOf(L) { return L === this.sim.led ? clamp((this.sim.t - L.t0) / 3600, 0, 24) : 24; }

  render(force) {
    if (!this.open) return;
    const sim = this.sim, L = sim.led, el = $('ops'), keep = force ? 0 : (el.querySelector('.ob') ? el.querySelector('.ob').scrollTop : 0);
    const hrs = (sim.t - L.t0) / 3600;
    const tabs = ['TODAY', 'ECONOMICS', 'FLEET', 'HUBS', 'CORRIDORS', 'HUB LOG', 'DAILY CLOSE'];
    const scopes = [['ALL', 'ALL LINES'], ['MM', 'MIDDLE-MILE'], ['OF', 'OFFSHORE'], ['RS', 'RED SEA'], ['DS', 'DESERT CAMPS']];
    let head = '<div class="oh"><div class="row"><span class="cap">LogiXair · company operations · day ' + (L.day + 1) + ' · 06:00 → ' + fmtClock(sim.t) + ' AST · ' + hrs.toFixed(1) + ' h</span><button type="button" class="x" data-oact="close" aria-label="Close">×</button></div>' +
      '<h2>Daily operations report</h2>' +
      '<div class="otabs"><div class="seg">' + tabs.map(t => '<button type="button" data-otab="' + t + '"' + (t === this.tab ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div>' +
      '<div class="seg">' + scopes.map(s => '<button type="button" data-oscope="' + s[0] + '"' + (s[0] === this.scope ? ' class="on"' : '') + '>' + s[1] + '</button>').join('') + '</div></div></div>';
    let body = '';
    if (this.tab === 'TODAY') body = this.today(L);
    else if (this.tab === 'ECONOMICS') body = this.econ(this.period === 'LAST' && sim.days.length ? sim.days[sim.days.length - 1] : L);
    else if (this.tab === 'FLEET') body = this.fleetPos();
    else if (this.tab === 'HUBS') body = this.hubs(L);
    else if (this.tab === 'CORRIDORS') body = this.corridors(L);
    else if (this.tab === 'HUB LOG') body = this.hubLog(L);
    else body = this.close(L);
    setHTML(el, head + '<div class="ob">' + body + '</div>');
    const ob = el.querySelector('.ob'); if (ob) ob.scrollTop = keep;
  }

  today(L) {
    const r = this.dayRec(L), n = this.fleet(), sim = this.sim;
    const lastH = L.h > 0 ? L.hours[L.h - 1] : null, lh = lastH ? (this.scope === 'ALL' ? lastH.tot : lastH.scn[this.scope] || ledRec()) : null;
    const cells = [
      ['REVENUE TODAY', inr(r.rev), inrFull(r.rev)], ['LAST FULL HOUR', lh ? inr(lh.rev) : '—', lh ? lh.pods + ' deliveries' : 'first hour running'],
      ['CARGO DELIVERED', tt(r.kg) + '<small>t</small>', r.pods + ' pods · ' + (r.pods * POD.pallets) + ' pallets'], ['TONNE-KM', fmtInt(r.tkm), 'billed distance × weight'],
      ['YIELD', 'SAR ' + (r.tkm ? (r.rev / r.tkm).toFixed(0) : '—') + '<small>/t·km</small>', 'SAR ' + (TARIFF.DRY * 1000).toFixed(0) + ' per t·km · offshore SAR ' + fmtInt(TARIFF.SORTIE.OF) + ' per sortie'],
      ['LOAD FACTOR', pct(r.kg, r.capKg), 'of ' + L560.payloadKg + ' kg on ' + r.legs + ' revenue legs'], ['EMPTY LEGS', pct(r.empty, r.legs), r.empty + ' positioning legs'],
      ['FLIGHT HOURS', fmtInt(r.fh), (r.fh / Math.max(1, n)).toFixed(1) + ' FH per aircraft · ' + n + ' in roster'], ['REVENUE / FLIGHT HOUR', r.fh ? inr(r.rev / r.fh) : '—', r.legs ? inr(r.rev / r.legs) + ' per leg' : ''],
      ['ON TIME', pct(r.legs - r.late, r.legs), r.late + ' late · ' + r.holds + ' holds'], ['DEPARTURES', fmtInt(r.dep), fmtInt(r.arr) + ' arrivals · ' + r.down + ' stood down'],
      (c => ['CONTRIBUTION', '<span class="' + mcls(r.rev - c.total, 1) + '">' + sgn(r.rev - c.total) + '</span>', pct(r.rev - c.total, r.rev) + ' margin after ' + inr(c.total) + ' direct cost · see ECONOMICS'])(costOf(r, this.airframes(), this.hrsOf(L)))
    ];
    let h = '<div class="ogrid">' + cells.map(c => '<div class="cell"><span class="cap">' + c[0] + '</span><b class="num">' + c[1] + '</b><p>' + c[2] + '</p></div>').join('') + '</div>';
    // dry and wet
    const split = (lab, rev, kg, col) => '<div class="bar"><div class="row"><span>' + lab + ' · ' + tt(kg) + ' t</span><b class="num">' + inr(rev) + ' · ' + pct(rev, r.rev) + '</b></div><div class="meter"><i style="width:' + (r.rev ? rev / r.rev * 100 : 0).toFixed(1) + '%' + (col ? ';background:' + col : '') + '"></i></div></div>';
    h += '<div class="ocols"><div><span class="cap">Revenue by cargo class</span><div style="display:flex;flex-direction:column;gap:9px;margin-top:9px">' +
      split('Dry', r.revDry, r.kgDry) + split('Wet · chilled and liquid', r.revWet, r.kgWet, '#78AAFF') + '</div>' +
      '<p class="src">Billed on delivery at SAR ' + TARIFF.DRY.toFixed(3) + ' per kg·km for dry and chilled pods alike (kg × great-circle km between the two sites); offshore pays SAR ' + fmtInt(TARIFF.SORTIE.OF) + ' per loaded sortie. Maintenance ferries and empty legs earn nothing.</p></div>' +
      '<div><span class="cap">Revenue by hour · 06:00 to 06:00</span>' + this.chart(L) + '</div></div>';
    // business lines
    const lines = SCENARIOS.filter(s => this.inScope(s.id)).map(s => { const x = L.scn[s.id] || ledRec(), fl = sim.aircraft.filter(a => a.scn === s.id && a.phase !== 'STANDBY').length; return [s, x, fl]; });
    h += '<div><span class="cap">By business line</span><table class="ot"><thead><tr><th>LINE</th><th class="r">AIRCRAFT</th><th class="r">REVENUE</th><th class="r">SHARE</th><th class="r">TONNES</th><th class="r">PODS</th><th class="r">LEGS</th><th class="r">LOAD FACTOR</th><th class="r">FH</th><th class="r">SAR  / FH</th><th class="r">ON TIME</th></tr></thead><tbody>' +
      lines.map(([s, x, fl]) => '<tr><td class="w">' + esc(s.name) + '</td><td class="r">' + fl + '</td><td class="r w">' + inr(x.rev) + '</td><td class="r">' + pct(x.rev, L.tot.rev) + '</td><td class="r">' + tt(x.kg) + '</td><td class="r">' + x.pods + '</td><td class="r">' + x.legs + '</td><td class="r">' + pct(x.kg, x.capKg) + '</td><td class="r">' + fmtInt(x.fh) + '</td><td class="r">' + (x.fh ? inr(x.rev / x.fh) : '—') + '</td><td class="r">' + pct(x.legs - x.late, x.legs) + '</td></tr>').join('') +
      '</tbody></table></div>';
    return h;
  }

  /* ---------- economics: the deck's cost basis (A5) applied to what the network flew today ---------- */
  econ(L) {
    const sim = this.sim, r = this.dayRec(L), hrs = this.hrsOf(L), full = hrs >= 24, n = this.airframes(), c = costOf(r, n, hrs), p = this.price, rev = revAt(r, p), m = rev - c.total;
    const fhAc = r.fh / n, load = r.pods ? r.kg / r.pods : 0, cFh = r.fh ? (c.total - c.landing) / r.fh : 0, lPerFh = r.fh ? r.arr / r.fh : 0;
    const be = (cf, kg) => { const d = p * kg - cf / 220; return d > 0 ? (COST.landing + cf * 0.25) / d : Infinity; };          // leg length at which kg·km revenue covers the sortie
    const last = sim.days.length ? sim.days[sim.days.length - 1] : null;
    const perSeg = '<div class="seg">' + (last ? '<button type="button" data-operiod="LAST"' + (L === last ? ' class="on"' : '') + '>DAY ' + (last.day + 1) + ' · FULL DAY</button>' : '') + '<button type="button" data-operiod="TODAY"' + (L === sim.led ? ' class="on"' : '') + '>TODAY SO FAR · ' + this.hrsOf(sim.led).toFixed(1) + ' H</button></div>';
    const priceSeg = '<div class="seg">' + [[TARIFF.DRY, 'BASE · SAR ' + TARIFF.DRY.toFixed(3)], [TARIFF.CAUTIOUS, 'CAUTIOUS · SAR ' + TARIFF.CAUTIOUS.toFixed(3)]].map(x => '<button type="button" data-oprice="' + x[0] + '"' + (x[0] === p ? ' class="on"' : '') + '>' + x[1] + ' / kg·km</button>').join('') + '</div>';
    const cell = (a, b, c2) => '<div class="cell"><span class="cap">' + a + '</span><b class="num">' + b + '</b><p>' + c2 + '</p></div>';
    let h = '<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><p class="src" style="margin:0;max-width:760px">Direct cost on the basis of the Saudi Brothers deck (A5): SAR ' + COST.deckFh + ' a flight hour at 6 FH a day and SAR ' + COST.landing + ' a landing. Ownership, insurance and the operations centre are fixed per airframe (SAR ' + fmtInt(COST.fixedDay) + ' a day each, spares included), so they fall per hour as utilisation rises. ' + (full ? 'Showing day ' + (L.day + 1) + ', 06:00 to 06:00.' : 'Showing today so far: fixed cost for the ' + hrs.toFixed(1) + ' h elapsed' + (last ? '' : '; the first full day closes at 06:00') + '.') + '</p><div style="display:flex;gap:8px;flex-wrap:wrap">' + perSeg + priceSeg + '</div></div>' +
      '<div class="ogrid" style="margin-top:12px">' + [
        cell('REVENUE', inr(rev), p === TARIFF.DRY ? 'base price' : 'at the cautious price'), cell('DIRECT COST', inr(c.total), inr(c.fixed) + ' fixed · ' + inr(c.variable) + ' by hour and landing'),
        cell('CONTRIBUTION', '<span class="' + mcls(m, 1) + '">' + sgn(m) + '</span>', pct(m, rev) + ' margin before overhead'), cell('COST / FLIGHT HOUR', 'SAR ' + fmtInt(cFh), 'deck ' + COST.deckFh + ' at 6 FH · landings on top'),
        cell('REVENUE / FLIGHT HOUR', r.fh ? 'SAR ' + fmtInt(rev / r.fh) : '—', fhAc.toFixed(1) + ' FH per airframe ' + (full ? 'in the day' : 'so far')), cell('COST PER KG', r.kg ? 'SAR ' + (c.total / r.kg).toFixed(2) : '—', 'revenue SAR ' + (r.kg ? (rev / r.kg).toFixed(2) : '—') + ' per kg')].join('') + '</div>';
    // cost elements
    const rows = ['own', 'ins', 'ops', 'fuel', 'mx', 'pilot', 'satcom', 'landing'];
    const deckOf = k => k === 'landing' ? COST.landing + ' / landing' : (COST.fixedFh[k] || COST.fh[k]);
    h += '<div class="ocols"><div><h3 class="osec">Where the cost goes</h3><table class="ot"><thead><tr><th>COST ELEMENT</th><th class="r">DECK SAR / FH</th><th class="r">TODAY</th><th class="r">SAR / FH TODAY</th><th class="r">SHARE</th></tr></thead><tbody>' +
      rows.map(k => '<tr><td class="w">' + COST.LABEL[k] + (COST.fixedFh[k] ? ' <span class="c-mute">fixed</span>' : '') + '</td><td class="r">' + deckOf(k) + '</td><td class="r">' + inr(c[k]) + '</td><td class="r">' + (r.fh ? fmtInt(c[k] / r.fh) : '—') + '</td><td class="r">' + pct(c[k], c.total) + '</td></tr>').join('') +
      '<tr class="tot"><td class="w">Total direct cost</td><td class="r">' + COST.deckFh + ' + ' + COST.landing + '</td><td class="r">' + inr(c.total) + '</td><td class="r">' + (r.fh ? fmtInt(c.total / r.fh) : '—') + '</td><td class="r">100%</td></tr></tbody></table>' +
      '<p class="src">Fixed elements are the deck\'s SAR/FH × 1,800 FH a year, spread over 365 days per airframe. ' + fmtInt(r.arr) + ' landings today, ' + lPerFh.toFixed(2) + ' per flight hour: short legs pay the SAR ' + COST.landing + ' landing charge more often.</p></div>';
    // twin against the deck basis
    const dk = { fh: 6, load: COST.deckLoadKg, cFh: COST.deckFh, lpf: 1 / (0.25 + 330 / 220) };
    const uRow = (a, d, t) => '<tr><td class="w">' + a + '</td><td class="r">' + d + '</td><td class="r w">' + t + '</td></tr>';
    h += '<div><h3 class="osec">This network against the deck basis</h3><table class="ot"><thead><tr><th></th><th class="r">DECK (A5, A6)</th><th class="r">TWIN TODAY</th></tr></thead><tbody>' +
      uRow('Flight hours per airframe per day', dk.fh + ' (7 in the 2031 base case)', fhAc.toFixed(1) + (full ? '' : ' so far')) + uRow('Average load per pod', dk.load + ' kg', fmtInt(load) + ' kg · LF ' + pct(r.kg, r.capKg)) +
      uRow('Cost per flight hour, before landings', 'SAR ' + dk.cFh, 'SAR ' + fmtInt(cFh)) + uRow('Landing charge', 'SAR ' + COST.landing, 'SAR ' + COST.landing + ' × ' + lPerFh.toFixed(2) + ' per FH') +
      uRow('Price', 'SAR ' + p.toFixed(3) + ' per kg·km', 'SAR ' + p.toFixed(3) + ' · offshore SAR ' + fmtInt(TARIFF.SORTIE.OF) + ' a sortie') +
      uRow('Break-even leg, kg·km pricing', fmtInt(be(dk.cFh, dk.load)) + ' km', isFinite(be(cFh, load)) ? fmtInt(be(cFh, load)) + ' km' : '—') +
      uRow('Margin on a 330 km leg', pct(p * dk.load * 330 - deckSortie(330), p * dk.load * 330), pct(p * load * 330 - (COST.landing + cFh * (0.25 + 330 / 220)), p * load * 330)) +
      '</tbody></table><p class="src">Break-even: the leg at which ' + p.toFixed(3) + ' × load × km pays the landing and ' + '(0.25 h + km ÷ 220 km/h) of flying, the deck\'s own sortie formula. The twin flies more hours on the same fixed cost, which is most of the gap.</p></div></div>';
    // by line
    const lines = SCENARIOS.filter(s => this.inScope(s.id)).map(s => { const x = L.scn[s.id] || ledRec(), na = this.airframes(s.id), cx = costOf(x, na, hrs), rx = revAt(x, p); return [s, x, na, cx, rx]; });
    h += '<h3 class="osec">By business line</h3><table class="ot"><thead><tr><th>LINE</th><th>PRICING</th><th class="r">AIRFRAMES</th><th class="r">FH / AIRFRAME</th><th class="r">REVENUE</th><th class="r">DIRECT COST</th><th class="r">CONTRIBUTION</th><th class="r">MARGIN</th><th class="r">COST / FH</th><th class="r">REVENUE / FH</th><th class="r">COST / LEG</th><th class="r">REVENUE / LEG</th></tr></thead><tbody>' +
      lines.map(([s, x, na, cx, rx]) => { const mx = rx - cx.total; return '<tr><td class="w">' + esc(s.name) + '</td><td class="c-mute">' + (TARIFF.SORTIE[s.id] ? 'SAR ' + fmtInt(TARIFF.SORTIE[s.id]) + ' / sortie' : 'SAR ' + p.toFixed(3) + ' / kg·km') + '</td><td class="r">' + na + '</td><td class="r">' + (hrs ? (x.fh / na * 24 / hrs).toFixed(1) : '—') + '</td><td class="r">' + inr(rx) + '</td><td class="r">' + inr(cx.total) + '</td><td class="r w' + mcls(mx, 1) + '">' + sgn(mx) + '</td><td class="r' + mcls(mx, 1) + '">' + pct(mx, rx) + '</td><td class="r">' + (x.fh ? fmtInt(cx.total / x.fh) : '—') + '</td><td class="r">' + (x.fh ? fmtInt(rx / x.fh) : '—') + '</td><td class="r">' + (x.legs ? fmtInt(cx.total / x.legs) : '—') + '</td><td class="r">' + (x.legs ? fmtInt(rx / x.legs) : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
    // where this network sits against the venture plan
    const yr = v => full ? 'SAR ' + (v * 365 / 1e6).toFixed(0) + 'M' : 'after a full day', P = DECK_PLAN, f1 = v => v < 0 ? '(' + Math.abs(v).toFixed(1) + ')' : v.toFixed(1);
    h += '<h3 class="osec">The network shown here against the venture plan</h3><div class="ocols"><div><table class="ot"><thead><tr><th></th><th class="r">VENTURE PLAN 2031 (A7, A9)</th><th class="r">THIS TWIN, ONE DAY × 365</th></tr></thead><tbody>' +
      uRow('Aircraft operated as a service', '20 on 6 corridors', n + ' on ' + Object.values(sim.routes).filter(R => !R.mro && this.inScope(R.scn)).length + ' corridors') +
      uRow('Defence aircraft sold, with sustainment', '20 in 2031 · 40 over 2028–31', 'not modelled') +
      uRow('Revenue from the service', 'SAR 40M', yr(rev)) + uRow('Direct cost of the service', '—', yr(c.total)) + uRow('Contribution', '—', yr(m)) +
      '</tbody></table><p class="src">This twin shows the network at scale, well beyond the 2031 base case. Overhead (SAR 16.1M in 2031), tax and zakat sit above contribution and are not charged here. Venture equity asked: SAR 48M including a 15% buffer.</p></div>' +
      '<div><table class="ot"><thead><tr><th>VENTURE P&amp;L, SAR M</th>' + P.years.map(y => '<th class="r">' + y + '</th>').join('') + '</tr></thead><tbody>' +
      [['Military aircraft delivered', P.mil, String], ['Commercial aircraft in service', P.com, String], ['Revenue', P.rev, f1], ['Direct costs', P.direct, f1], ['Overhead', P.overhead, f1], ['EBITDA', P.ebitda, f1], ['Net income', P.net, f1]]
        .map(x => '<tr' + (x[0] === 'EBITDA' ? ' class="tot"' : '') + '><td class="w">' + x[0] + '</td>' + x[1].map(v => '<td class="r' + (v < 0 ? ' c-hot' : '') + '">' + (v === 0 && x[2] !== String ? '–' : x[2](v)) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table><p class="src">Base case from the deck, estimated. Cautious case: SAR 0.025 per kg·km, 6 FH a day, 20 military aircraft, SAR 88.6M revenue and SAR 17.5M EBITDA in 2031.</p></div></div>';
    return h;
  }

  chart(L) {
    const vals = []; for (let i = 0; i < 24; i++) { const H = L.hours[i]; vals.push(H ? (this.scope === 'ALL' ? H.tot.rev : (H.scn[this.scope] || { rev: 0 }).rev) : 0); }
    const W = 860, Hh = 200, pl = 58, pb = 20, pt = 10, max = Math.max(1, ...vals), nice = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7].find(v => v * 3 >= max) || max / 3;
    const top = nice * Math.ceil(max / nice), bw = (W - pl) / 24, y = v => pt + (Hh - pt - pb) * (1 - v / top);
    let s = '<svg class="ochart" viewBox="0 0 ' + W + ' ' + Hh + '" width="100%" role="img" aria-label="Revenue by hour">';
    for (let g = 0; g <= top + 1; g += nice) s += '<line x1="' + pl + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#262A31"/><text x="' + (pl - 6) + '" y="' + (y(g) + 3) + '" text-anchor="end">' + inr(g) + '</text>';
    vals.forEach((v, i) => {
      const x = pl + i * bw + 1, h = Math.max(0, y(0) - y(v)), cur = i === L.h, hh = (6 + i) % 24;
      if (v > 0) s += '<path d="M' + x + ',' + y(0) + 'v' + (-Math.max(0, h - 3)) + 'q0,-3 3,-3h' + (bw - 8) + 'q3,0 3,3v' + Math.max(0, h - 3) + 'z" fill="' + (cur ? '#3E5B8C' : '#78AAFF') + '"><title>' + String(hh).padStart(2, '0') + ':00–' + String((hh + 1) % 24).padStart(2, '0') + ':00 · ' + inrFull(v) + (cur ? ' (hour in progress)' : '') + '</title></path>';
      if (i % 3 === 0) s += '<text x="' + (x + bw / 2 - 1) + '" y="' + (Hh - 4) + '" text-anchor="middle">' + String(hh).padStart(2, '0') + '</text>';
    });
    return s + '</svg><p class="src">Lighter bar: hour in progress. Night hours are quiet because airframes stand down for their daily inspection.</p>';
  }

  /* where every airframe is right now */
  fleetPos() {
    const sim = this.sim, fl = sim.aircraft.filter(a => this.inScope(a.scn));
    const isMx = a => (a.phase === 'GROUND' && sim.padOf(a) && sim.padOf(a).step === 'MAINT') || (a.phase === 'REST' && a.mxUntil);
    const air = fl.filter(a => AIRBORNE[a.phase]), rest = fl.filter(a => a.phase === 'REST' && !a.mxUntil), mx = fl.filter(isMx), spare = fl.filter(a => a.phase === 'STANDBY'), pads = fl.filter(a => a.phase === 'GROUND' && !isMx(a));
    const want = SCENARIOS.filter(s => this.inScope(s.id)).reduce((n, s) => n + sim._active(s.id).want, 0);
    let h = '<div class="ogrid">' + [['ROSTER', fl.length - spare.length, spare.length + ' spares on standby'], ['DEMAND NOW', want, Math.round(rosterLevel(sim.t, this.scope === 'ALL' ? 'MM' : this.scope) * 100) + '% of roster wanted on the line'], ['AIRBORNE', air.length, ''], ['ON PADS', pads.length, 'turnarounds and releases'],
      ['STOOD DOWN', rest.length, rest.filter(a => a.restAt === 'HANGAR').length + ' in hangars · ' + rest.filter(a => a.restAt !== 'HANGAR').length + ' on stands, slots or pads · ' + rest.filter(a => sim.t - a.tRest < INSPECT_S).length + ' in daily inspection'], ['IN CHECK', mx.length, 'basic checks: MRO bays and line hangars']].map(c => '<div class="cell"><span class="cap">' + c[0] + '</span><b class="num">' + c[1] + '</b><p>' + c[2] + '</p></div>').join('') + '</div>';
    const ids = Object.keys(sim.sites).filter(id => { const S = sim.sites[id]; return this.inScope(S.scn) && (S.L.hangar || S.stands.length || S.kind === 'MRO' || fl.some(a => a.site === id && (a.phase === 'GROUND' || a.phase === 'REST'))); });
    const order = S => ({ BASE: 0, SHOREBASE: 0, DOCKYARD: 0, MRO: 1 }[S.kind] ?? 2);
    const rows = ids.map(id => sim.sites[id]).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(S => {
      const here = fl.filter(a => a.site === S.id && (a.phase === 'GROUND' || a.phase === 'REST' || a.phase === 'STANDBY')), cap = sim.restCap(S);
      const inH = here.filter(a => a.phase === 'REST' && a.restAt === 'HANGAR' && !a.mxUntil), onS = here.filter(a => (a.phase === 'REST' && a.restAt !== 'HANGAR') || a.phase === 'STANDBY'), chk = here.filter(isMx), onP = here.filter(a => a.phase === 'GROUND' && !isMx(a)), inb = fl.filter(a => AIRBORNE[a.phase] && a.to === S.id).length;
      const cs = l => l.map(a => a.cs.replace(/^LX.-/, '')).join(' ');
      return '<tr><td class="w"><button type="button" class="lnk" data-oact="site" data-v="' + S.id + '">' + esc(S.name) + '</button></td><td>' + kindLabel(S) + '</td><td class="r">' + (cap.hangar ? inH.length + ' / ' + cap.hangar : '—') + '</td><td class="r">' + (S.stands.length ? onS.length + ' / ' + S.stands.length : '—') + '</td><td class="r">' + (S.kind === 'MRO' ? chk.length + ' / ' + S.pads.length : chk.length || '—') + '</td><td class="r">' + onP.length + ' / ' + S.pads.length + '</td><td class="r">' + inb + '</td><td class="c-mute wrap">' + (inH.length ? 'hangar ' + cs(inH) : '') + (onS.length ? (inH.length ? ' · ' : '') + 'stands ' + cs(onS) : '') + (chk.length ? (inH.length || onS.length ? ' · ' : '') + 'check ' + cs(chk) : '') + '</td></tr>';
    });
    // every airframe, one row each: what it is doing now and what it has flown today
    const t0 = sim.led.t0, acRows = fl.slice().sort((p, q) => p.cs.localeCompare(q.cs)).map(a => {
      let n = 0, sec = 0, kg = 0, rev = 0; const hh = a.hist || [];
      for (let i = hh.length - 1; i >= 0; i--) { const e = hh[i]; if (e.t < t0) break; if (e.k !== 'L') continue; n++; sec += e.bl || (e.a ? e.a - e.t : sim.t - e.t); kg += e.kg || 0; rev += e.rev || 0; }
      const st = this.ui.state(a), air = AIRBORNE[a.phase], where = air ? a.from + ' → ' + a.to : a.site || '—';
      const pod = a.pod ? a.pod.kg + ' kg ' + POD_TYPES[a.pod.type].label.toLowerCase() : 'empty pod';
      return '<tr><td class="w"><button type="button" class="lnk" data-oact="ac" data-v="' + a.cs + '">' + a.cs + '</button></td><td>' + a.scn + '</td><td class="c-' + st[1] + '">' + esc(st[0]) + '</td><td>' + esc(where) + '</td><td>' + (a.route || '—') + '</td><td class="c-mute">' + pod + '</td><td class="r">' + n + '</td><td class="r">' + (sec / 3600).toFixed(1) + '</td><td class="r">' + (kg / 1000).toFixed(2) + '</td><td class="r">' + inr(rev) + '</td><td class="r">' + fmtInt(a.fh) + '</td><td class="r">' + Math.max(0, a.nextCheck - a.fh).toFixed(0) + '</td></tr>';
    });
    h += '<h3 class="osec">Aircraft · ' + fl.length + ' airframes</h3><p class="src">Every airframe in the fleet, what it is doing now and what it has flown since 06:00. Click a callsign to follow it on the map.</p>' +
      '<table class="ot"><thead><tr><th>CALLSIGN</th><th>LINE</th><th>NOW</th><th>WHERE / LEG</th><th>CORRIDOR</th><th>POD</th><th class="r">LEGS TODAY</th><th class="r">FH TODAY</th><th class="r">t TODAY</th><th class="r">SAR  TODAY</th><th class="r">TOTAL FH</th><th class="r">FH TO CHECK</th></tr></thead><tbody>' + acRows.join('') + '</tbody></table>' +
      '<h3 class="osec">Where the fleet is parked</h3>';
    h += '<p class="src">Airframes stand down where their last leg ends once demand drops, so no aircraft flies an empty leg home for the night. Line hangars hold ' + LAYOUTS.base.hangar + ' at a base and ' + LAYOUTS.quay.hangar + ' at a shore base; outstations have ' + LAYOUTS.spoke.stands.length + ' night stands. Callsigns are shown by number.</p>' +
      '<table class="ot"><thead><tr><th>SITE</th><th>TYPE</th><th class="r">LINE HANGAR</th><th class="r">STANDS · SLOT · PADS</th><th class="r">IN CHECK</th><th class="r">ON PADS</th><th class="r">INBOUND</th><th>AIRFRAMES HERE</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    return h;
  }

  hubs(L) {
    const sim = this.sim, ids = Object.keys(sim.sites).filter(id => this.inScope(sim.sites[id].scn) && L.site[id]);
    const rows = ids.map(id => [sim.sites[id], L.site[id]]).sort((a, b) => (b[1].revOut + b[1].revIn) - (a[1].revOut + a[1].revIn));
    const T = ledRec(); for (const [, r] of rows) for (const k in T) T[k] += r[k];
    const m3 = r => ((r.podsOut + r.podsIn) * POD.pallets * PALLET_M3).toFixed(0);
    const tr = (S, r, tot) => '<tr' + (tot ? ' class="tot"' : '') + '><td class="w">' + (tot ? 'All sites' : '<button type="button" class="lnk" data-oact="site" data-v="' + S.id + '">' + esc(S.name) + '</button>') + '</td><td>' + (tot ? '' : kindLabel(S)) + '</td><td class="r">' + r.dep + '</td><td class="r">' + r.arr + '</td><td class="r">' + r.podsOut + '</td><td class="r">' + r.podsIn + '</td><td class="r">' + tt(r.kgOut) + '</td><td class="r">' + tt(r.kgIn) + '</td><td class="r">' + tt(r.dryOut + r.dryIn) + '</td><td class="r">' + tt(r.wetOut + r.wetIn) + '</td><td class="r">' + m3(r) + '</td><td class="r w">' + inr(r.revOut) + '</td><td class="r">' + inr(r.revIn) + '</td><td class="r">' + (r.holds || '—') + '</td><td class="r">' + (r.mx || '—') + '</td><td class="r">' + (r.down || '—') + '</td></tr>';
    return '<p class="src">Every site that moved cargo today. Revenue originated is billed to the site the pod left from; delivered is the same revenue seen from the receiving end. Tonnes count both directions; volume uses ' + PALLET_M3.toFixed(2) + ' m³ per pallet.</p>' +
      '<table class="ot"><thead><tr><th>SITE</th><th>TYPE</th><th class="r">DEP</th><th class="r">ARR</th><th class="r">PODS OUT</th><th class="r">PODS IN</th><th class="r">OUT t</th><th class="r">IN t</th><th class="r">DRY t</th><th class="r">WET t</th><th class="r">m³</th><th class="r">SAR  ORIGINATED</th><th class="r">SAR  DELIVERED</th><th class="r">HOLDS</th><th class="r">CHECKS</th><th class="r">STOOD DOWN</th></tr></thead><tbody>' +
      rows.map(([S, r]) => tr(S, r)).join('') + tr(null, T, true) + '</tbody></table>';
  }

  corridors(L) {
    const sim = this.sim, ids = Object.keys(sim.routes).filter(id => this.inScope(sim.routes[id].scn) && !sim.routes[id].mro);
    const rows = ids.map(id => [sim.routes[id], L.route[id] || ledRec()]).sort((a, b) => b[1].rev - a[1].rev), hrs = this.hrsOf(L);
    /* corridor cost: its own flight hours at the deck's hourly cost, its landings, and the line's fixed cost shared by flight hour */
    const fixFh = {}; for (const s of SCENARIOS) { const x = L.scn[s.id]; fixFh[s.id] = x && x.fh ? COST.fixedDay * this.airframes(s.id) * hrs / 24 / x.fh : 0; }
    const cst = (R, r) => r.fh * (COST.varFh + fixFh[R.scn]) + r.arr * COST.landing;
    return '<p class="src">Billed distance is the great-circle distance between the two sites; the corridor flown is longer. Load factor is cargo delivered over ' + L560.payloadKg + ' kg per revenue leg. Direct cost uses the deck\'s SAR ' + COST.varFh + ' an hour of flying cost and SAR ' + COST.landing + ' a landing on the corridor\'s own hours and landings, plus its share of the line\'s fixed cost by flight hour.</p>' +
      '<table class="ot"><thead><tr><th>CORRIDOR</th><th>BETWEEN</th><th class="r">BILLED KM</th><th class="r">FLOWN KM</th><th class="r">DEP</th><th class="r">LEGS</th><th class="r">EMPTY</th><th class="r">PODS</th><th class="r">TONNES</th><th class="r">t·km</th><th class="r">REVENUE</th><th class="r">SAR  / LEG</th><th class="r">LOAD FACTOR</th><th class="r">DIRECT COST</th><th class="r">CONTRIBUTION</th><th class="r">MARGIN</th><th class="r">LATE</th><th class="r">HOLDS</th></tr></thead><tbody>' +
      rows.map(([R, r]) => '<tr><td class="w"><button type="button" class="lnk" data-oact="route" data-v="' + R.id + '">' + R.id + '</button>' + (R.trunk ? ' <span class="c-mute">TRUNK</span>' : '') + '</td><td>' + esc(sim.sites[R.a].name) + ' ↔ ' + esc(sim.sites[R.b].name) + '</td><td class="r">' + Math.round(R.direct) + '</td><td class="r">' + Math.round(R.km) + '</td><td class="r">' + r.dep + '</td><td class="r">' + r.legs + '</td><td class="r">' + r.empty + '</td><td class="r">' + r.pods + '</td><td class="r">' + tt(r.kg) + '</td><td class="r">' + fmtInt(r.tkm) + '</td><td class="r w">' + inr(r.rev) + '</td><td class="r">' + (r.legs ? inr(r.rev / r.legs) : '—') + '</td><td class="r">' + pct(r.kg, r.capKg) + '</td>' + (k => '<td class="r">' + inr(k) + '</td><td class="r w' + mcls(r.rev - k, 1) + '">' + sgn(r.rev - k) + '</td><td class="r' + mcls(r.rev - k, 1) + '">' + pct(r.rev - k, r.rev) + '</td>')(cst(R, r)) + '<td class="r">' + (r.late || '—') + '</td><td class="r">' + (r.holds || '—') + '</td></tr>').join('') + '</tbody></table>';
  }

  hubLog(L) {
    const sim = this.sim;
    const ent = sim.biz.filter(e => (e.kind === 'HUB' && this.inScope(e.scn)) || e.kind === 'DAY');
    const hubs = [...new Set(ent.filter(e => e.kind === 'HUB').map(e => e.site))].sort((a, b) => { const ka = sim.sites[a].kind === 'BASE' || sim.sites[a].kind === 'DOCKYARD' || sim.sites[a].kind === 'SHOREBASE' ? 0 : 1, kb = sim.sites[b].kind === 'BASE' || sim.sites[b].kind === 'DOCKYARD' || sim.sites[b].kind === 'SHOREBASE' ? 0 : 1; return ka - kb || sim.sites[a].name.localeCompare(sim.sites[b].name); });
    if (this.hub !== 'ALL' && !hubs.includes(this.hub)) this.hub = 'ALL';
    // the hour in progress, so the log is never an hour behind
    const H = L.hours[L.h], t0 = L.t0 + L.h * 3600, live = [];
    if (H) for (const id in H.site) { const r = H.site[id], S = sim.sites[id]; if (S && this.inScope(S.scn) && (r.dep || r.arr || r.podsIn || r.podsOut)) live.push({ t: sim.t, kind: 'HUB', scn: S.scn, site: id, win: fmtClock(t0) + '–now', r, notes: '', live: true }); }
    const list = live.concat(ent.slice().reverse()).filter(e => this.hub === 'ALL' || e.kind === 'DAY' || e.site === this.hub).slice(0, 260);
    const chips = '<div class="ochips"><button type="button" data-ohub="ALL"' + (this.hub === 'ALL' ? ' class="on"' : '') + '>ALL HUBS</button>' + hubs.map(id => '<button type="button" data-ohub="' + id + '"' + (this.hub === id ? ' class="on"' : '') + '>' + esc(sim.sites[id].name.replace(/ DC$/, '').toUpperCase()) + '</button>').join('') + '</div>';
    const row = e => {
      if (e.kind === 'DAY') return '<tr class="day"><td colspan="9">' + esc(e.win) + ' closed · ' + inr(e.r.rev) + ' · ' + tt(e.r.kg) + ' t · ' + e.r.pods + ' pods · ' + e.r.legs + ' legs · load factor ' + pct(e.r.kg, e.r.capKg) + '</td></tr>';
      const r = e.r, S = sim.sites[e.site];
      return '<tr' + (e.live ? ' class="live"' : '') + '><td>' + e.win + '</td><td class="w">' + esc(S.name) + '</td><td class="r">' + r.dep + ' / ' + r.arr + '</td><td class="r">' + r.podsOut + ' / ' + r.podsIn + '</td><td class="r">' + tt(r.kgOut) + ' / ' + tt(r.kgIn) + '</td><td class="r">' + tt(r.dryOut + r.dryIn) + ' / ' + tt(r.wetOut + r.wetIn) + '</td><td class="r w">' + (r.revOut ? inr(r.revOut) : '—') + '</td><td class="r">' + (r.revIn ? inr(r.revIn) : '—') + '</td><td class="c-mute">' + (e.notes || (e.live ? 'hour in progress' : '')) + '</td></tr>';
    };
    return this.exports() + chips + '<p class="src">One line per hub per hour: departures and arrivals, pods and tonnes out and in, the dry and wet split, revenue originated and delivered, and anything that held the hub up.</p>' +
      '<table class="ot"><thead><tr><th>HOUR</th><th>HUB</th><th class="r">DEP / ARR</th><th class="r">PODS OUT / IN</th><th class="r">t OUT / IN</th><th class="r">t DRY / WET</th><th class="r">SAR  ORIGINATED</th><th class="r">SAR  DELIVERED</th><th>NOTES</th></tr></thead><tbody>' +
      (list.length ? list.map(row).join('') : '<tr><td colspan="9">Nothing logged yet.</td></tr>') + '</tbody></table>';
  }

  exports() { return '<div class="btns" style="justify-content:flex-start">' + [['days', 'DAILY CLOSE'], ['legs', 'EVERY LEG FLOWN'], ['hubs', 'HUB LOG']].map(x => '<button type="button" class="btn ghost" data-oact="csv" data-v="' + x[0] + '">DOWNLOAD ' + x[1] + ' (CSV)</button>').join('') + '</div>'; }
  exportCsv(kind) {
    const sim = this.sim, ui = this.ui, L = sim.led;
    if (kind === 'legs') return ui.download('logixair-legs-day' + dayOf(sim.t) + '.csv', ui.csv(ui.legRows(sim.aircraft)));
    if (kind === 'days') {
      const rows = [['day', 'date', 'line', 'revenue_inr', 'dry_inr', 'wet_inr', 'tonnes', 'tonne_km', 'pods', 'legs', 'empty_legs', 'load_factor', 'flight_hours', 'late', 'holds', 'status']];
      const add = (day, t0, rec, open) => { for (const k of ['ALL'].concat(Object.keys(rec.scn))) { const r = k === 'ALL' ? rec.tot : rec.scn[k]; rows.push([day + 1, dateOf(t0), k === 'ALL' ? 'all lines' : LINE_NAME[k] || k, Math.round(r.rev), Math.round(r.revDry), Math.round(r.revWet), (r.kg / 1000).toFixed(2), Math.round(r.tkm), r.pods, r.legs, r.empty, r.capKg ? (r.kg / r.capKg).toFixed(3) : '', r.fh.toFixed(1), r.late, r.holds, open ? 'open' : 'closed']); } };
      for (const d of sim.days) add(d.day, d.t0, d, false); add(L.day, L.t0, L, true);
      return ui.download('logixair-daily-close.csv', ui.csv(rows));
    }
    const rows = [['day', 'hour', 'hub', 'line', 'departures', 'arrivals', 'pods_out', 'pods_in', 'kg_out', 'kg_in', 'dry_kg', 'wet_kg', 'revenue_originated_inr', 'revenue_delivered_inr', 'notes']];
    for (const e of sim.biz) if (e.kind === 'HUB') { const r = e.r; rows.push([e.day + 1, e.win, sim.sites[e.site] ? sim.sites[e.site].name : e.site, LINE_NAME[e.scn] || e.scn, r.dep, r.arr, r.podsOut, r.podsIn, Math.round(r.kgOut), Math.round(r.kgIn), Math.round(r.dryOut + r.dryIn), Math.round(r.wetOut + r.wetIn), Math.round(r.revOut), Math.round(r.revIn), e.notes]); }
    return ui.download('logixair-hub-log.csv', ui.csv(rows));
  }
  close(L) {
    const sim = this.sim, pick = d => this.scope === 'ALL' ? d.tot : (d.scn[this.scope] || ledRec());
    const days = sim.days.map(d => ({ day: d.day, r: pick(d), done: true })).concat([{ day: L.day, r: this.dayRec(L), done: false }]).reverse();
    return this.exports() + '<p class="src">Operating days run 06:00 to 06:00 AST, starting with day 1 on 25 Oct 2026; one simulated day is one calendar day, and the shared record is flown forward every hour by the backend, so every viewer opens on today. Every closed day is archived for good in the repository (<a href="' + REC.logs + '" target="_blank" rel="noopener">logs/</a>: one JSON file per day with every leg, plus days.csv). The current day is still open.</p><table class="ot"><thead><tr><th>DAY</th><th class="r">REVENUE</th><th class="r">DRY</th><th class="r">WET</th><th class="r">TONNES</th><th class="r">t·km</th><th class="r">PODS</th><th class="r">LEGS</th><th class="r">EMPTY</th><th class="r">LOAD FACTOR</th><th class="r">FH</th><th class="r">SAR  / FH</th><th class="r">DIRECT COST</th><th class="r">CONTRIBUTION</th><th class="r">MARGIN</th><th class="r">ON TIME</th><th class="r">HOLDS</th></tr></thead><tbody>' +
      days.map(d => { const r = d.r, c = costOf(r, this.airframes(), d.done ? 24 : this.hrsOf(L)), m = r.rev - c.total; return '<tr><td class="w">Day ' + (d.day + 1) + ' · ' + dateOf(6 * 3600 + d.day * 86400) + (d.done ? '' : ' · open') + '</td><td class="r w">' + inr(r.rev) + '</td><td class="r">' + inr(r.revDry) + '</td><td class="r">' + inr(r.revWet) + '</td><td class="r">' + tt(r.kg) + '</td><td class="r">' + fmtInt(r.tkm) + '</td><td class="r">' + r.pods + '</td><td class="r">' + r.legs + '</td><td class="r">' + pct(r.empty, r.legs) + '</td><td class="r">' + pct(r.kg, r.capKg) + '</td><td class="r">' + fmtInt(r.fh) + '</td><td class="r">' + (r.fh ? inr(r.rev / r.fh) : '—') + '</td><td class="r">' + inr(c.total) + '</td><td class="r w' + mcls(m, 1) + '">' + sgn(m) + '</td><td class="r' + mcls(m, 1) + '">' + pct(m, r.rev) + '</td><td class="r">' + pct(r.legs - r.late, r.legs) + '</td><td class="r">' + r.holds + '</td></tr>'; }).join('') + '</tbody></table>';
  }
}
