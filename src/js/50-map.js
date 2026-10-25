/* ============================================================================
   NETWORK MAP — the Arabian Peninsula and the Gulf as a relief model at true horizontal scale
   (1 scene unit = 1 km). Coast, state lines, rivers, cities and airports are
   Natural Earth 1:10m; relief, land colour and night lights are NASA-derived.
   Corridors, sites and aircraft are placed by latitude and longitude.
   ========================================================================== */

const MAPC = { lat: 24.0, lon: 47.0, relief: 9, altEx: 14 };     // projection centre; km of height per unit DEM; altitude exaggeration
const mapX = lon => (lon - MAPC.lon) * KM_LON * Math.cos(MAPC.lat * DEG);
const mapZ = lat => -(lat - MAPC.lat) * KM_LAT;

/* constant-screen-width ribbon: `side` pushes each vertex sideways in clip space */
const RIB_VS = `
attribute vec3 next; attribute float side; attribute float along;
uniform vec2 res; uniform float width;
varying float vAlong; varying float vSide;
void main(){
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(next, 1.0);
  vec2 d = normalize((b.xy / max(b.w, 1e-4) - a.xy / max(a.w, 1e-4)) * res + vec2(1e-5));
  vec2 n = vec2(-d.y, d.x);
  a.xy += n * side * width / res * a.w;
  vAlong = along; vSide = side; gl_Position = a;
}`;
const RIB_FS = `
uniform vec3 color; uniform float opacity; uniform float time; uniform float dash; uniform float flow;
varying float vAlong; varying float vSide;
void main(){
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
  float a = opacity * edge;
  if (dash > 0.0) { float p = fract((vAlong - time * flow) / dash); a *= mix(0.42, 1.0, smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.42, 0.5, p))); }
  gl_FragColor = vec4(color, a);
}`;
function ribbonGeo(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  g.setAttribute('next', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  const side = new Float32Array(n * 2), along = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  g.setAttribute('side', new THREE.BufferAttribute(side, 1)); g.setAttribute('along', new THREE.BufferAttribute(along, 1)); g.setIndex(idx);
  return g;
}
function ribbonSet(g, pts, cum) {                    // pts: array of Vector3
  const p = g.attributes.position.array, nx = g.attributes.next.array, al = g.attributes.along.array, n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = i < n - 1 ? pts[i + 1] : pts[i].clone().multiplyScalar(2).sub(pts[i - 1]);
    for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 3; p[o] = a.x; p[o + 1] = a.y; p[o + 2] = a.z; nx[o] = b.x; nx[o + 1] = b.y; nx[o + 2] = b.z; al[i * 2 + k] = cum ? cum[i] : i; }
  }
  g.attributes.position.needsUpdate = g.attributes.next.needsUpdate = g.attributes.along.needsUpdate = true; g.computeBoundingSphere();
}
function ribbonMat(color, width, opacity, dash, flow) {
  return new THREE.ShaderMaterial({ uniforms: { color: { value: COL(color) }, res: { value: new THREE.Vector2(1, 1) }, width: { value: width }, opacity: { value: opacity }, time: { value: 0 }, dash: { value: dash || 0 }, flow: { value: flow || 0 } },
    vertexShader: RIB_VS, fragmentShader: RIB_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

class MapView {
  constructor(app, region) {
    this.app = app; this.sim = app.sim; this.region = region || 'IN';
    this.G = this.region === 'SEA' ? GEO_SEA : GEO;
    this.C = this.region === 'SEA' ? { lat: 4.5, lon: 111.25, relief: 9, altEx: 14 } : MAPC;
    this.kx = KM_LON * Math.cos(this.C.lat * DEG);
    this.scene = new THREE.Scene(); this.scene.background = COL(0x07090C);
    this.cam = new THREE.PerspectiveCamera(30, 1, 5, 22000);
    const b = this.G.bbox;
    this.x0 = this.mx(b[0]); this.x1 = this.mx(b[1]); this.z0 = this.mz(b[3]); this.z1 = this.mz(b[2]);
    this.rig = new Rig(this.cam, { minDist: 60, maxDist: 7200, minTilt: 22, maxTilt: 86, bounds: [this.x0 + 60, this.x1 - 60, this.z0 + 60, this.z1 - 60] });
    this.labels = new Labels(document.getElementById(this.region === 'SEA' ? 'labels-map-sea' : 'labels-map'));
    this.ribbons = []; this.picks = []; this.tmp = V3(); this.t = 0; this.tLbl = 0; this.tTrail = 0;
  }

  mx(lon) { return (lon - this.C.lon) * this.kx; }
  mz(lat) { return -(lat - this.C.lat) * KM_LAT; }
  inR(scn) { const d = SCENARIOS.find(x => x.id === scn); return (d && d.region || 'IN') === this.region; }
  /* ----- terrain ----- */
  elev01(lat, lon) {
    const b = this.G.bbox, W = this.demW, H = this.demH;
    const fx = clamp((lon - b[0]) / (b[1] - b[0]) * (W - 1), 0, W - 1.001), fy = clamp((b[3] - lat) / (b[3] - b[2]) * (H - 1), 0, H - 1.001);
    const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y, d = this.dem;
    return lerp(lerp(d[y * W + x], d[y * W + x + 1], u), lerp(d[(y + 1) * W + x], d[(y + 1) * W + x + 1], u), v);
  }
  ground(lat, lon) { return this.elev01(lat, lon) * this.C.relief; }
  pos(lat, lon, altM, out) { out = out || V3(); return out.set(this.mx(lon), this.ground(lat, lon) + (altM || 0) / 1000 * this.C.altEx, this.mz(lat)); }

  async init() {
    const [demI, tintI, lightI] = await Promise.all([loadImg(this.G.dem), loadImg(this.G.tint), loadImg(this.G.lights)]);
    const b = this.G.bbox, Q = this.G.q, TW = 2048, TH = Math.round(TW * (this.z1 - this.z0) / (this.x1 - this.x0));
    const px = (qx) => qx / Q / (b[1] - b[0]) * TW, py = (qy) => (1 - qy / Q / (b[3] - b[2])) * TH;
    const path = (g, arr, close) => { g.moveTo(px(arr[0]), py(arr[1])); for (let i = 2; i < arr.length; i += 2) g.lineTo(px(arr[i]), py(arr[i + 1])); if (close) g.closePath(); };
    const scaled = (img, blur) => { const c = cvs(TW, TH), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; if (blur) g.filter = 'blur(' + blur + 'px)'; g.drawImage(img, 0, 0, TW, TH); return g.getImageData(0, 0, TW, TH).data; };
    // land mask
    const mc = cvs(TW, TH), mg = mc.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, TW, TH); mg.fillStyle = '#fff'; mg.beginPath(); for (const p of this.G.land) path(mg, p, true); mg.fill();
    mg.fillStyle = '#000'; mg.beginPath(); for (const p of this.G.lakes) path(mg, p, true); mg.fill();
    const mask = mg.getImageData(0, 0, TW, TH).data;
    const dc = cvs(TW, TH), dg = dc.getContext('2d'); dg.fillStyle = '#000'; dg.fillRect(0, 0, TW, TH); dg.fillStyle = '#fff'; dg.beginPath(); for (const p of this.G.deep) path(dg, p, true); dg.fill();
    dg.filter = 'blur(10px)'; dg.drawImage(dc, 0, 0); const deep = dg.getImageData(0, 0, TW, TH).data;
    const tint = scaled(tintI, 3), lights = scaled(lightI, 0), demBig = scaled(demI, 7);
    // height field on the mesh grid, masked to land
    const GW = this.demW = 384, GH = this.demH = Math.round(384 * TH / TW);
    const gc = cvs(GW, GH), gg = gc.getContext('2d'); gg.imageSmoothingQuality = 'high'; gg.filter = 'blur(2.2px)'; gg.drawImage(demI, 0, 0, GW, GH);
    const gd = gg.getImageData(0, 0, GW, GH).data; gg.filter = 'blur(1.5px)'; gg.drawImage(mc, 0, 0, GW, GH); const gm = gg.getImageData(0, 0, GW, GH).data;
    this.dem = new Float32Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) { const m = gm[i * 4] / 255; this.dem[i] = (gd[i * 4] / 255 * 0.94 + 0.06) * smooth(m * 1.6) ; }
    // compose the surface texture
    const oc = cvs(TW, TH), og = oc.getContext('2d'), im = og.createImageData(TW, TH), o = im.data;
    const H = (x, y) => demBig[(clamp(y, 0, TH - 1) * TW + clamp(x, 0, TW - 1)) * 4];
    for (let y = 0, i = 0; y < TH; y++) for (let x = 0; x < TW; x++, i += 4) {
      const m = mask[i] / 255;
      const dz = deep[i] / 255, v = y / TH;
      let sr = lerp(16, 9, dz) + 4 * (1 - v), sg = lerp(30, 17, dz) + 5 * (1 - v), sb = lerp(44, 27, dz) + 6 * (1 - v);
      if (m > 0.004) {
        const sh = clamp(0.5 + ((H(x - 6, y) - H(x + 6, y)) * 0.9 + (H(x, y - 6) - H(x, y + 6)) * 1.1) * 0.03, 0.2, 1.1);
        const tr = tint[i], tg = tint[i + 1], tb = tint[i + 2], lum = (tr * 0.3 + tg * 0.5 + tb * 0.2);
        const e = demBig[i] / 255;
        let r = lerp(lum, tr, 0.6) * 0.36 + 6, g2 = lerp(lum, tg, 0.65) * 0.38 + 9, bl = lerp(lum, tb, 0.55) * 0.38 + 14;
        const k = (0.5 + sh * 0.7) * (0.8 + e * 0.9); r *= k; g2 *= k; bl *= k;
        const L = Math.max(0, lights[i] - 40) / 215, lg = Math.pow(L, 1.5) * 0.6;
        r += 255 * lg; g2 += 196 * lg; bl += 120 * lg;
        sr = lerp(sr, r, m); sg = lerp(sg, g2, m); sb = lerp(sb, bl, m);
      }
      o[i] = sr; o[i + 1] = sg; o[i + 2] = sb; o[i + 3] = 255;
    }
    og.putImageData(im, 0, 0);
    // rivers, highways and a soft coastal glow belong to the surface
    og.lineJoin = og.lineCap = 'round';
    og.strokeStyle = 'rgba(40,110,150,0.26)'; og.lineWidth = 7; og.filter = 'blur(5px)'; og.beginPath(); for (const p of this.G.coast) path(og, p); og.stroke(); og.filter = 'none';
    for (const r of this.G.rivers) { og.strokeStyle = 'rgba(70,128,170,' + (r.r <= 5 ? 0.85 : 0.6) + ')'; og.lineWidth = r.r <= 4 ? 2.0 : r.r <= 6 ? 1.4 : 1.0; og.beginPath(); path(og, r.p); og.stroke(); }
    og.strokeStyle = 'rgba(214,176,128,0.20)'; og.lineWidth = 1.1; og.beginPath(); for (const p of this.G.roads) path(og, p); og.stroke();
    this.surfaceTex = texOf(oc, { clamp: true, aniso: 16 });

    // mesh
    const W = this.x1 - this.x0, D = this.z1 - this.z0, geo = new THREE.PlaneGeometry(W, D, GW - 1, GH - 1); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, this.dem[i] * this.C.relief);
    geo.translate((this.x0 + this.x1) / 2, 0, (this.z0 + this.z1) / 2); geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.surfaceTex, roughness: 0.96, metalness: 0 })); this.scene.add(this.terrain);
    // plinth and table
    const pl = new THREE.Mesh(new THREE.BoxGeometry(W, 26, D), stdMat({ color: 0x0B0E12, roughness: 0.9 })); pl.position.set((this.x0 + this.x1) / 2, -13.05, (this.z0 + this.z1) / 2); this.scene.add(pl);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.01, D)), new THREE.LineBasicMaterial({ color: COL(0x3A4350), transparent: true, opacity: 0.9 })); edge.position.set((this.x0 + this.x1) / 2, 0.05, (this.z0 + this.z1) / 2); this.scene.add(edge);
    const tc = cvs(256), tg2 = tc.getContext('2d'); tg2.fillStyle = '#07090C'; tg2.fillRect(0, 0, 256, 256); tg2.strokeStyle = 'rgba(120,140,165,0.16)'; tg2.lineWidth = 1; tg2.strokeRect(0.5, 0.5, 255, 255);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshBasicMaterial({ map: texOf(tc, { repeat: [240, 240] }) })); table.rotation.x = -Math.PI / 2; table.position.y = -26; this.scene.add(table);
    this.scene.fog = new THREE.Fog(COL(0x07090C), 9000, 19000);
    const sun = new THREE.DirectionalLight(COL(0xFFE9CF), 0.95); sun.position.set(-0.5, 0.8, -0.45); this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(COL(0xB7C6DA), COL(0x3A3D42), 0.85));

    this._lines(); this._marks(); this._corridors(); this._sites(); this._aircraft();
    // selection ring
    const rg = new THREE.RingGeometry(0.82, 1, 48); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: COL(0xE8523F), transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })); this.ring.renderOrder = 20; this.ring.visible = false; this.scene.add(this.ring);
    this.ring2 = this.ring.clone(); this.ring2.material = this.ring.material.clone(); this.scene.add(this.ring2);
  }

  _draped(arr, lift, step) {            // quantised [x,y,...] -> Vector3 list on the terrain
    const b = this.G.bbox, Q = this.G.q, out = [];
    for (let i = 0; i < arr.length; i += 2) { const lon = b[0] + arr[i] / Q, lat = b[2] + arr[i + 1] / Q; out.push(V3(this.mx(lon), this.ground(lat, lon) + lift, this.mz(lat))); }
    return out;
  }
  _segs(lists, mat) {
    const pos = []; for (const l of lists) for (let i = 0; i < l.length - 1; i++) pos.push(l[i].x, l[i].y, l[i].z, l[i + 1].x, l[i + 1].y, l[i + 1].z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const o = new THREE.LineSegments(g, mat); this.scene.add(o); return o;
  }
  _lines() {
    const lm = (c, op) => new THREE.LineBasicMaterial({ color: COL(c), transparent: true, opacity: op, depthWrite: false });
    this._segs((this.G.coast.length ? this.G.coast : this.G.land).map(c => this._draped(c, 0.18)), lm(0x8FC4EC, 0.75));
    this.stateLines = this._segs(this.G.states.map(c => this._draped(c, 0.3)), lm(0xAEB8C6, 0.26));
    // graticule every degree, draped
    const b = this.G.bbox, gl = [];
    for (let lon = Math.ceil(b[0]); lon <= b[1]; lon++) { const l = []; for (let lat = b[2]; lat <= b[3] + 1e-6; lat += 0.125) l.push(V3(this.mx(lon), this.ground(lat, lon) + 0.22, this.mz(lat))); gl.push(l); }
    for (let lat = Math.ceil(b[2]); lat <= b[3]; lat++) { const l = []; for (let lon = b[0]; lon <= b[1] + 1e-6; lon += 0.125) l.push(V3(this.mx(lon), this.ground(lat, lon) + 0.22, this.mz(lat))); gl.push(l); }
    this._segs(gl, lm(0xC8D4E4, 0.075));
    for (let lon = Math.ceil(b[0]) + 1; lon < b[1]; lon += 2) { this.labels.get('gx' + lon, 'grat', lon + '°E'); }
    for (let lat = Math.ceil(b[2]) + 1; lat < b[3]; lat += 2) { this.labels.get('gy' + lat, 'grat', Math.abs(lat) + (lat < 0 ? '°S' : '°N')); }
  }
  _pointTex(kind) {
    const c = cvs(64), g = c.getContext('2d'); g.translate(32, 32); g.lineWidth = 6; g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    if (kind === 'dot') { g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill(); }
    if (kind === 'ring') { g.beginPath(); g.arc(0, 0, 18, 0, 7); g.stroke(); }
    if (kind === 'diamond') { g.rotate(Math.PI / 4); g.fillRect(-13, -13, 26, 26); }
    if (kind === 'square') { g.strokeRect(-16, -16, 32, 32); }
    if (kind === 'cross') { g.lineWidth = 7; g.beginPath(); g.moveTo(-20, 0); g.lineTo(20, 0); g.moveTo(0, -20); g.lineTo(0, 20); g.stroke(); }
    return texOf(c, { clamp: true });
  }
  _points(list, kind, color, size, op) {
    const pos = []; for (const p of list) pos.push(p.x, p.y, p.z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const o = new THREE.Points(g, new THREE.PointsMaterial({ map: this._pointTex(kind), color: COL(color), size, sizeAttenuation: false, transparent: true, opacity: op == null ? 1 : op, depthWrite: false, depthTest: false }));
    o.renderOrder = 6; this.scene.add(o); return o;
  }
  _marks() {
    // cities
    this.cities = this.G.cities.map((c, i) => ({ ...c, key: 'c' + i, p: this.pos(c.lat, c.lon, 0).add(V3(0, 0.4, 0)), tier: c.pop > 2.5e6 ? 0 : c.pop > 7e5 ? 1 : 2 }));
    for (const c of this.cities) this.labels.get(c.key, 'city t' + c.tier, c.n);
    this.cityPts = [0, 1, 2].map(t => this._points(this.cities.filter(c => c.tier === t).map(c => c.p), 'dot', 0xE9EAEC, [5, 4, 3][t], [0.9, 0.7, 0.55][t]));
    // civil airports with an indicative 5 NM ring
    this.airports = this.G.airports.map((a, i) => ({ ...a, key: 'ap' + i, p: this.pos(a.lat, a.lon, 0).add(V3(0, 0.5, 0)) }));
    const rings = [];
    for (const a of this.airports) { const l = []; for (let k = 0; k <= 40; k++) { const q = moveLL(a.lat, a.lon, k * 9, 9.26); l.push(this.pos(q[0], q[1], 0).add(V3(0, 0.5, 0))); } rings.push(l); this.labels.get(a.key, 'apt', a.iata || a.icao); }
    this.aptRings = this._segs(rings, new THREE.LineBasicMaterial({ color: COL(0xFF8874), transparent: true, opacity: 0.5, depthWrite: false }));
    this.aptPts = this._points(this.airports.map(a => a.p), 'cross', 0xFF8874, 8, 0.8);
  }
  _routePts(R, altM, step) {
    const pts = [], cum = []; let d = 0;
    for (let i = 0; i < R.pts.length - 1; i++) {
      const a = R.pts[i], b = R.pts[i + 1], L = distKm(a[0], a[1], b[0], b[1]), n = Math.max(1, Math.ceil(L / (step || 6)));
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) { const f = k / n, lat = lerp(a[0], b[0], f), lon = lerp(a[1], b[1], f); pts.push([lat, lon]); cum.push(d + L * f); }
      d += L;
    }
    // the ribbon follows the flight profile: up from the pad, level in the corridor, down to the pad
    const out = pts.map((p, i) => this.pos(p[0], p[1], altM * smooth(Math.min(cum[i], d - cum[i]) / Math.min(9, d * 0.3))));
    return { pts: out, cum };
  }
  _corridors() {
    this.routeObj = {};
    const gcs = [], cont = [];
    for (const id in this.sim.routes) {
      const R = this.sim.routes[id]; if (!this.inR(R.scn)) continue; const sc = this.sim.scn[R.scn].def, moving = this.sim.sites[R.a].moving || this.sim.sites[R.b].moving, alt = R.baseFt * FT;
      const { pts, cum } = this._routePts(R, alt, 3);
      const cap = moving ? pts.length + 60 : pts.length;
      const g = ribbonGeo(cap); ribbonSet(g, pts, cum); g.setDrawRange(0, (pts.length - 1) * 6);
      const m = ribbonMat(R.mro ? 0xFF8874 : sc.color, 2.6, 0.95, 16, 5.5);
      const rib = new THREE.Mesh(g, m); rib.frustumCulled = false; rib.renderOrder = 5; this.scene.add(rib); this.ribbons.push(m);
      // translucent curtain from the corridor down to the terrain
      const cg = new THREE.BufferGeometry(), cp = new Float32Array(cap * 6), ca = new Float32Array(cap * 2), ci = [];
      for (let i = 0; i < cap - 1; i++) { const a = i * 2; ci.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setAttribute('a', new THREE.BufferAttribute(ca, 1)); cg.setIndex(ci);
      const cm = new THREE.ShaderMaterial({ uniforms: { color: { value: COL(R.mro ? 0xFF8874 : sc.color) }, op: { value: 0.16 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'attribute float a; varying float va; void main(){ va = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform vec3 color; uniform float op; varying float va; void main(){ gl_FragColor = vec4(color, op * va * va); }' });
      const cur = new THREE.Mesh(cg, cm); cur.frustumCulled = false; cur.renderOrder = 3; this.scene.add(cur);
      const o = this.routeObj[id] = { R, rib, m, cur, cm, moving, alt, mid: null };
      this._curtain(o, pts);
      o.mid = pts[Math.floor(pts.length / 2)].clone();
      this.labels.get('r' + id, 'route', id);
      for (const s of R.gcs) if (!s.end) gcs.push({ p: this.pos(s.lat, s.lon, 0).add(V3(0, 0.5, 0)), name: s.name, scn: R.scn });
      R.cont.forEach((c, i) => cont.push({ p: this.pos(c[1], c[2], 0).add(V3(0, 0.5, 0)), name: 'C' + (i + 1) + ' ' + c[0], scn: R.scn, key: 'ct' + id + i }));
    }
    this.gcsList = gcs; this.contList = cont;
    this.gcsPts = this._points(gcs.map(g => g.p), 'diamond', 0x9FD8FF, 6, 0.9);
    this.contPts = this._points(cont.map(g => g.p), 'square', 0xFAC83C, 8, 0.9);
    gcs.forEach((g, i) => { g.key = 'g' + i; this.labels.get(g.key, 'aux', g.name); });
    cont.forEach(c => this.labels.get(c.key, 'aux cont', c.name));
  }
  _curtain(o, pts) {
    const cp = o.cur.geometry.attributes.position.array, ca = o.cur.geometry.attributes.a.array;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], gy = this.elev01(this.C.lat - p.z / KM_LAT, this.C.lon + p.x / this.kx) * this.C.relief; cp.set([p.x, p.y, p.z, p.x, gy, p.z], i * 6); ca[i * 2] = 1; ca[i * 2 + 1] = 0; }
    o.cur.geometry.attributes.position.needsUpdate = true; o.cur.geometry.attributes.a.needsUpdate = true; o.cur.geometry.setDrawRange(0, (pts.length - 1) * 6);
  }
  _sites() {
    this.siteObj = {};
    const disc = new THREE.CircleGeometry(1, 28); disc.rotateX(-Math.PI / 2);
    const ring = new THREE.RingGeometry(1.25, 1.55, 36); ring.rotateX(-Math.PI / 2);
    const shipG = new THREE.Shape(); shipG.moveTo(0, 2.2); shipG.lineTo(0.75, 0.6); shipG.lineTo(0.7, -1.8); shipG.lineTo(-0.7, -1.8); shipG.lineTo(-0.75, 0.6); shipG.closePath();
    const shipGeo = new THREE.ShapeGeometry(shipG); shipGeo.rotateX(-Math.PI / 2);            // bow toward -z (north)
    const sq = new THREE.PlaneGeometry(2, 2); sq.rotateX(-Math.PI / 2);
    for (const id in this.sim.sites) {
      const s = this.sim.sites[id]; if (!this.inR(s.scn)) continue; const col = COL(this.sim.scn[s.scn].def.color);
      const g = new THREE.Group();
      const core = new THREE.Mesh(s.kind === 'SHIP' ? shipGeo : s.kind === 'PLATFORM' ? sq : disc, new THREE.MeshBasicMaterial({ color: COL(0xF4F4F2), depthTest: false, transparent: true }));
      const halo = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95 }));
      core.renderOrder = 9; halo.renderOrder = 8; g.add(core); g.add(halo);
      if (s.kind === 'PLATFORM') core.rotation.y = Math.PI / 4;
      this.scene.add(g);
      this.siteObj[id] = { s, g, core, halo };
      const base = s.kind === 'BASE' || this.sim.scn[s.scn].def.sites[0].id === id;
      this.labels.get('s' + id, 'site' + (base ? ' base' : ''), '<b>' + s.name + '</b><i>' + (s.def.port ? 'PORT DISTRIBUTION CENTRE' : { DC: 'DISTRIBUTION CENTRE', MRO: 'MRO HUB', DOCKYARD: 'NAVAL BASE', SHOREBASE: 'SHORE BASE', SHIP: 'UNDER WAY', PLATFORM: 'PLATFORM' }[s.kind] || s.kind) + '</i>');
    }
  }
  _aircraft() {
    const n = this.sim.aircraft.length;
    // plan-view silhouette: spine, front wing with four nacelles, rear wing with two
    const sh = new THREE.Shape();
    const P = [[0, 3.4], [0.5, 2.3], [0.55, 1.5], [3.6, 1.1], [3.6, 0.35], [0.55, 0.5], [0.42, -1.7], [1.7, -1.95], [1.7, -2.5], [0.3, -2.45], [0.12, -2.95]];
    sh.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) sh.lineTo(P[i][0], P[i][1]); for (let i = P.length - 1; i >= 0; i--) sh.lineTo(-P[i][0], P[i][1]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false }); g.rotateX(-Math.PI / 2);     // nose toward -z at heading 0 (north)
    this.acMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff }), n); this.acMesh.frustumCulled = false; this.acMesh.renderOrder = 12;
    this.acMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); this.scene.add(this.acMesh);
    // stems to the ground and ground dots
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.stems = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: COL(0xE9EAEC), transparent: true, opacity: 0.32, depthWrite: false })); this.stems.frustumCulled = false; this.scene.add(this.stems);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ map: this._pointTex('dot'), color: COL(0x000000), size: 5, sizeAttenuation: false, transparent: true, opacity: 0.45, depthWrite: false })); this.dots.frustumCulled = false; this.scene.add(this.dots);
    // trails: one dynamic segment buffer with per-vertex fade
    const TN = 112;
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * TN * 6), 3)); tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * TN * 8), 4));
    this.trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })); this.trails.frustumCulled = false; this.trails.renderOrder = 4; this.scene.add(this.trails);
    this.trailN = TN; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.sc = V3();
    this.acPos = this.sim.aircraft.map(() => V3());
    for (const a of this.sim.aircraft) if (this.inR(a.scn)) this.labels.get('a' + a.cs, 'ac', a.cs);
  }

  /* ----- per frame ----- */
  resize(W, H) { this.W = W; this.H = H; this.cam.aspect = W / H; this.cam.viewH = H; this.cam.updateProjectionMatrix(); const pr = this.app.renderer.getPixelRatio(); for (const m of this.ribbons) m.uniforms.res.value.set(W, H); }
  update(dt, tReal) {
    const sim = this.sim, rig = this.rig, scn = this.app.scn, sel = this.app.sel;
    this.t += dt; rig.update(dt);
    const px = rig.dist * 2 * Math.tan(this.cam.fov * DEG / 2) / this.H;              // km per pixel at the target
    // sites
    for (const id in this.siteObj) {
      const o = this.siteObj[id], s = o.s, on = s.scn === scn;
      this.pos(s.lat, s.lon, 0, o.g.position); o.g.position.y += 0.6;
      const k = px * (on ? 7 : 5) * (s.kind === 'SHIP' ? 1.5 : 1); o.g.scale.setScalar(k);
      if (s.kind === 'SHIP') o.core.rotation.y = -s.rot * DEG;
      o.halo.material.opacity = on ? 0.95 : 0.45; o.core.material.opacity = on ? 1 : 0.55; o.halo.visible = s.kind !== 'SHIP';
    }
    // corridors
    for (const id in this.routeObj) {
      const o = this.routeObj[id], on = o.R.scn === scn, isSel = sel && ((sel.type === 'route' && sel.id === id) || (sel.type === 'aircraft' && sim.byCs[sel.id] && sim.byCs[sel.id].route === id));
      o.m.uniforms.time.value = this.t; o.m.uniforms.opacity.value = on ? (isSel ? 1 : 0.85) : 0.28; o.m.uniforms.width.value = (isSel ? 4.2 : on ? 3.0 : 1.6) * (o.R.mro ? 0.6 : o.R.trunk ? 1.5 : 1); o.cm.uniforms.op.value = on ? (isSel ? 0.42 : 0.26) : 0.07;
      o.m.uniforms.dash.value = Math.max(6, px * 46); o.m.uniforms.flow.value = o.m.uniforms.dash.value * 0.35;
      if (o.moving && (this.t - (o.tGeo || -9)) > 0.4) {
        o.tGeo = this.t; const A = sim.sites[o.R.a], B = sim.sites[o.R.b]; o.R.pts[0] = [A.lat, A.lon]; o.R.pts[o.R.pts.length - 1] = [B.lat, B.lon];
        const { pts, cum } = this._routePts(o.R, o.alt, 4); const cap = o.rib.geometry.attributes.side.count / 2; if (pts.length > cap) pts.length = cum.length = cap;
        ribbonSet(o.rib.geometry, pts, cum); o.rib.geometry.setDrawRange(0, (pts.length - 1) * 6); this._curtain(o, pts); o.mid.copy(pts[Math.floor(pts.length / 2)]);
      }
    }
    // aircraft
    const sp = this.stems.geometry.attributes.position.array, dp = this.dots.geometry.attributes.position.array, ic = this.acMesh.instanceColor.array;
    const icon = px * 3.1 * clamp(2100 / rig.dist, 0.58, 1);                 // smaller symbols when the whole network is in view
    sim.aircraft.forEach((a, i) => {
      const p = this.acPos[i]; this.pos(a.lat, a.lon, a.alt, p);
      const gy = p.y - a.alt / 1000 * this.C.altEx, air = AIRBORNE[a.phase], on = a.scn === scn, isSel = sel && sel.type === 'aircraft' && sel.id === a.cs;
      const show = (air || isSel) && this.inR(a.scn);
      this.e.set(0, -a.hdg * DEG, 0); this.q.setFromEuler(this.e);
      const k = show ? icon * (isSel ? 1.5 : on ? 1 : 0.72) : 0.0001; this.sc.set(k, k, k);
      this.m4.compose(this.tmp.set(p.x, p.y + 0.3, p.z), this.q, this.sc); this.acMesh.setMatrixAt(i, this.m4);
      const c = isSel ? [1.0, 0.16, 0.08] : a.phase === 'HOLD' ? [0.96, 0.58, 0.04] : on ? [1, 1, 1] : [0.42, 0.46, 0.52];
      ic[i * 3] = c[0]; ic[i * 3 + 1] = c[1]; ic[i * 3 + 2] = c[2];
      sp.set(show ? [p.x, p.y, p.z, p.x, gy + 0.3, p.z] : [0, 0, 0, 0, 0, 0], i * 6); dp.set(show ? [p.x, gy + 0.3, p.z] : [0, -99, 0], i * 3);
    });
    this.acMesh.instanceMatrix.needsUpdate = true; this.acMesh.instanceColor.needsUpdate = true; this.stems.geometry.attributes.position.needsUpdate = true; this.dots.geometry.attributes.position.needsUpdate = true;
    // trails
    this.tTrail -= dt;
    if (this.tTrail <= 0) {
      this.tTrail = 0.12; const tp = this.trails.geometry.attributes.position.array, tc = this.trails.geometry.attributes.color.array, TN = this.trailN; let n = 0;
      sim.aircraft.forEach((a, i) => {
        if (!AIRBORNE[a.phase] || a.trail.length < 3 || !this.inR(a.scn)) return;
        const on = a.scn === scn, isSel = sel && sel.type === 'aircraft' && sel.id === a.cs, col = isSel ? [1, 0.3, 0.2] : on ? [1, 1, 1] : [0.5, 0.54, 0.6], amp = isSel ? 1 : on ? 0.85 : 0.2;
        const m = a.trail.length / 3; let prev = this.pos(a.trail[0], a.trail[1], a.trail[2], V3());
        for (let k = 1; k <= m; k++) {
          const cur = k < m ? this.pos(a.trail[k * 3], a.trail[k * 3 + 1], a.trail[k * 3 + 2], V3()) : this.acPos[i];
          const o = n * 6, co = n * 8, a0 = (k - 1) / m, a1 = k / m;
          tp[o] = prev.x; tp[o + 1] = prev.y; tp[o + 2] = prev.z; tp[o + 3] = cur.x; tp[o + 4] = cur.y; tp[o + 5] = cur.z;
          tc[co] = col[0]; tc[co + 1] = col[1]; tc[co + 2] = col[2]; tc[co + 3] = a0 * a0 * amp; tc[co + 4] = col[0]; tc[co + 5] = col[1]; tc[co + 6] = col[2]; tc[co + 7] = a1 * a1 * amp;
          prev = cur; n++;
        }
      });
      this.trails.geometry.setDrawRange(0, n * 2); this.trails.geometry.attributes.position.needsUpdate = true; this.trails.geometry.attributes.color.needsUpdate = true;
    }
    // level of detail
    const d = rig.dist;
    this.cityPts[1].visible = d < 1500; this.cityPts[2].visible = d < 700; this.aptPts.visible = this.aptRings.visible = d < 1300; this.gcsPts.visible = this.contPts.visible = d < 1250;
    this.stateLines.material.opacity = d < 900 ? 0.34 : 0.22;
    // selection ring
    const sp3 = this.app.selPos();
    if (sp3) { const pul = (tReal * 0.9) % 1; this.ring.visible = this.ring2.visible = true; this.ring.position.copy(sp3); this.ring2.position.copy(sp3); this.ring.scale.setScalar(px * 16); this.ring2.scale.setScalar(px * (16 + pul * 20)); this.ring2.material.opacity = 0.7 * (1 - pul); }
    else this.ring.visible = this.ring2.visible = false;
    this._labels(px);
  }
  _labels(px) {
    const L = this.labels, cam = this.cam, W = this.W, H = this.H, d = this.rig.dist, scn = this.app.scn, sel = this.app.sel, sim = this.sim;
    const taken = [];
    const free = (l, w, h) => { if (!l.on) return false; const x0 = l.x - 6, y0 = l.y - h / 2 - 6, x1 = l.x + w + 6, y1 = l.y + h / 2 + 6; for (const r of taken) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false; taken.push([x0, y0, x1, y1]); return true; };
    const off = (key) => { const l = L.map.get(key); if (l && l.on) { l.on = false; l.d.style.display = 'none'; } };
    const put = (key, p, w, h, dx) => { L.place(key, p, cam, W, H, true); const l = L.map.get(key); if (l.on) { l.x += dx || 0; if (!free(l, w, h)) off(key); else l.d.style.transform = 'translate3d(' + (l.x).toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)'; } };
    // sites first: they always win. Each label takes the first free side of its marker, starting away from its nearest neighbour.
    const act = []; for (const id in this.siteObj) { const o = this.siteObj[id]; if (o.s.scn === scn) { this.tmp.copy(o.g.position).project(cam); act.push([(this.tmp.x * 0.5 + 0.5) * W, (-this.tmp.y * 0.5 + 0.5) * H, id]); } }
    for (const q of act) taken.push([q[0] - 7, q[1] - 7, q[0] + 7, q[1] + 7]);                        // no label may cover a site marker
    for (const id in this.siteObj) {
      const o = this.siteObj[id], on = o.s.scn === scn, l = L.get('s' + id), far = on && d > 1900; l.d.classList.toggle('dim', !on); l.d.classList.toggle('far', far); if (!on && d > 1500) { off('s' + id); continue; }
      const w = far ? o.s.name.length * 6.6 + 16 : on ? Math.max(o.s.name.length * 7.4, 130) + 18 : o.s.name.length * 6 + 12, h = far ? 20 : on ? 30 : 16, dx = on ? 14 : 10;
      L.place('s' + id, o.g.position, cam, W, H, true); if (!l.on) continue;
      const x = l.x, y = l.y;
      let east = false; if (on) for (const q of act) if (q[2] !== id && q[0] > x && q[0] < x + w + dx + 12 && Math.abs(q[1] - y) < h) east = true;
      const R = [dx, 0], Lf = [-w - dx, 0], Up = [-w / 2, -h - 6], Dn = [-w / 2, h + 6]; let ok = false;
      for (const c of (east ? [Lf, Up, Dn, R] : [R, Lf, Up, Dn])) { l.x = x + c[0]; l.y = y + c[1]; if (on && x > 0 && x < W && (l.x < 4 || l.x + w > W - 4)) continue; if (free(l, w, h)) { ok = true; break; } }
      if (!ok) { off('s' + id); continue; }
      l.d.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)';
    }
    // aircraft tags: selected always, the active scenario when zoomed in
    sim.aircraft.forEach((a, i) => {
      if (!this.inR(a.scn)) return;
      const key = 'a' + a.cs, isSel = sel && sel.type === 'aircraft' && sel.id === a.cs, show = isSel || (AIRBORNE[a.phase] && a.scn === scn && d < 900);
      if (!show) { off(key); return; }
      L.get(key).d.classList.toggle('sel', !!isSel);
      if (isSel) { L.place(key, this.acPos[i], cam, W, H, true, -16); taken.push([L.map.get(key).x - 4, L.map.get(key).y - 10, L.map.get(key).x + 70, L.map.get(key).y + 10]); }
      else { L.place(key, this.acPos[i], cam, W, H, true, -14); const l = L.map.get(key); if (l.on && !free(l, 58, 13)) off(key); }
    });
    for (const id in this.routeObj) { const o = this.routeObj[id]; if (o.R.scn !== scn || d > 3400 || (o.R.mro && d > 900)) { off('r' + id); continue; } put('r' + id, o.mid, 36, 14, 8); }
    for (const c of this.cities) {
      if ((c.tier === 2 && d > 620) || (c.tier === 1 && d > 1350)) { off(c.key); continue; }
      const w = c.n.length * 6.2 + 8, l = L.map.get(c.key);
      L.place(c.key, c.p, cam, W, H, true); if (!l.on) continue;
      const x = l.x; l.x = x + 7;
      if (free(l, w, 13)) { l.d.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)'; continue; }
      l.x = x - w - 3;                                                   // right side blocked: try the left of the dot
      if (free(l, w, 13)) l.d.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)'; else off(c.key);
    }
    for (const a of this.airports) { if (d > 950) { off(a.key); continue; } put(a.key, a.p, 28, 12, 8); }
    for (const g of this.contList) { if (g.scn !== scn || d > 620) { off(g.key); continue; } put(g.key, g.p, g.name.length * 5.6 + 8, 12, 8); }
    for (const g of this.gcsList) { if (g.scn !== scn || d > 520) { off(g.key); continue; } put(g.key, g.p, g.name.length * 5.6 + 8, 12, 8); }
    // graticule labels along the south and west edges
    const b = this.G.bbox;
    for (let lon = Math.ceil(b[0]) + 1; lon < b[1]; lon += 2) L.place('gx' + lon, this.tmp.set(this.mx(lon), 0.3, this.z1 + 14), cam, W, H, d < 2300);
    for (let lat = Math.ceil(b[2]) + 1; lat < b[3]; lat += 2) L.place('gy' + lat, this.tmp.set(this.x0 - 22, 0.3, this.mz(lat)), cam, W, H, d < 2300);
  }
  /* screen-space picking: nearest aircraft, site or corridor label under the pointer */
  pick(x, y) {
    const cam = this.cam, W = this.W, H = this.H, v = this.tmp, scn = this.app.scn; let best = null, bd = 22;
    const test = (p, type, id, r) => { v.copy(p).project(cam); if (v.z > 1) return; const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H, d = Math.hypot(sx - x, sy - y) - (r || 0); if (d < bd) { bd = d; best = { type, id }; } };
    this.sim.aircraft.forEach((a, i) => { if (AIRBORNE[a.phase] && this.inR(a.scn)) test(this.acPos[i], 'aircraft', a.cs, a.scn === scn ? 4 : 0); });
    for (const id in this.siteObj) test(this.siteObj[id].g.position, 'site', id, 8);
    if (!best) for (const id in this.routeObj) if (this.routeObj[id].R.scn === scn) test(this.routeObj[id].mid, 'route', id, 0);
    return best;
  }
  flyTo(lat, lon, dist, az, tilt, snap) { this.rig.follow = null; this.rig.goto(this.pos(lat, lon, 0), dist, az, tilt, snap); }
  render(r) { r.toneMapping = THREE.NoToneMapping; r.shadowMap.enabled = false; r.render(this.scene, this.cam); }
}
