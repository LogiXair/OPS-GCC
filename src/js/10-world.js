/* ============================================================================
   WORLD CONFIG — the one block to edit when real routes, sites or numbers change.
   Every value carries where it came from:
     [thesis]  thesis.logixair.com (DOC LX-001 rev 6.0)
     [conops]  LogiXair Regulatory Framework & ConOps
     [vector]  LogiXair Vector consoles (vector-core.js)
     [mro]     LogiXair MRO calculator
     [deck]    LogiXair × Saudi Brothers partnership presentation, Oct 2026
     [model]   modelling assumption made for this twin, not a LogiXair figure
   ========================================================================== */

const L560 = {
  payloadKg: 300,        // [thesis]
  rangeKm: 750,          // [LogiXair, Oct 2026] Gulf configuration; 600 km in the thesis
  mtowKg: 1600,          // [deck] about 1.6 t: registered as an aircraft under GACAR Part 47
  fuelLph: 30,           // [deck] hybrid-electric on common fuels, 30 litres per flight hour
  cruiseKmh: 250,        // [conops]
  footprintM: [7, 5],    // [thesis]
  rotors: '6+2',         // [thesis] 4 on the front tilt-wing, 2 on the rear, 2 fixed on the centreline (Fig. 01)
  // [model] flight-profile values the documents do not state
  hoverAltM: 45, liftMs: 2.5, landMs: 1.8, transSpeedMs: 50, transOutS: 26, transInS: 34,
  climbMs: 5.0, accelMs2: 0.6, bankDeg: 25, reservePct: 20
};

const CORRIDOR = {
  halfWidthM: 500,       // [conops] lateral box ±500 m
  floorFt: 1000,         // [conops]
  ceilFt: 6000,          // [conops]
  baseLevelFt: 2200,     // [conops] operating 2,200-2,500 ft
  sepVertFt: 200,        // [vector] vertical minimum
  sepTrailKm: 3.0,       // [vector] longitudinal minimum
  holdRadiusKm: 1.2,     // [vector] hold = 1.2 km orbit
  pilotMax: 15,          // [vector] aircraft per supervisory pilot
  groundLinkKm: 90       // [model] ground C2 reach before SATCOM backup takes over
};

/* Pod and pallet standard. Two pallets per pod is LogiXair's figure; the EUR 1200 x 800 mm footprint is [model]. */
/* Pod: 2.10 x 1.75 x 1.75 m outside, two pallets in tandem [LogiXair]. EUR footprint, wall allowance and load height are [model]. */
const POD = { pallets: 2, palletMm: [1200, 800], lenM: 2.10, widthM: 1.75, heightM: 1.75, loadHm: 1.45 };
const PODY = 0.60;                // pod underside above ground on the aircraft [model]
const AIRFRAME_DY = PODY + POD.heightM - 1.50;   // airframe raised so the pod top meets the spine
const PALLET_M3 = POD.palletMm[0] * POD.palletMm[1] / 1e6 * POD.loadHm;
/* Dock reporting splits cargo in two: wet = temperature-controlled or liquid; everything else moves as dry [model]. */
const WET_TYPES = { COLD: 1, LIQ: 1 };
/* Pod loading at the truck dock, seconds of simulated time [model]: vehicle in, one forklift cycle per pallet, vehicle out. */
const DOCK = { vIn: 52, move: 44, vOut: 50 };
const MX = { basicFh: 175, fullFh: 850, lifeFh: 20000, basicDurS: 3 * 3600 };  // [mro]; duration [model]

/* Tariff [deck]: SAR 0.030 per kg·km (base case), SAR 0.025 in the cautious case; one rate for dry and chilled pods.
   Billed on the great-circle distance between the two sites at delivery [model]; maintenance ferries and empty legs earn nothing.
   Offshore is priced per sortie [deck: "per-sortie pricing"]; the SAR 1,500 figure is a placeholder [model], about a quarter of
   what a helicopter costs for the same load (SAR 31/kg × 217.5 kg ≈ SAR 6,700 at 90 km [deck]). */
const TARIFF = { DRY: 0.030, WET: 0.030, CAUTIOUS: 0.025, SORTIE: { OF: 1500 } };
/* Operating cost of the aircraft [deck, A5]: SAR 848 per flight hour at 6 FH a day, 300 days a year, plus SAR 340 per landing
   (battery reserve, handling and site fees). Ownership, insurance and the operations centre do not change with hours flown,
   so the twin charges them per airframe per calendar day (SAR/FH × 1,800 FH ÷ 365) and the rest per hour flown. */
const COST = {
  fh: { fuel: 60, mx: 210, pilot: 113, satcom: 25 },          // SAR per flight hour: fuel 30 L × SAR 2.00, maintenance and powertrain reserve, remote pilot, satellite datalink
  fixedFh: { own: 227, ins: 113, ops: 100 },                  // SAR per flight hour at the deck's 1,800 FH a year: depreciation, hull and liability, ops centre and software
  basisFhYr: 1800, landing: 340, unitSar: 2.7e6,              // aircraft unit cost, early Saudi-built units, 1.6× the India cost
  deckLoadKg: 217.5, heliSarH: 11000, roadSarKm: 4,           // average load; helicopter and road comparisons (estimates in the deck)
  LABEL: { own: 'Aircraft ownership (depreciation)', ins: 'Insurance, hull and liability', ops: 'Operations centre and software', fuel: 'Fuel, 30 L at SAR 2.00', mx: 'Maintenance and powertrain reserve', pilot: 'Remote pilot', satcom: 'Satellite datalink', landing: 'Landings: battery reserve, handling, site fees' }
};
COST.fixedDay = (COST.fixedFh.own + COST.fixedFh.ins + COST.fixedFh.ops) * COST.basisFhYr / 365;    // per airframe per day
COST.varFh = COST.fh.fuel + COST.fh.mx + COST.fh.pilot + COST.fh.satcom;
COST.deckFh = COST.varFh + COST.fixedFh.own + COST.fixedFh.ins + COST.fixedFh.ops;                     // 848
/* direct cost of a ledger record: hours flown, landings, and the fleet's fixed cost for the hours elapsed */
function costOf(r, airframes, hours) {
  const d = hours / 24, k = airframes * COST.basisFhYr / 365 * d, c = {
    own: k * COST.fixedFh.own, ins: k * COST.fixedFh.ins, ops: k * COST.fixedFh.ops,
    fuel: r.fh * COST.fh.fuel, mx: r.fh * COST.fh.mx, pilot: r.fh * COST.fh.pilot, satcom: r.fh * COST.fh.satcom, landing: r.arr * COST.landing };
  c.fixed = c.own + c.ins + c.ops; c.variable = c.fuel + c.mx + c.pilot + c.satcom + c.landing; c.total = c.fixed + c.variable; return c;
}
/* revenue at another kg·km price: per-sortie revenue does not move with the tariff */
const revAt = (r, price) => (r.rev - (r.revSortie || 0)) * price / TARIFF.DRY + (r.revSortie || 0);
/* the deck's sortie cost: SAR 340 a landing plus SAR 848 an hour over 0.25 h of ground, climb and approach and the leg at 220 km/h block speed */
const deckSortie = km => COST.landing + COST.deckFh * (0.25 + km / 220);

/* Demand: share of each line's roster wanted in the air, hour by hour (AST) [model] — a peak from 10:00 to 15:00,
   a long evening taper and a thin night service. Airframes not needed stand down wherever their last leg ended:
   in the base line hangar (limited slots), on a stand, or on an outstation's night stand. No positioning legs. */
const DEMAND = [0.15, 0.13, 0.12, 0.12, 0.15, 0.24, 0.38, 0.52, 0.66, 0.8, 0.95, 0.97, 0.97, 0.96, 0.94, 0.82, 0.7, 0.6, 0.5, 0.42, 0.34, 0.27, 0.21, 0.17];
/* offshore flies in daylight only; the navy runs a steady round-the-clock service */
const DEMAND_OF = [0, 0, 0, 0, 0, 0.3, 0.75, 0.9, 0.95, 0.97, 0.97, 0.97, 0.97, 0.97, 0.95, 0.92, 0.88, 0.7, 0.35, 0, 0, 0, 0, 0];     // first light about 05:45, last landing before 18:30 AST
const DEMAND_NV = [0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.6, 0.8, 0.9, 1, 1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.6, 0.5, 0.5, 0.4, 0.4];
/* local hour of a line: sim time is AST; a line abroad keeps its own clock (tz = hours ahead of AST) */
const TZ = {};
const hodOf = (t, scn) => { if (TZ[scn] == null) { const d = SCENARIOS.find(x => x.id === scn); TZ[scn] = d && d.tz ? d.tz : 0; } return (((t / 3600 + TZ[scn]) % 24) + 24) % 24; };
const DAYLIGHT_OPS = { OF: 1, RS: 1, DS: 1 };            // offshore, island and desert camp work runs in daylight
const demandAt = (t, scn) => { const D = DAYLIGHT_OPS[scn] ? DEMAND_OF : scn === 'NV' ? DEMAND_NV : DEMAND, h = hodOf(t, scn), i = Math.floor(h), f = h - i; return D[i] * (1 - f) + D[(i + 1) % 24] * f; };

/* Day-to-day variation [model]: no two days carry the same cargo. Each operating day gets a factor from its weekday,
   steady growth, the shopping and festival calendar of the market, and an unexplained day-to-day swing; each warehouse
   and corridor gets its own daily factor on top, and the hour carries a little noise. All deterministic from the date,
   so every viewer and the backend runner compute the same day. */
const hash01 = (...k) => { let h = 2166136261; for (const v of k) { const s = String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 0x2f; h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
const WEEKDAY = [1.05, 1.06, 1.04, 1.03, 1.08, 0.66, 0.84];                 // Sunday .. Saturday: the Saudi weekend is Friday and Saturday
const EVENTS = {                                                           // [first day, last day, factor], dates of the operating day
  MM: [['2026-11-26', '2026-11-29', 1.28, 'White Friday sales'], ['2026-12-02', '2026-12-03', 0.74, 'UAE National Day'], ['2026-12-10', '2026-12-31', 1.08, 'Riyadh Season peak'],
       ['2027-02-08', '2027-03-09', 0.92, 'Ramadan'], ['2027-02-22', '2027-02-22', 0.70, 'Saudi Founding Day'], ['2027-03-10', '2027-03-13', 0.55, 'Eid al-Fitr']],
  RS: [['2026-12-15', '2027-01-05', 1.25, 'winter season, resorts full']]
};
const dayDate = day => new Date(Date.UTC(2026, 9, 25) + (day - 1) * 86400000);
function dayEvent(day, scn) { const k = dayDate(day).toISOString().slice(0, 10); for (const e of EVENTS[scn] || []) if (k >= e[0] && k <= e[1]) return e; return null; }
const _DF = {};
function dayFactor(day, scn) {
  const key = scn + day; if (_DF[key] != null) return _DF[key];
  return (_DF[key] = dayFactor0(day, scn));
}
function dayFactor0(day, scn) {
  const swing = hash01('day', scn, day);
  if (scn === 'NV') return 0.94 + 0.12 * swing;
  if (scn === 'OF') return 0.9 + 0.18 * swing;
  const e = dayEvent(day, scn), grow = 1 + Math.min(0.6, 0.0035 * Math.max(0, day - 1));
  return WEEKDAY[dayDate(day).getUTCDay()] * grow * (0.86 + 0.28 * swing) * (e ? e[2] : 1);
}
const _LF = {};
const laneFactor = (day, key) => { const k = key + '|' + day; return _LF[k] != null ? _LF[k] : (_LF[k] = 0.68 + 0.64 * hash01('lane', key, day)); };
function hourNoise(t, scn) { const h = t / 3600, i = Math.floor(h), f = h - i, a = hash01('h', scn, i), b = hash01('h', scn, i + 1); return 0.9 + 0.2 * (a + (b - a) * f * f * (3 - 2 * f)); }
/* demand level now: the hourly curve times the day and the hour's noise; above 1 means more cargo than the roster can lift */
const _DL = {};
const demandLevel = (t, scn) => { const q = Math.floor(t / 15), c = _DL[scn]; if (c && c.q === q) return c.v; const v = demandAt(q * 15, scn) * dayFactor(Math.floor((q * 15 - 6 * 3600) / 86400) + 1, scn) * hourNoise(q * 15, scn); _DL[scn] = { q, v }; return v; };
/* Consignments [model]: a pod consolidates parcels and part-loads, 2 to 35 kg mostly, some 35 to 120 kg, a few up to a full 300 kg pallet pair. */
const CONSIGN = { small: 0.55, medium: 0.35 };
/* Operating rules [LogiXair]: a pod is dispatched at least 75% full (consolidated, hold-for-load), and each airframe flies
   10 to 12 hours a day; the day-to-day swing in cargo shows up inside those bands. Prices stay at the tariff. */
const RULES = { minFill: 0.75, maxFill: 0.92, fhDay: [10, 12], lift: { MM: 1.16, OF: 1.75, RS: 1.75, DS: 1.75 } };
/* roster share wanted at this hour: the hourly curve, lifted so the fleet averages 10-12 FH a day, with the day's swing kept inside that band */
const rosterLevel = (t, scn) => { const d = demandLevel(t, scn) / Math.max(0.05, demandAt(t, scn)), k = clamp(0.92 + 0.22 * (d - 0.8) / 0.5, 0.92, 1.14); return Math.min(1, demandAt(t, scn) * k * (RULES.lift[scn] || 1.12)); };
/* Each rest includes the daily inspection; a duty runs at most maxFh before the airframe must stand down [model]. */
/* A check due within mxWindowFh is pulled forward and done overnight: at the MRO hub when it is close to the base (mroNearKm), else in the base line hangar [model]. */
const DUTY = { maxFh: 12, minRestS: 4 * 3600, minDutyFh: 1.5, mxWindowFh: 50, mroNearKm: 80, lineCheckS: 2.5 * 3600 };
/* C2: ground stations about every c2SpacingKm along a land corridor; handoff when another station is nearer by c2HystKm [model]. */
const C2 = { spacingKm: 60, hystKm: 5, satKm: 90 };
/* Truck arrivals at each warehouse dock, per hour at full demand [model]; they keep coming at night, just fewer. */
const TRUCKS = { base: 14, spoke: 3, quay: 6, stagedBase: 8, stagedSpoke: 3 };
/* Cargo mix: dry 20% above wet across all lines [LogiXair] — wet share = 1 / 2.2 of consignments. */
const CARGO_MIX = { wet: 1 / 2.2, OF: 1 / 2.7 };                     // offshore: dry 1.7x wet [LogiXair]

/* Surface-mode comparison speeds. Road: 500 km in 16 h [thesis]. Boat: 12 kt supply run [model]. */
const SURFACE = { roadKmh: 31.25, boatKmh: 22.2 };
/* Surface comparison per corridor: road distance (km) and typical driving time (s) between the two sites, entered from
   typical Google Maps figures (estimates, Oct 2026), including the border crossing on cross-border legs (Bahrain causeway,
   Qatar, Kuwait, Oman). The Empty Quarter camps have no road: a desert track at about 25 km/h. Island and offshore legs
   compare with a supply boat. */
const ROAD_TRAFFIC = 1;
const ROAD = { 'R-11': [110, 4860], 'R-14': [345, 12600], 'R-17': [330, 12060], 'R-21': [300, 10980], 'R-24': [190, 7200], 'T-10': [410, 14400], 'J-11': [85, 4500], 'J-14': [420, 15300], 'J-17': [170, 8100], 'J-21': [340, 12600], 'J-24': [400, 18000], 'J-31': [120, 4860], 'L-03': [300, 16200], 'D-11': [95, 3600], 'D-14': [300, 10800], 'D-17': [430, 16200], 'D-21': [70, 6300], 'D-24': [400, 18900], 'D-27': [155, 6120], 'D-31': [400, 18000], 'T-11': [190, 9000], 'T-14': [180, 7200], 'T-17': [290, 11700], 'T-21': [260, 9900], 'U-11': [130, 5400], 'U-14': [140, 6300], 'U-17': [150, 6300], 'U-21': [260, 12600], 'U-24': [450, 18900], 'U-10': [110, 4860], 'A-11': [240, 9000], 'A-14': [150, 6120], 'L-01': [330, 13500], 'L-02': [570, 27000], 'S-17': [75, 3600], 'S-19': [140, 6120], 'E-11': [230, 9720], 'E-13': [220, 9000], 'E-15': [90, 4500], 'E-17': [130, 6120], 'E-21': [260, 36000], 'E-23': [280, 39600] };
const BORDER_LEGS = new Set(['D-21', 'D-24', 'D-31', 'U-21', 'U-24', 'L-02']), TRACK_LEGS = new Set(['E-21', 'E-23']);
const FERRY_LEGS = new Set();
function surfaceOf(R) {
  const r = ROAD[R.id], fy = FERRY_LEGS.has(R.id);
  if (r && fy) {                       // island leg: the routed road + ferry trip, or a direct RoRo / cargo sailing if that is quicker [model: 12 kt, 6 h in port]
    const seaKm = R.direct * 1.15, seaS = seaKm / SURFACE.boatKmh * 3600 + 6 * 3600;
    return seaS < r[1] ? { km: seaKm, s: seaS, mode: 'SEA FREIGHT' } : { km: r[0], s: r[1], mode: 'ROAD + FERRY' };
  }
  if (r) return { km: r[0], s: r[1] * ROAD_TRAFFIC, mode: TRACK_LEGS.has(R.id) ? 'DESERT TRACK' : BORDER_LEGS.has(R.id) ? 'ROAD + BORDER' : 'BY ROAD' };
  return { km: R.km, s: R.km / SURFACE.boatKmh * 3600, mode: 'BY BOAT' };
}


/* Ground handling, seconds of simulated time [model]; pod swap stays under the 10-minute figure [thesis]. */
const TURN = {
  land:  { SAFE: 45, POD_OUT: 150, POD_IN: 210, FUEL: 220, PREFLIGHT: 90 },
  deck:  { SAFE: 60, POD_OUT: 130, POD_IN: 170, FUEL: 0,   PREFLIGHT: 70 }
};

/* Site layouts in metres, site-local: x east, z south, origin at the site reference point. */
const LAYOUTS = {
  base: {
    pads: [
      { id: 'P1', x: -33, z: -24, hdg: 0 }, { id: 'P2', x: -11, z: -24, hdg: 0 }, { id: 'P3', x: 11, z: -24, hdg: 0 }, { id: 'P4', x: 33, z: -24, hdg: 0 },
      { id: 'P5', x: -33, z: 24, hdg: 180 }, { id: 'P6', x: -11, z: 24, hdg: 180 }, { id: 'P7', x: 11, z: 24, hdg: 180 }, { id: 'P8', x: 33, z: 24, hdg: 180 }
    ],
    doors: [[-33, -5], [-11, -5], [11, -5], [33, -5], [-33, 5], [-11, 5], [11, 5], [33, 5]],
    lanes: [{ z: -37, home: 50, pads: [0, 1, 2, 3] }, { z: 37, home: 50, pads: [4, 5, 6, 7] }],
    stands: [{ x: -62, z: -33, hdg: 90 }, { x: -48, z: -33, hdg: 90 }, { x: -62, z: 33, hdg: 90 }, { x: -48, z: 33, hdg: 90 }],
    hangar: 30, padElev: 0,
    /* pod loading at the cross-dock's west doors: pod position, d = unit vector from pod to vehicle, into = retract direction */
    dock: (function () {
      const lead = [[-122.4, -130], [-122.4, -26], [-121, -11], [-117.5, -5], [-113, -4.5], [-110, -8], [-109, -22], [-108.2, -29.5], [-105, -33.5], [-101.8, -29.5], [-101, -24]];
      const tail = [[-101, 26], [-102, 31], [-105.3, 34.6], [-108.6, 31], [-109.3, 22], [-110, 10], [-113.5, 4.6], [-120, 4.2], [-122.4, 14], [-122.4, 140]];
      return [
        { x: -80.5, z: -11, d: [-1, 0], into: [1, 0], bay: [-93, -11], pathIn: lead.concat([[-100.2, -21], [-95, -17.5], [-93, -14.5], [-93, -11]]), pathOut: [[-93, -11], [-93, -8], [-95, -3.5], [-100, 1], [-101, 8]].concat(tail) },
        { x: -80.5, z: 11, d: [-1, 0], into: [1, 0], bay: [-93, 11], pathIn: lead.concat([[-101, -10], [-100.4, 0], [-96, 5.5], [-93, 8], [-93, 11]]), pathOut: [[-93, 11], [-93, 14], [-95.5, 18.5], [-100.3, 22]].concat(tail) }
      ];
    })()
  },
  spoke: {
    pads: [{ id: 'P1', x: 0, z: -12, hdg: 0 }, { id: 'P2', x: 0, z: 12, hdg: 180 }],         // two 10 x 10 m pads either side of the pod dock: a compact yard
    doors: [[0, -4], [0, 4]],
    lanes: [{ z: -21, home: 18, pads: [0] }, { z: 21, home: 18, pads: [1] }],
    stands: [{ x: 21, z: 0, hdg: 270 }],                // one parking slot beside the pads; a warehouse yard has no room for more
    hangar: 0, padElev: 0,
    dock: [
      { x: -40, z: -33, d: [0, -1], into: [0, 1], bay: [-40, -42.5],
        pathIn: [[-122.4, -130], [-122.4, -26], [-121, -11], [-117.5, -5], [-112, -4.8], [-106, -8], [-102, -18], [-101, -34], [-97, -45], [-88, -48.5], [-70, -48.5], [-54, -46.5], [-45, -42.5], [-40, -42.5]],
        pathOut: [[-40, -42.5], [-35, -42.5], [-28, -45], [-22.5, -50.5], [-21, -56], [-25, -61], [-34, -62.5], [-90, -62.5], [-100, -60], [-107, -52], [-108.5, -36], [-108.5, -12], [-110, -2], [-114, 4], [-120, 4.2], [-122.4, 14], [-122.4, 140]] }
    ]
  },
  mro: {
    pads: [{ id: 'M1', x: -33, z: 12, hdg: 180 }, { id: 'M2', x: -11, z: 12, hdg: 180 }, { id: 'M3', x: 11, z: 12, hdg: 180 }, { id: 'M4', x: 33, z: 12, hdg: 180 }],
    doors: [[-33, -10], [-11, -10], [11, -10], [33, -10]],
    lanes: [{ z: 26, home: 54, pads: [0, 1, 2, 3] }],
    stands: [], hangar: 50, padElev: 0
  },
  quay: {
    pads: [{ id: 'Q1', x: -22, z: 0, hdg: 180 }, { id: 'Q2', x: 0, z: 0, hdg: 180 }, { id: 'Q3', x: 22, z: 0, hdg: 180 }, { id: 'Q4', x: 44, z: 0, hdg: 180 }, { id: 'Q5', x: 66, z: 0, hdg: 180 }],
    doors: [[-22, -20], [0, -20], [22, -20], [44, -20], [66, -20]],
    lanes: [{ z: 12, home: -40, pads: [0, 1, 2, 3, 4] }],
    stands: [], hangar: 16, padElev: 0
  },
  ship: {
    pads: [{ id: 'DECK', x: 0, z: 43, hdg: 0 }],
    doors: [[0, 27]],
    lanes: [], stands: [], padElev: 8.5, app: 180, dep: 310
  },
  platform: {
    pads: [{ id: 'HELI', x: 36, z: 0, hdg: 90 }],
    doors: [[25.5, 0]],
    lanes: [], stands: [], padElev: 38, app: 90, dep: 55
  }
};

const SCENARIOS = [
  {
    id: 'MM', region: 'IN', name: 'Gulf middle-mile', sub: 'Saudi Arabia · UAE · Oman', stage: 'STAGE 01 · MIDDLE-MILE', color: '#78AAFF', prefix: 'LXG', csBase: 1000,
    blurb: 'Four Saudi bases at Riyadh, Jeddah, Dammam and Tabuk and two UAE bases at Jebel Ali and Abu Dhabi serve 30 distribution centres and ports, with cross-border lines to Bahrain, Qatar, Kuwait and Oman. Desert distances are long and roads empty: the aircraft saves hours on every leg.',
    view: { lat: 24.20, lon: 46.60, dist: 4300, az: 0, tilt: 62 },
    zones: { SA: { name: 'Saudi Arabia', lat: 24.2, lon: 44.8, dist: 3600 }, AE: { name: 'UAE · Oman', lat: 24.6, lon: 55.6, dist: 1500 } },
    surface: 'road',
    sites: [
      // Saudi Arabia,
      { id: 'RUH', name: 'Riyadh Base', kind: 'BASE', layout: 'base', lat: 24.800, lon: 46.750, npads: 8, refuel: true, band: 2200, spares: 2, roc: true, zone: 'SA', src: 'model' },
      { id: 'JED', name: 'Jeddah Base', kind: 'BASE', layout: 'base', lat: 21.620, lon: 39.200, npads: 8, refuel: true, band: 3400, spares: 2, zone: 'SA', src: 'model' },
      { id: 'DMM', name: 'Dammam Base', kind: 'BASE', layout: 'base', lat: 26.400, lon: 50.100, npads: 8, refuel: true, band: 4600, spares: 2, zone: 'SA', src: 'model' },
      { id: 'TUU', name: 'Tabuk Base', kind: 'BASE', layout: 'base', lat: 28.380, lon: 36.600, npads: 8, refuel: true, band: 2200, spares: 1, zone: 'SA', src: 'model' },
      { id: 'MRO-R', name: 'MRO Hub Riyadh', kind: 'MRO', layout: 'mro', lat: 24.950, lon: 46.620, npads: 4, refuel: true, zone: 'SA', src: 'model' },
      { id: 'KHJ', name: 'Al Kharj DC', kind: 'DC', layout: 'spoke', lat: 24.150, lon: 47.310, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'BDY', name: 'Buraydah DC · Qassim', kind: 'DC', layout: 'spoke', lat: 26.330, lon: 43.970, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'HOF', name: 'Hofuf DC · Al Ahsa', kind: 'DC', layout: 'spoke', lat: 25.380, lon: 49.590, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'DWD', name: 'Dawadmi DC', kind: 'DC', layout: 'spoke', lat: 24.500, lon: 44.390, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'MJM', name: 'Majmaah DC', kind: 'DC', layout: 'spoke', lat: 25.900, lon: 45.340, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'MAK', name: 'Makkah DC', kind: 'DC', layout: 'spoke', lat: 21.390, lon: 39.860, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'MED', name: 'Madinah DC', kind: 'DC', layout: 'spoke', lat: 24.470, lon: 39.610, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'TIF', name: 'Taif DC', kind: 'DC', layout: 'spoke', lat: 21.270, lon: 40.420, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'YNB', name: 'Yanbu Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 24.090, lon: 38.060, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'ABT', name: 'Al Baha DC', kind: 'DC', layout: 'spoke', lat: 20.010, lon: 41.470, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'AHB', name: 'Abha DC', kind: 'DC', layout: 'spoke', lat: 18.220, lon: 42.500, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'RAB', name: 'KAEC Port DC · Rabigh', kind: 'DC', layout: 'spoke', port: true, lat: 22.450, lon: 39.120, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'JUB', name: 'Jubail Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 27.010, lon: 49.620, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'KHF', name: 'Khafji DC', kind: 'DC', layout: 'spoke', lat: 28.430, lon: 48.490, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'HBT', name: 'Hafar Al Batin DC', kind: 'DC', layout: 'spoke', lat: 28.430, lon: 45.960, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'BAH', name: 'Manama DC · Bahrain', kind: 'DC', layout: 'spoke', port: true, lat: 26.220, lon: 50.590, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'DOH', name: 'Doha DC · Qatar', kind: 'DC', layout: 'spoke', port: true, lat: 25.290, lon: 51.530, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'KWI', name: 'Kuwait City DC', kind: 'DC', layout: 'spoke', port: true, lat: 29.370, lon: 47.980, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'NEO', name: 'NEOM DC', kind: 'DC', layout: 'spoke', lat: 28.000, lon: 35.250, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'DUB', name: 'Duba Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 27.350, lon: 35.700, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'ULH', name: 'AlUla DC', kind: 'DC', layout: 'spoke', lat: 26.620, lon: 37.920, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'TYM', name: 'Tayma DC', kind: 'DC', layout: 'spoke', lat: 27.630, lon: 38.550, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      // UAE and Oman,
      { id: 'DXB', name: 'Jebel Ali Base', kind: 'BASE', layout: 'base', lat: 24.980, lon: 55.100, npads: 8, refuel: true, band: 2200, spares: 2, roc: true, zone: 'AE', src: 'model' },
      { id: 'AUH', name: 'Abu Dhabi Base', kind: 'BASE', layout: 'base', lat: 24.330, lon: 54.540, npads: 8, refuel: true, band: 3400, spares: 1, zone: 'AE', src: 'model' },
      { id: 'MRO-U', name: 'MRO Hub Dubai South', kind: 'MRO', layout: 'mro', lat: 24.880, lon: 55.170, npads: 4, refuel: true, zone: 'AE', src: 'model' },
      { id: 'RKT', name: 'Ras Al Khaimah Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 25.700, lon: 55.950, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'FJR', name: 'Fujairah Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 25.140, lon: 56.330, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'AAN', name: 'Al Ain DC', kind: 'DC', layout: 'spoke', lat: 24.220, lon: 55.730, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'SOH', name: 'Sohar Port DC · Oman', kind: 'DC', layout: 'spoke', port: true, lat: 24.350, lon: 56.730, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'MCT', name: 'Muscat DC · Oman', kind: 'DC', layout: 'spoke', lat: 23.590, lon: 58.380, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'RUW', name: 'Ruwais DC', kind: 'DC', layout: 'spoke', lat: 24.110, lon: 52.730, npads: 2, refuel: true, zone: 'AE', src: 'model' },
      { id: 'MDZ', name: 'Madinat Zayed DC', kind: 'DC', layout: 'spoke', lat: 23.680, lon: 53.700, npads: 2, refuel: true, zone: 'AE', src: 'model' }
    ],
    routes: [
      { id: 'R-11', a: 'RUH', b: 'KHJ', n: 4, wps: [[24.48, 47.05]], cont: [['Al Hair', 24.38, 46.82]] },
      { id: 'R-14', a: 'RUH', b: 'BDY', n: 6, wps: [[25.50, 45.40]], cont: [['Rumah', 25.57, 47.16], ['Unaizah', 26.08, 43.99]] },
      { id: 'R-17', a: 'RUH', b: 'HOF', n: 5, wps: [[25.05, 48.20]], cont: [['Khurais road', 25.10, 48.00]] },
      { id: 'R-21', a: 'RUH', b: 'DWD', n: 3, wps: [[24.60, 45.60]], cont: [['Al Quwayiyah', 24.07, 45.27]] },
      { id: 'R-24', a: 'RUH', b: 'MJM', n: 3, wps: [[25.35, 46.00]], cont: [['Sudair', 25.60, 45.62]] },
      { id: 'T-10', a: 'RUH', b: 'DMM', n: 8, trunk: true, wps: [[25.40, 48.00], [26.00, 49.30]], cont: [['Rumah', 25.57, 47.16], ['Abqaiq', 25.93, 49.67]] },
      { id: 'M-01', a: 'RUH', b: 'MRO-R', n: 0, mro: true, wps: [[24.90, 46.70]], cont: [] },
      { id: 'J-11', a: 'JED', b: 'MAK', n: 6, wps: [[21.50, 39.55]], cont: [['Bahra', 21.40, 39.45]] },
      { id: 'J-14', a: 'JED', b: 'MED', n: 6, wps: [[22.80, 39.40], [23.80, 39.50]], cont: [['Khulais', 22.15, 39.32], ['Badr', 23.78, 38.79]] },
      { id: 'J-17', a: 'JED', b: 'TIF', n: 4, wps: [[21.85, 39.85], [21.55, 40.25]], cont: [['Al Jumum', 21.62, 39.70]] },
      { id: 'J-21', a: 'JED', b: 'YNB', n: 4, wps: [[22.90, 38.80]], cont: [['Rabigh', 22.80, 39.03]] },
      { id: 'J-24', a: 'JED', b: 'ABT', n: 3, wps: [[20.90, 40.40]], cont: [['Al Lith inland', 20.70, 40.30]] },
      { id: 'L-03', a: 'ABT', b: 'AHB', n: 3, band: 5000, wps: [[19.10, 42.05]], cont: [['Bisha road', 19.50, 42.00]] },
      { id: 'J-31', a: 'JED', b: 'RAB', n: 3, wps: [[22.00, 39.15]], cont: [['Thuwal', 22.28, 39.11]] },
      { id: 'D-11', a: 'DMM', b: 'JUB', n: 4, wps: [[26.70, 49.85]], cont: [['Qatif', 26.56, 50.01]] },
      { id: 'D-14', a: 'DMM', b: 'KHF', n: 3, wps: [[26.75, 49.35], [27.60, 48.95]], cont: [['Nairyah', 27.47, 48.48]] },
      { id: 'D-17', a: 'DMM', b: 'HBT', n: 3, wps: [[27.20, 48.30]], cont: [['Qaryat al Ulya', 27.55, 47.70]] },
      { id: 'D-21', a: 'DMM', b: 'BAH', n: 3, sea: true, wps: [[26.30, 50.35]], cont: [['King Fahd Causeway', 26.18, 50.33]] },
      { id: 'D-24', a: 'DMM', b: 'DOH', n: 4, sea: true, wps: [[25.90, 50.80]], cont: [['Salwa', 24.72, 50.82]] },
      { id: 'D-27', a: 'DMM', b: 'HOF', n: 3, wps: [[25.90, 49.90]], cont: [['Abqaiq', 25.93, 49.67]] },
      { id: 'D-31', a: 'DMM', b: 'KWI', n: 4, sea: true, wps: [[27.40, 49.90], [28.60, 49.00]], cont: [['Khafji coast', 28.43, 48.49]] },
      { id: 'T-11', a: 'TUU', b: 'NEO', n: 5, wps: [[28.20, 36.00]], cont: [['Sharma', 28.02, 35.25]] },
      { id: 'T-14', a: 'TUU', b: 'DUB', n: 3, wps: [[27.90, 36.20]], cont: [['Al Muwaylih road', 27.70, 35.90]] },
      { id: 'T-17', a: 'TUU', b: 'ULH', n: 3, wps: [[27.50, 37.30]], cont: [['Al Akhdar', 28.05, 37.15]] },
      { id: 'T-21', a: 'TUU', b: 'TYM', n: 2, wps: [[28.00, 37.60]], cont: [] },
      { id: 'U-11', a: 'DXB', b: 'RKT', n: 3, wps: [[25.35, 55.50]], cont: [['Umm Al Quwain', 25.56, 55.55]] },
      { id: 'U-14', a: 'DXB', b: 'FJR', n: 3, wps: [[25.10, 55.80]], cont: [['Masafi', 25.32, 56.16]] },
      { id: 'U-17', a: 'DXB', b: 'AAN', n: 3, wps: [[24.60, 55.40]], cont: [['Al Faqa', 24.72, 55.62]] },
      { id: 'U-21', a: 'DXB', b: 'SOH', n: 3, wps: [[24.75, 55.95]], cont: [['Hatta', 24.80, 56.12]] },
      { id: 'U-24', a: 'DXB', b: 'MCT', n: 4, band: 4600, wps: [[24.30, 56.80], [23.85, 57.70]], cont: [['Sohar coast', 24.35, 56.73], ['Barka', 23.68, 57.89]] },
      { id: 'U-10', a: 'DXB', b: 'AUH', n: 4, trunk: true, wps: [[24.65, 54.85]], cont: [['Ghantoot', 24.85, 54.83]] },
      { id: 'M-02', a: 'DXB', b: 'MRO-U', n: 0, mro: true, wps: [[24.93, 55.13]], cont: [] },
      { id: 'A-11', a: 'AUH', b: 'RUW', n: 3, wps: [[24.20, 53.60]], cont: [['Mirfa', 24.10, 53.45]] },
      { id: 'A-14', a: 'AUH', b: 'MDZ', n: 2, wps: [[24.00, 54.10]], cont: [] },
      { id: 'L-01', a: 'ULH', b: 'MED', n: 3, band: 5000, wps: [[25.60, 38.80]], cont: [['Khaybar', 25.70, 39.29]] },
      { id: 'L-02', a: 'DOH', b: 'AUH', n: 3, band: 5000, sea: true, wps: [[25.00, 52.70], [24.60, 53.70]], cont: [['Sir Bani Yas', 24.32, 52.60]] }
    ],
    pilots: [{ id: 'G1', name: 'F. Al-Qahtani', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G2', name: 'S. Al-Otaibi', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G3', name: 'M. Al-Harbi', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G4', name: 'A. Al-Ghamdi', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G5', name: 'K. Al-Zahrani', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G6', name: 'N. Al-Shehri', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G7', name: 'R. Al-Dosari', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G8', name: 'H. Al-Mutairi', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G9', name: 'Y. Al-Shammari', station: 'ROC Riyadh', zone: 'SA' }, { id: 'G10', name: 'T. Al-Anazi', station: 'ROC Riyadh', zone: 'SA' }, { id: 'U1', name: 'A. Al-Mansoori', station: 'ROC Dubai', zone: 'AE' }, { id: 'U2', name: 'S. Al-Hammadi', station: 'ROC Dubai', zone: 'AE' }, { id: 'U3', name: 'F. Al-Ketbi', station: 'ROC Dubai', zone: 'AE' }],
    cargo: [
      ['COLD', 'Vaccines and biologics', 'Pharma distributor'],
      ['COLD', 'Fresh produce and dairy', 'Grocery chain DC'],
      ['COLD', 'Lab samples, time-critical', 'Hospital cluster'],
      ['DRY', 'E-commerce parcels', 'Marketplace fulfilment'],
      ['DRY', 'Oil & gas spares, line-stop', 'Industrial supplier'],
      ['DRY', 'Automotive spares', 'Dealer network'],
      ['SENS', 'Electronics and telecom kit', 'Retail distributor'],
      ['LIQ', 'Process chemicals and reagents', 'Petrochemical plant'],
      ['DRY', 'Construction-site critical spares', 'Giga-project contractor'],
      ['SENS', 'Customs-sealed export goods', 'Free-zone forwarder']
    ]
  },
  {
    id: 'OF', region: 'IN', name: 'Gulf offshore', sub: 'Aramco · ADNOC · Qatar', stage: 'STAGE 02 · OFFSHORE', color: '#FAC83C', prefix: 'LXF', csBase: 3000,
    blurb: 'Three shore bases fly spares, samples and medical stores to the offshore fields of the Arabian Gulf: Tanajib and Ras Tanura for Saudi Aramco, Mussafah for ADNOC and Ras Laffan for Qatar. Each leg replaces a helicopter sortie or a half-day supply-boat run.',
    view: { lat: 26.20, lon: 51.20, dist: 2300, az: 0, tilt: 58 },
    zones: { SA: { name: 'Saudi Aramco', lat: 27.6, lon: 49.5, dist: 900 }, AE: { name: 'ADNOC', lat: 24.9, lon: 53.6, dist: 800 }, QA: { name: 'Qatar', lat: 26.1, lon: 51.9, dist: 500 } },
    surface: 'boat',
    sites: [
      // Saudi Aramco, northern Gulf,
      { id: 'TNJ', name: 'Tanajib Shore Base', kind: 'SHOREBASE', layout: 'quay', lat: 27.830, lon: 48.880, npads: 5, refuel: true, roc: true, hangar: 16, zone: 'SA', src: 'model' },
      { id: 'RTA', name: 'Ras Tanura Shore Base', kind: 'SHOREBASE', layout: 'quay', lat: 26.650, lon: 50.120, npads: 5, refuel: true, hangar: 16, zone: 'SA', src: 'model' },
      { id: 'SFN', name: 'Safaniya Field', kind: 'PLATFORM', layout: 'platform', lat: 28.250, lon: 48.850, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'MNF', name: 'Manifa Field', kind: 'PLATFORM', layout: 'platform', lat: 27.650, lon: 49.100, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'ZLF', name: 'Zuluf Field', kind: 'PLATFORM', layout: 'platform', lat: 28.350, lon: 49.550, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'MRJ', name: 'Marjan Field', kind: 'PLATFORM', layout: 'platform', lat: 28.350, lon: 49.750, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'BRI', name: 'Berri Field', kind: 'PLATFORM', layout: 'platform', lat: 27.200, lon: 49.750, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'ABS', name: 'Abu Safah Field', kind: 'PLATFORM', layout: 'platform', lat: 26.900, lon: 50.550, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'HSB', name: 'Hasbah Gas Field', kind: 'PLATFORM', layout: 'platform', lat: 27.550, lon: 50.400, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      { id: 'KRN', name: 'Karan Gas Field', kind: 'PLATFORM', layout: 'platform', lat: 27.700, lon: 49.830, npads: 1, refuel: false, zone: 'SA', src: 'model' },
      // ADNOC, Abu Dhabi,
      { id: 'MSF', name: 'Mussafah Shore Base', kind: 'SHOREBASE', layout: 'quay', lat: 24.350, lon: 54.480, npads: 5, refuel: true, roc: true, hangar: 16, zone: 'AE', src: 'model' },
      { id: 'DAS', name: 'Das Island', kind: 'PLATFORM', layout: 'platform', lat: 25.150, lon: 52.870, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      { id: 'ZRK', name: 'Zirku Island', kind: 'PLATFORM', layout: 'platform', lat: 24.880, lon: 53.070, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      { id: 'UZK', name: 'Upper Zakum Field', kind: 'PLATFORM', layout: 'platform', lat: 24.850, lon: 53.650, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      { id: 'LZK', name: 'Lower Zakum Field', kind: 'PLATFORM', layout: 'platform', lat: 24.750, lon: 53.200, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      { id: 'UMS', name: 'Umm Shaif Field', kind: 'PLATFORM', layout: 'platform', lat: 25.200, lon: 53.150, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      { id: 'MBR', name: 'Mubarraz Island', kind: 'PLATFORM', layout: 'platform', lat: 24.450, lon: 53.350, npads: 1, refuel: false, zone: 'AE', src: 'model' },
      // Qatar,
      { id: 'RLF', name: 'Ras Laffan Shore Base', kind: 'SHOREBASE', layout: 'quay', lat: 25.900, lon: 51.550, npads: 4, refuel: true, roc: true, hangar: 12, zone: 'QA', src: 'model' },
      { id: 'HLL', name: 'Halul Island', kind: 'PLATFORM', layout: 'platform', lat: 25.670, lon: 52.410, npads: 1, refuel: false, zone: 'QA', src: 'model' },
      { id: 'NFA', name: 'North Field Alpha', kind: 'PLATFORM', layout: 'platform', lat: 26.250, lon: 51.950, npads: 1, refuel: false, zone: 'QA', src: 'model' },
      { id: 'ISH', name: 'Al Shaheen Field', kind: 'PLATFORM', layout: 'platform', lat: 26.600, lon: 51.950, npads: 1, refuel: false, zone: 'QA', src: 'model' }
    ],
    routes: [
      { id: 'O-11', a: 'TNJ', b: 'SFN', n: 2, sea: true, wps: [[28.00, 48.95]], cont: [] },
      { id: 'O-12', a: 'TNJ', b: 'MNF', n: 2, sea: true, wps: [[27.75, 49.00]], cont: [] },
      { id: 'O-14', a: 'TNJ', b: 'ZLF', n: 3, sea: true, wps: [[28.05, 49.20]], cont: [] },
      { id: 'O-16', a: 'TNJ', b: 'MRJ', n: 3, sea: true, wps: [[28.05, 49.35]], cont: [] },
      { id: 'O-21', a: 'RTA', b: 'BRI', n: 2, sea: true, wps: [[26.95, 49.95]], cont: [] },
      { id: 'O-23', a: 'RTA', b: 'ABS', n: 2, sea: true, wps: [[26.75, 50.35]], cont: [] },
      { id: 'O-25', a: 'RTA', b: 'HSB', n: 2, sea: true, wps: [[27.10, 50.30]], cont: [] },
      { id: 'O-27', a: 'RTA', b: 'KRN', n: 2, sea: true, wps: [[27.20, 50.00]], cont: [] },
      { id: 'A-21', a: 'MSF', b: 'DAS', n: 3, sea: true, wps: [[24.70, 53.80]], cont: [] },
      { id: 'A-23', a: 'MSF', b: 'ZRK', n: 3, sea: true, wps: [[24.60, 53.80]], cont: [] },
      { id: 'A-25', a: 'MSF', b: 'UZK', n: 3, sea: true, wps: [[24.60, 54.10]], cont: [] },
      { id: 'A-27', a: 'MSF', b: 'LZK', n: 2, sea: true, wps: [[24.55, 53.90]], cont: [] },
      { id: 'A-29', a: 'MSF', b: 'UMS', n: 2, sea: true, wps: [[24.80, 53.90]], cont: [] },
      { id: 'A-31', a: 'MSF', b: 'MBR', n: 2, sea: true, wps: [[24.40, 54.00]], cont: [] },
      { id: 'Q-11', a: 'RLF', b: 'HLL', n: 2, sea: true, wps: [[25.80, 51.95]], cont: [] },
      { id: 'Q-13', a: 'RLF', b: 'NFA', n: 2, sea: true, wps: [[26.05, 51.70]], cont: [] },
      { id: 'Q-15', a: 'RLF', b: 'ISH', n: 2, sea: true, wps: [[26.20, 51.70]], cont: [] }
    ],
    pilots: [{ id: 'F1', name: 'M. Al-Yami', station: 'ROC Tanajib', zone: 'SA' }, { id: 'F2', name: 'A. Al-Hajri', station: 'ROC Tanajib', zone: 'SA' }, { id: 'E1', name: 'K. Al-Marzouqi', station: 'ROC Mussafah', zone: 'AE' }, { id: 'E2', name: 'O. Al-Suwaidi', station: 'ROC Mussafah', zone: 'AE' }, { id: 'Q1', name: 'J. Al-Kuwari', station: 'ROC Ras Laffan', zone: 'QA' }],
    cargo: [
      ['DRY', 'Valve and seal kits, compressor train', 'Shore warehouse'],
      ['DRY', 'Downhole tool sub-assembly', 'Shore warehouse'],
      ['SENS', 'Instrumentation and transmitter spares', 'Shore warehouse'],
      ['LIQ', 'Production chemical samples', 'Field laboratory'],
      ['COLD', 'Medical supplies', 'Occupational health'],
      ['DRY', 'Safety-critical PPE and gas detectors', 'HSE stores']
    ]
  },
  {
    id: 'RS', region: 'IN', name: 'Red Sea islands', sub: 'Resorts and giga-projects', stage: 'STAGE 03 · RED SEA', color: '#4FD1C5', prefix: 'LXR', csBase: 5000,
    blurb: 'A hub beside Red Sea International Airport supplies the resort islands of the Red Sea destination, AMAALA, Al Wajh and Sindalah at NEOM: fresh food, linen, guest parcels and spares every day, with no boat transfer and no quayside wait.',
    view: { lat: 26.20, lon: 36.30, dist: 1500, az: 0, tilt: 56 },
    surface: 'boat',
    sites: [
      { id: 'RSI', name: 'Red Sea Hub', kind: 'BASE', layout: 'base', lat: 25.650, lon: 37.150, npads: 8, refuel: true, band: 2200, spares: 1, roc: true, zone: 'SA', src: 'model' },
      { id: 'SHB', name: 'Sheybarah Island resort', kind: 'DC', layout: 'spoke', port: true, lat: 25.400, lon: 36.850, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'UMH', name: 'Ummahat Islands resort', kind: 'DC', layout: 'spoke', port: true, lat: 25.500, lon: 36.600, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'AMA', name: 'AMAALA', kind: 'DC', layout: 'spoke', port: true, lat: 26.050, lon: 36.400, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'UMJ', name: 'Umluj DC', kind: 'DC', layout: 'spoke', port: true, lat: 25.020, lon: 37.270, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'WJH', name: 'Al Wajh Port DC', kind: 'DC', layout: 'spoke', port: true, lat: 26.230, lon: 36.470, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'SDL', name: 'Sindalah Island · NEOM', kind: 'DC', layout: 'spoke', port: true, lat: 27.600, lon: 35.330, npads: 2, refuel: true, zone: 'SA', src: 'model' }
    ],
    routes: [
      { id: 'S-11', a: 'RSI', b: 'SHB', n: 3, sea: true, wps: [], cont: [] },
      { id: 'S-13', a: 'RSI', b: 'UMH', n: 3, sea: true, wps: [], cont: [] },
      { id: 'S-15', a: 'RSI', b: 'AMA', n: 3, sea: true, wps: [[25.85, 36.80]], cont: [] },
      { id: 'S-17', a: 'RSI', b: 'UMJ', n: 2, wps: [], cont: [] },
      { id: 'S-19', a: 'RSI', b: 'WJH', n: 2, wps: [[25.95, 36.85]], cont: [] },
      { id: 'S-21', a: 'RSI', b: 'SDL', n: 3, sea: true, wps: [[26.60, 36.10]], cont: [['Al Wajh', 26.23, 36.47]] }
    ],
    pilots: [{ id: 'R1', name: 'L. Al-Juhani', station: 'ROC Red Sea Hub', zone: 'SA' }, { id: 'R2', name: 'B. Al-Balawi', station: 'ROC Red Sea Hub', zone: 'SA' }],
    cargo: [
      ['COLD', 'Fresh seafood, fruit and dairy', 'Resort F&B'],
      ['DRY', 'Linen and guest amenities', 'Resort housekeeping'],
      ['DRY', 'Guest luggage and parcels', 'Concierge'],
      ['SENS', 'Spares for desalination and power', 'Utility contractor'],
      ['COLD', 'Medical stores', 'Island clinic'],
      ['DRY', 'Construction-critical spares', 'Island contractor']
    ]
  },
  {
    id: 'DS', region: 'IN', name: 'Desert oil camps', sub: 'Eastern Province · Empty Quarter', stage: 'STAGE 04 · DESERT', color: '#E8A15A', prefix: 'LXE', csBase: 6000,
    blurb: 'Abqaiq feeds the Ghawar camps at Uthmaniyah, Hawiyah, Haradh and Khurais; Shaybah, deep in the Empty Quarter, runs its own hub for exploration camps hours from any road. Spares, samples and medical stores arrive in an hour instead of a day on desert tracks.',
    view: { lat: 24.10, lon: 51.30, dist: 2300, az: 0, tilt: 58 },
    surface: 'road',
    sites: [
      { id: 'ABQ', name: 'Abqaiq Hub', kind: 'BASE', layout: 'base', lat: 25.930, lon: 49.670, npads: 8, refuel: true, band: 2200, spares: 1, roc: true, zone: 'SA', src: 'model' },
      { id: 'SYB', name: 'Shaybah Hub', kind: 'BASE', layout: 'base', lat: 22.510, lon: 53.970, npads: 8, refuel: true, band: 2200, spares: 1, zone: 'SA', src: 'model' },
      { id: 'KHU', name: 'Khurais Camp', kind: 'DC', layout: 'spoke', lat: 25.080, lon: 48.050, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'HRD', name: 'Haradh Camp', kind: 'DC', layout: 'spoke', lat: 24.150, lon: 49.070, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'UTH', name: 'Uthmaniyah Camp', kind: 'DC', layout: 'spoke', lat: 25.200, lon: 49.300, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'HAW', name: 'Hawiyah Gas Plant', kind: 'DC', layout: 'spoke', lat: 24.850, lon: 49.200, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'EXA', name: 'Exploration Camp A · Rub al Khali', kind: 'DC', layout: 'spoke', lat: 21.600, lon: 52.700, npads: 2, refuel: true, zone: 'SA', src: 'model' },
      { id: 'EXB', name: 'Exploration Camp B · Rub al Khali', kind: 'DC', layout: 'spoke', lat: 21.200, lon: 54.800, npads: 2, refuel: true, zone: 'SA', src: 'model' }
    ],
    routes: [
      { id: 'E-11', a: 'ABQ', b: 'KHU', n: 3, wps: [[25.55, 48.85]], cont: [] },
      { id: 'E-13', a: 'ABQ', b: 'HRD', n: 3, wps: [[25.00, 49.40]], cont: [] },
      { id: 'E-15', a: 'ABQ', b: 'UTH', n: 2, wps: [], cont: [] },
      { id: 'E-17', a: 'ABQ', b: 'HAW', n: 2, wps: [[25.40, 49.50]], cont: [] },
      { id: 'E-21', a: 'SYB', b: 'EXA', n: 2, wps: [], cont: [] },
      { id: 'E-23', a: 'SYB', b: 'EXB', n: 2, wps: [], cont: [] }
    ],
    pilots: [{ id: 'D1', name: 'S. Al-Khaldi', station: 'ROC Abqaiq', zone: 'SA' }, { id: 'D2', name: 'W. Al-Rashidi', station: 'ROC Abqaiq', zone: 'SA' }],
    cargo: [
      ['DRY', 'Pump and compressor spares', 'Camp stores'],
      ['SENS', 'Logging tools and electronics', 'Wireline contractor'],
      ['LIQ', 'Crude and water samples', 'Central laboratory'],
      ['COLD', 'Medical stores and blood', 'Camp clinic'],
      ['DRY', 'PPE and gas detectors', 'HSE stores'],
      ['COLD', 'Fresh food', 'Camp catering']
    ]
  }
];

const POD_TYPES = {
  DRY:  { label: 'DRY',        prefix: 'DR', color: '#C9CDD2', stripe: '#E8523F' },
  COLD: { label: 'COLD CHAIN', prefix: 'CC', color: '#E9EEF2', stripe: '#78AAFF' },
  LIQ:  { label: 'LIQUID',     prefix: 'LQ', color: '#B9C0C6', stripe: '#FAC83C' },
  SENS: { label: 'SENSITIVE',  prefix: 'SN', color: '#D8D4CC', stripe: '#C08CF0' },
  DEF:  { label: 'DEFENCE',    prefix: 'DF', color: '#6F7A72', stripe: '#3DDC97' },
  EMPTY: { label: 'EMPTY POD',  prefix: 'EP', color: '#9AA0A6', stripe: '#5A6068' }     // every airframe flies with a pod fitted, loaded or empty
};
