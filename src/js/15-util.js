/* ---------- maths, geodesy and formatting helpers ---------- */
const DEG = Math.PI / 180, FT = 0.3048, KT = 0.514444;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const wrap180 = d => ((d + 540) % 360) - 180;
const wrap360 = d => ((d % 360) + 360) % 360;

/* the simulation's own generator: same sequence as mulberry32, with its state exposed so a snapshot can resume it */
function seededRng(seed) {
  const st = { a: seed >>> 0 };
  const f = function () {
    let a = st.a | 0; a = a + 0x6D2B79F5 | 0; st.a = a;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  f.state = st; return f;
}
/* operating days run 06:00 to 06:00 AST; day 1 began on 25 Oct 2026 */
const DAY1 = { y: 2026, m: 9, d: 25 };
const dayOf = t => Math.floor((t - 6 * 3600) / 86400) + 1;
const dateOf = t => { const d = new Date(Date.UTC(DAY1.y, DAY1.m, DAY1.d) + Math.floor(t / 86400) * 86400000); return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; };
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const KM_LAT = 110.574, KM_LON = 111.320;
/* great-circle distance, km */
function distKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dp = p2 - p1, dl = (lon2 - lon1) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 12742.02 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* initial bearing, degrees clockwise from north */
function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) / DEG);
}
/* small-step move on a local tangent plane: fine for steps of metres to a few km */
function moveLL(lat, lon, brgDeg, km) {
  const b = brgDeg * DEG;
  return [lat + km * Math.cos(b) / KM_LAT, lon + km * Math.sin(b) / (KM_LON * Math.cos(lat * DEG))];
}

const pad2 = n => (n < 10 ? '0' : '') + n;
function fmtClock(sec, withSec) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return pad2(h) + ':' + pad2(m) + (withSec ? ':' + pad2(s) : '');
}
function fmtDur(sec) {
  if (!isFinite(sec) || sec < 0) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + pad2(m % 60);
}
function fmtMS(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
const fmtInt = n => Math.round(n).toLocaleString('en-US');
function fmtLL(lat, lon) {
  const f = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return pad2(d) + '°' + m.toFixed(2).padStart(5, '0') + '′' + (v >= 0 ? p : n); };
  return f(lat, 'N', 'S') + ' ' + f(lon, 'E', 'W');
}
