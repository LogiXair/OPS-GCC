/* ============================================================================
   GRAPHICS FOUNDATION — renderer, procedural textures, materials, sky and light
   by time of day, ocean, weather particles, camera rig, labels.
   Everything is generated in code: the page loads no models or images.
   ========================================================================== */

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
/* every authored colour is sRGB; three r128 lights in linear, so convert once here */
const COL = h => new THREE.Color(h).convertSRGBToLinear();

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
}

/* ---------- noise ---------- */
function makeNoise(seed) {
  const rnd = mulberry32(seed), P = new Uint8Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const v = (x, y) => G[P[(P[x & 255] + y) & 255]];
  /* tileable value noise: `per` is the period in lattice cells */
  const n = (x, y, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const m = per || 256, x0 = ((xi % m) + m) % m, x1 = (x0 + 1) % m, y0 = ((yi % m) + m) % m, y1 = (y0 + 1) % m;
    return lerp(lerp(v(x0, y0), v(x1, y0), u), lerp(v(x0, y1), v(x1, y1), u), w);
  };
  n.fbm = (x, y, oct, per) => { let a = 0.5, f = 1, s = 0, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, per ? per * f : 0); t += a; a *= 0.5; f *= 2; } return s / t; };
  return n;
}

/* ---------- canvas textures ---------- */
function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function texOf(c, o) {
  o = o || {};
  const t = new THREE.CanvasTexture(c);
  t.encoding = o.linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
  t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = o.aniso || 8;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  return t;
}
/* paint a tileable surface: fn(u,v) -> [r,g,b] 0..255, returns canvas */
function paintTex(size, fn) {
  const c = cvs(size), g = c.getContext('2d'), im = g.createImageData(size, size), d = im.data;
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i += 4) {
    const p = fn(x / size, y / size, x, y);
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = p.length > 3 ? p[3] : 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

const TEX = {};
function buildTextures() {
  const n1 = makeNoise(11), n2 = makeNoise(29), rnd = mulberry32(5);
  // concrete apron: one tile = one 6 m slab bay with saw-cut joints
  let c = paintTex(512, (u, v) => {
    const m = n1.fbm(u * 24, v * 24, 4, 24), sp = n2(u * 220, v * 220, 220), br = n2(u * 6, v * 120, 120);
    let l = 150 + (m - 0.5) * 12 + (sp - 0.5) * 16 + (br - 0.5) * 5;
    const j = Math.min(u, 1 - u, v, 1 - v); if (j < 0.0035) l -= 30 * (1 - j / 0.0035);
    return [l * 1.0, l * 0.985, l * 0.955];
  });
  let g;
  TEX.concrete = c;
  // asphalt
  TEX.asphalt = paintTex(512, (u, v) => {
    const m = n1.fbm(u * 6 + 3, v * 6, 4, 6), sp = n2(u * 256, v * 256, 256);
    const l = 104 + (m - 0.5) * 22 + (sp - 0.5) * 34; return [l, l * 1.005, l * 1.02];
  });
  // dry Deccan ground after the monsoon: ochre soil with olive scrub
  TEX.ground = paintTex(1024, (u, v) => {
    const a = n1.fbm(u * 14, v * 14, 5, 14), b = n2.fbm(u * 60 + 4, v * 60, 3, 60), sp = n2(u * 512, v * 512, 512), tuft = n1(u * 190, v * 190, 190);
    const gmix = clamp01(smooth((a - 0.36) * 2.4) * 0.8 + (b - 0.5) * 0.7);
    const k = 0.78 + sp * 0.3 - (tuft > 0.7 ? (tuft - 0.7) * 0.9 : 0);
    return [lerp(216, 188, gmix) * k, lerp(188, 158, gmix) * k, lerp(142, 112, gmix) * k];       // desert sand and gravel
  });
  // ribbed cladding (colour + bump share one canvas): 8 ribs per tile, grime streaks
  TEX.rib = paintTex(256, (u, v) => {
    const r = Math.abs(((u * 8) % 1) - 0.5) * 2, rib = r < 0.3 ? 0.82 + r : 1.0;
    const streak = n1.fbm(u * 40, v * 1.5, 3, 40), top = 1 - 0.12 * smooth(v * 1.2) * streak;
    const l = 214 * rib * top; return [l, l, l];
  });
  // standing-seam roof
  TEX.roof = paintTex(256, (u, v) => {
    const s = (u * 6) % 1, seam = s < 0.07 ? 1.12 : s < 0.12 ? 0.8 : 1;
    const l = 176 * seam * (0.94 + 0.1 * n1.fbm(u * 10, v * 10, 3, 10)); return [l, l * 1.01, l * 1.03];
  });
  // non-skid steel deck
  TEX.deck = paintTex(512, (u, v) => {
    const sp = n2(u * 300, v * 300, 300), m = n1.fbm(u * 5, v * 5, 4, 5);
    let l = 78 + (sp - 0.5) * 34 + (m - 0.5) * 20; const j = Math.min(u, 1 - u, v, 1 - v); if (j < 0.004) l -= 22;
    return [l * 0.97, l, l * 1.03];
  });
  // weathered painted steel (hulls, topsides)
  TEX.plate = paintTex(512, (u, v) => {
    const m = n1.fbm(u * 4, v * 4, 5, 4), st = n2.fbm(u * 30, v * 2, 3, 30);
    let l = 206 + (m - 0.5) * 30 - smooth(v) * st * 26; const j = Math.min((u * 4) % 1, (v * 4) % 1); if (j < 0.012) l -= 16;
    return [l, l, l];
  });
  // glazing band: mullions, a few lit bays (alpha channel carries the lit mask for night)
  c = cvs(512, 128); g = c.getContext('2d'); g.fillStyle = '#1b2733'; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 16; i++) { const lit = rnd() < 0.45; g.fillStyle = lit ? '#31485c' : '#22313f'; g.fillRect(i * 32 + 2, 6, 28, 116); g.fillStyle = 'rgba(160,200,230,0.10)'; g.fillRect(i * 32 + 2, 6, 28, 40); }
  TEX.glass = c;
  c = cvs(512, 128); g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 16; i++) if (rnd() < 0.6) { g.fillStyle = rnd() < 0.5 ? '#ffd9a0' : '#cfe6ff'; g.fillRect(i * 32 + 2, 6, 28, 116); }
  TEX.glassLit = c;
  // soft round glow and propeller blur
  c = cvs(64); g = c.getContext('2d'); let gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); TEX.glow = c;
  c = cvs(256); g = c.getContext('2d'); g.translate(128, 128);
  gr = g.createRadialGradient(0, 0, 10, 0, 0, 128); gr.addColorStop(0, 'rgba(30,32,36,0)'); gr.addColorStop(0.2, 'rgba(30,32,36,0.20)'); gr.addColorStop(0.9, 'rgba(30,32,36,0.11)'); gr.addColorStop(0.975, 'rgba(232,82,63,0.16)'); gr.addColorStop(1, 'rgba(232,82,63,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 128, 0, 7); g.fill();
  for (let k = 0; k < 3; k++) { g.rotate(Math.PI * 2 / 3); const lg = g.createLinearGradient(0, -22, 0, 22); lg.addColorStop(0, 'rgba(20,22,26,0)'); lg.addColorStop(0.5, 'rgba(20,22,26,0.22)'); lg.addColorStop(1, 'rgba(20,22,26,0)'); g.fillStyle = lg; g.fillRect(12, -22, 112, 44); }
  TEX.prop = c;
}

/* ---------- materials ---------- */
const MAT = {};
function stdMat(o) { if (typeof o.color === 'number') o.color = COL(o.color); if (typeof o.emissive === 'number') o.emissive = COL(o.emissive); return new THREE.MeshStandardMaterial(o); }
function basicMat(o) { if (typeof o.color === 'number') o.color = COL(o.color); return new THREE.MeshBasicMaterial(o); }
function buildMaterials() {
  const rib = (rep) => texOf(TEX.rib, { repeat: rep }), bump = (cv, rep) => texOf(cv, { repeat: rep, linear: true });
  MAT.concrete = stdMat({ map: texOf(TEX.concrete), roughness: 0.93, metalness: 0 });
  MAT.asphalt = stdMat({ map: texOf(TEX.asphalt), roughness: 0.95 });
  MAT.ground = stdMat({ map: texOf(TEX.ground), roughness: 1 });
  MAT.deck = stdMat({ map: texOf(TEX.deck), roughness: 0.85, metalness: 0.15 });
  MAT.white = stdMat({ color: 0xE6E9EC, roughness: 0.42, metalness: 0.05 });
  MAT.offwhite = stdMat({ color: 0xD9DBD8, roughness: 0.7 });
  MAT.blue = stdMat({ color: 0x0B4F86, roughness: 0.4, metalness: 0.1 });
  MAT.dark = stdMat({ color: 0x1C1F24, roughness: 0.55, metalness: 0.3 });
  MAT.rubber = stdMat({ color: 0x141518, roughness: 0.9 });
  MAT.steel = stdMat({ color: 0x8E949B, roughness: 0.45, metalness: 0.8 });
  MAT.galv = stdMat({ color: 0xA9AFB4, roughness: 0.6, metalness: 0.55 });
  MAT.yellow = stdMat({ color: 0xE7B416, roughness: 0.6 });
  MAT.orange = stdMat({ color: 0xE8523F, roughness: 0.55 });
  MAT.red = stdMat({ color: 0xB3261E, roughness: 0.6 });
  MAT.green = stdMat({ color: 0x2E7D4F, roughness: 0.7 });
  MAT.navy = stdMat({ map: texOf(TEX.plate), color: 0x8A949C, roughness: 0.62, metalness: 0.25 });
  MAT.navyDark = stdMat({ color: 0x5B646C, roughness: 0.7, metalness: 0.2 });
  MAT.glass = stdMat({ color: 0x1A2733, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.4 });
  MAT.cladWhite = stdMat({ map: rib([1, 1]), bumpMap: bump(TEX.rib, [1, 1]), bumpScale: 0.03, color: 0xDDE0E0, roughness: 0.62, metalness: 0.25 });
  MAT.roof = stdMat({ map: texOf(TEX.roof), color: 0xC9CED2, roughness: 0.5, metalness: 0.45 });
  MAT.glow = basicMat({ color: 0xffffff });
  for (const k of ['concrete', 'asphalt', 'deck', 'ground']) MAT[k].userData.wet = true;      // these darken and gloss over in rain
}
/* a cladding material sized so one texture tile covers `tile` metres on a w x h wall */
function cladMat(color, w, h, tile) {
  tile = tile || 4;
  const m = MAT.cladWhite.clone();
  m.map = texOf(TEX.rib, { repeat: [w / tile, h / tile] }); m.bumpMap = texOf(TEX.rib, { repeat: [w / tile, h / tile], linear: true });
  m.color = COL(color); return m;
}
function tiled(base, w, h, tile) {
  const m = base.clone(); m.map = base.map.clone(); m.map.needsUpdate = true; m.map.repeat.set(w / tile, h / tile); return m;
}

/* ---------- small mesh helpers ---------- */
function mesh(geo, mat, parent, x, y, z, o) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0);
  o = o || {}; m.castShadow = o.cast !== false; m.receiveShadow = o.recv !== false;
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  if (parent) parent.add(m); return m;
}
const GC = {};
function box(w, h, d) { const k = 'b' + w + '_' + h + '_' + d; return GC[k] || (GC[k] = new THREE.BoxGeometry(w, h, d)); }
function cyl(rt, rb, h, seg) { const k = 'c' + rt + '_' + rb + '_' + h + '_' + (seg || 16); return GC[k] || (GC[k] = new THREE.CylinderGeometry(rt, rb, h, seg || 16)); }
function sph(r, ws, hs) { const k = 's' + r + '_' + (ws || 16); return GC[k] || (GC[k] = new THREE.SphereGeometry(r, ws || 16, hs || 12)); }
/* box resting on the ground at (x, z) */
function block(parent, mat, x, z, w, h, d, y0, o) { return mesh(box(w, h, d), mat, parent, x, (y0 || 0) + h / 2, z, o); }
/* tube between two points */
function tube(parent, mat, a, b, r, seg) {
  const d = b.clone().sub(a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, seg || 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  m.castShadow = true; m.receiveShadow = true; if (parent) parent.add(m); return m;
}
/* loft a closed skin through super-elliptic cross-sections along z: sections = [{z, w, h, y, e}] (half-width, half-height) */
function loft(sections, seg, capStart, capEnd) {
  seg = seg || 20; const pos = [], idx = [], n = sections.length, desc = sections[0].z > sections[n - 1].z;   // keep faces outward whichever way z runs
  for (let i = 0; i < n; i++) {
    const s = sections[i], e = 2 / (s.e || 2.4);
    for (let j = 0; j < seg; j++) {
      const a = j / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(Math.sign(ca) * Math.pow(Math.abs(ca), e) * s.w + (s.x || 0), Math.sign(sa) * Math.pow(Math.abs(sa), e) * s.h + (s.y || 0), s.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    desc ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
  }
  const cap = (i, flip) => { flip = flip !== desc; const s = sections[i], ci = pos.length / 3; pos.push(s.x || 0, s.y || 0, s.z); for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg; flip ? idx.push(ci, b, a) : idx.push(ci, a, b); } };
  if (capStart !== false) cap(0, true); if (capEnd !== false) cap(n - 1, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/* decal plane with a canvas texture */
function decal(parent, canvas, w, h, x, y, z, o) {
  o = o || {};
  const t = texOf(canvas, { clamp: true });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: o.rough == null ? 0.8 : o.rough, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.set(x, y, z); if (o.flat !== false) m.rotation.x = -Math.PI / 2; if (o.ry) (o.flat !== false ? (m.rotation.z = o.ry) : (m.rotation.y = o.ry));
  m.receiveShadow = true; m.renderOrder = o.order || 2; if (parent) parent.add(m); return m;
}
function textCanvas(text, o) {
  o = o || {}; const w = o.w || 512, h = o.h || 128, c = cvs(w, h), g = c.getContext('2d');
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = o.color || '#fff'; g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
  g.font = (o.weight || 800) + ' ' + (o.size || Math.floor(h * 0.62)) + 'px ' + (o.font || 'Archivo, Helvetica, Arial, sans-serif');
  if (o.spacing && g.letterSpacing !== undefined) g.letterSpacing = o.spacing;
  g.fillText(text, o.align === 'left' ? (o.pad || 10) : w / 2, h / 2 + (o.dy || 0));
  return c;
}

/* ---------- sky, sun and atmosphere ---------- */
const SKY_VS = 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }';
const SKY_FS = `
uniform vec3 sunDir; uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunCol; uniform float night; uniform float haze; uniform float gain;
varying vec3 vDir;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(horizon, top, pow(max(h, 0.0), mix(0.45, 0.8, haze)));
  col = mix(col, ground, smoothstep(0.0, -0.18, h));
  float s = max(dot(d, sunDir), 0.0);
  float low = 1.0 - smoothstep(0.0, 0.5, abs(h));
  col += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 48.0) * 0.30 + pow(s, 5.0) * 0.16 * low) * (1.0 - haze * 0.75);
  float st = step(0.9982, hash(floor(d * 260.0))) * night * smoothstep(0.03, 0.35, h) * (1.0 - haze);
  col = col * gain + vec3(st) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

class Atmosphere {
  constructor(scene, renderer, o) {
    o = o || {};
    this.scene = scene; this.renderer = renderer; this.range = o.shadowRange || 120;
    this.uni = { sunDir: { value: V3(0, 1, 0) }, top: { value: COL(0) }, horizon: { value: COL(0) }, ground: { value: COL(0) }, sunCol: { value: COL(0) }, night: { value: 0 }, haze: { value: 0 }, gain: { value: 1 } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }));
    this.dome.scale.setScalar(o.domeR || 9000); this.dome.frustumCulled = false; this.dome.renderOrder = -10; scene.add(this.dome);
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    const sm = this.sun.shadow; sm.mapSize.set(o.shadowSize || 2048, o.shadowSize || 2048); sm.bias = -0.0004; sm.normalBias = 0.06;
    const c = sm.camera; c.left = -this.range; c.right = this.range; c.top = this.range; c.bottom = -this.range; c.near = 10; c.far = 900;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0x999999, 0.0002);
    this.pmrem = new THREE.PMREMGenerator(renderer); this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, this.dome.material); this.envDome.scale.setScalar(50); this.envScene.add(this.envDome);
    this.envKey = ''; this.state = null; this.darkness = 0;
  }
  /* hour: local solar-ish clock 0..24; wx: CLEAR | HAZE | RAIN | FOG */
  set(hour, wx) {
    const rise = 6.15, set = 17.9, day = (hour - rise) / (set - rise);
    let elev, az;
    if (day >= 0 && day <= 1) { elev = Math.sin(day * Math.PI) * 61; az = lerp(98, 262, day); }
    else { const nt = hour > set ? (hour - set) / (24 - set + rise) : (hour + 24 - set) / (24 - set + rise); elev = -Math.sin(nt * Math.PI) * 50; az = lerp(262, 458, nt); }
    const K = [ // elevation keyframes: top, horizon, ground haze, sun colour, sun intensity, hemi sky, hemi ground, hemi intensity, exposure, sky gain
      [-12, 0x070B14, 0x111A28, 0x080A0E, 0x7F95C0, 0.14, 0x26334F, 0x0B0D12, 0.12, 1.15, 1.0],
      [-4,  0x16233F, 0x6A4F66, 0x17191F, 0xC98A6A, 0.00, 0x45547A, 0x1A1B20, 0.22, 1.00, 1.0],
      [0,   0x2F4C80, 0xE8956A, 0x54483F, 0xFF9A52, 0.80, 0x7088B0, 0x4A3B30, 0.28, 0.80, 1.2],
      [7,   0x4270AE, 0xF4C797, 0x8A7964, 0xFFC088, 1.55, 0xB0BBCB, 0x756350, 0.32, 0.64, 1.4],
      [22,  0x3F7FCC, 0xCFE1F1, 0xA4A396, 0xFFEFD8, 1.85, 0xCDD6E2, 0x8A8170, 0.36, 0.56, 1.6],
      [61,  0x3676C8, 0xC2DAF0, 0xACAB9E, 0xFFF8EC, 1.95, 0xD2DBE6, 0x8F8672, 0.38, 0.52, 1.7]
    ];
    let i = 0; while (i < K.length - 2 && elev > K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1], t = clamp01((elev - a[0]) / (b[0] - a[0]));
    const mc = k => COL(a[k]).lerp(COL(b[k]), t), mv = k => lerp(a[k], b[k], t);
    const S = { top: mc(1), horizon: mc(2), ground: mc(3), sunCol: mc(4), sunI: mv(5), hemiSky: mc(6), hemiGnd: mc(7), hemiI: mv(8), exposure: mv(9), gain: mv(10), fog: 0.00016, haze: 0 };
    const grey = (c, to, k) => c.lerp(COL(to), k);
    if (wx === 'HAZE') { grey(S.top, 0x9FB2C4, 0.45); grey(S.horizon, 0xD8D6CC, 0.55); S.sunI *= 0.78; S.hemiI *= 1.1; S.fog = 0.00048; S.haze = 0.45; }
    if (wx === 'RAIN') { const g1 = elev > 0 ? 0x5F6A76 : 0x0B0E14, g2 = elev > 0 ? 0x939CA4 : 0x12161D; grey(S.top, g1, 0.92); grey(S.horizon, g2, 0.92); grey(S.ground, g2, 0.8); S.sunI *= 0.22; S.hemiI *= 1.25; grey(S.hemiSky, 0xAEB7C0, 0.7); S.fog = 0.0009; S.haze = 0.95; S.exposure *= 0.95; }
    if (wx === 'FOG') { const g2 = elev > 0 ? 0xB9BEBE : 0x15191E; grey(S.top, g2, 0.94); grey(S.horizon, g2, 0.97); grey(S.ground, g2, 0.97); S.sunI *= 0.14; S.hemiI *= 1.3; grey(S.hemiSky, 0xC8CCCC, 0.8); S.fog = 0.0042; S.haze = 1; }
    const nightK = clamp01((-elev - 1) / 7);
    this.darkness = clamp01((6 - elev) / 10) + (wx === 'RAIN' || wx === 'FOG' ? 0.1 * (1 - clamp01((6 - elev) / 10)) : 0);
    // below the horizon the key light becomes the moon, high in the south-east
    let lightElev = elev, lightAz = az;
    if (elev < 0.5) { lightElev = 52; lightAz = 130; S.sunI = Math.max(S.sunI * clamp01((elev + 4) / 4.5), 0.16 * nightK + 0.02); }
    const e = lightElev * DEG, z = lightAz * DEG;
    const dir = V3(Math.sin(z) * Math.cos(e), Math.sin(e), -Math.cos(z) * Math.cos(e));
    const sunVis = V3(Math.sin(az * DEG) * Math.cos(elev * DEG), Math.sin(elev * DEG), -Math.cos(az * DEG) * Math.cos(elev * DEG));
    const u = this.uni; u.sunDir.value.copy(sunVis); u.top.value.copy(S.top); u.horizon.value.copy(S.horizon); u.ground.value.copy(S.ground);
    u.sunCol.value.copy(S.sunCol).multiplyScalar(elev > -3 ? 1 : 0); u.night.value = nightK; u.haze.value = S.haze; u.gain.value = S.gain;
    this.sun.color.copy(elev < 0.5 ? COL(0x8FA6D0) : S.sunCol); this.sun.intensity = S.sunI;
    this.hemi.color.copy(S.hemiSky); this.hemi.groundColor.copy(S.hemiGnd); this.hemi.intensity = S.hemiI;
    this.scene.fog.color.copy(S.horizon).lerp(S.ground, 0.25); this.scene.fog.density = S.fog;
    this.renderer.toneMappingExposure = S.exposure;
    this.dir = dir; this.elev = elev; this.night = nightK; this.S = S; this.sunVis = sunVis; this.wx = wx;
    const key = Math.round(elev / 2.5) + wx;
    if (key !== this.envKey) { this.envKey = key; const rt = this.pmrem.fromScene(this.envScene, 0.02); if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture; }
  }
  /* keep the shadow frustum centred on what the camera is looking at */
  follow(target, range) {
    const r = range || this.range, c = this.sun.shadow.camera;
    if (c.right !== r) { c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.updateProjectionMatrix(); }
    const snap = r / 256; const tx = Math.round(target.x / snap) * snap, tz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(tx, 0, tz); this.sun.position.set(tx, 0, tz).addScaledVector(this.dir, 420);
    this.dome.position.copy(target);
  }
}

/* ---------- ocean ---------- */
const SEA_VS = `
uniform float time; uniform vec2 drift; uniform float chop;
varying vec3 vW; varying vec3 vN; varying float vCrest;
#include <fog_pars_vertex>
vec3 wave(vec2 p, vec2 d, float k, float a, float sp, inout vec3 n){
  float ph = dot(d, p) * k + time * sp; float c = cos(ph), s = sin(ph);
  n.x -= d.x * k * a * c; n.z -= d.y * k * a * c; return vec3(-d.x * a * 0.6 * c, a * s, -d.y * a * 0.6 * c);
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0); vec2 p = wp.xz + drift; vec3 n = vec3(0.0, 1.0, 0.0);
  float fade = 1.0 - smoothstep(600.0, 2600.0, length(wp.xz - cameraPosition.xz));
  vec3 o = vec3(0.0);
  o += wave(p, normalize(vec2(0.86, 0.5)), 0.052, 0.55 * chop, 0.82, n);
  o += wave(p, normalize(vec2(0.55, 0.83)), 0.094, 0.30 * chop, 1.12, n);
  o += wave(p, normalize(vec2(-0.3, 0.95)), 0.19, 0.14 * chop, 1.7, n);
  o += wave(p, normalize(vec2(0.97, -0.2)), 0.37, 0.06 * chop, 2.4, n);
  wp.xyz += o * fade; vCrest = o.y; vW = wp.xyz; vN = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SEA_FS = `
uniform float time; uniform vec2 drift; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 deep; uniform vec3 shallow; uniform vec3 sky; uniform vec3 skyTop; uniform float chop;
varying vec3 vW; varying vec3 vN; varying float vCrest;
#include <fog_pars_fragment>
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 p = vW.xz + drift; float t = time;
  // fine ripples perturb the normal
  float e = 0.35; vec2 q1 = p * 0.9 + vec2(t * 0.6, t * 0.35), q2 = p * 2.3 - vec2(t * 0.5, -t * 0.7);
  float r0 = vn(q1) + 0.5 * vn(q2), rx = vn(q1 + vec2(e, 0)) + 0.5 * vn(q2 + vec2(e, 0)), rz = vn(q1 + vec2(0, e)) + 0.5 * vn(q2 + vec2(0, e));
  float dist = length(vW - cameraPosition);
  float near = 1.0 / (1.0 + dist * 0.012);
  vec3 n = normalize(vN + vec3(r0 - rx, 0.0, r0 - rz) * 0.6 * chop * near);
  vec3 v = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n); float up = clamp(refl.y, 0.0, 1.0);
  vec3 skyc = mix(sky, skyTop, pow(up, 0.5));
  float swell = vn(p * 0.012 + vec2(t * 0.01, 0.0)) * 0.6 + vn(p * 0.045 - vec2(0.0, t * 0.02)) * 0.4;
  vec3 body = mix(deep, shallow, clamp(vCrest * 0.45 + 0.2 + (swell - 0.5) * 0.5, 0.0, 1.0) * 0.55);
  vec3 col = mix(body, skyc, fres);
  // sun glitter: tight close in, broadened and dimmed with distance so it never aliases into blotches
  float sd = max(dot(refl, sunDir), 0.0);
  col += sunCol * (pow(sd, mix(40.0, 260.0, near)) * mix(0.25, 2.0, near) + pow(sd, 8.0) * 0.05);
  float cap = smoothstep(0.62, 0.95, vCrest / (0.9 * chop + 0.001) * 0.55 + vn(p * 0.9 + t * 0.2) * 0.45);
  col = mix(col, vec3(0.9, 0.93, 0.95) * (0.2 + dot(sunCol, vec3(0.3))), cap * 0.35 * smoothstep(0.6, 1.2, chop) * (1.0 - smoothstep(120.0, 500.0, dist)));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
}`;
class Ocean {
  constructor(scene, size) {
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, drift: { value: new THREE.Vector2() }, chop: { value: 1 }, sunDir: { value: V3(0, 1, 0) }, sunCol: { value: COL(0xffffff) },
      deep: { value: COL(0x0A2B40) }, shallow: { value: COL(0x1B5870) }, sky: { value: COL(0x9FC3E6) }, skyTop: { value: COL(0x2E6BB5) } }]);
    const g = new THREE.PlaneGeometry(size, size, 220, 220); g.rotateX(-Math.PI / 2);
    // denser mesh near the centre, stretched outward
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (size / 2), z = p.getZ(i) / (size / 2); const f = v => Math.sign(v) * Math.pow(Math.abs(v), 2.2) * size / 2; p.setX(i, f(x)); p.setZ(i, f(z)); }
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: SEA_VS, fragmentShader: SEA_FS, fog: true }));
    this.mesh.receiveShadow = false; this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  update(t, atm, chop) {
    const u = this.uni; u.time.value = t; u.sunDir.value.copy(atm.sunVis.y > 0 ? atm.sunVis : atm.dir);
    u.sunCol.value.copy(atm.sun.color).multiplyScalar(Math.min(1.4, atm.sun.intensity + 0.05));
    u.sky.value.copy(atm.S.horizon); u.skyTop.value.copy(atm.S.top); u.chop.value = chop;
    const d = clamp01(atm.sun.intensity + atm.hemi.intensity * 0.4);
    u.deep.value.copy(COL(0x0A2B40)).multiplyScalar(0.12 + 0.88 * d); u.shallow.value.copy(COL(0x1B5870)).multiplyScalar(0.12 + 0.88 * d);
  }
}

/* ---------- rain ---------- */
class Rain {
  constructor(scene, n) {
    const pos = new Float32Array(n * 6), rnd = mulberry32(77);
    for (let i = 0; i < n; i++) { const x = (rnd() - 0.5) * 240, y = rnd() * 90, z = (rnd() - 0.5) * 240; pos.set([x, y, z, x + 0.25, y - 1.5, z + 0.1], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.uni = { time: { value: 0 }, origin: { value: V3() }, op: { value: 0.3 } };
    this.obj = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.uni, transparent: true, depthWrite: false,
      vertexShader: 'uniform float time; uniform vec3 origin; void main(){ vec3 p = position; p.y = mod(p.y - time * 34.0, 90.0); p.xz = mod(p.xz - origin.xz + 120.0, 240.0) - 120.0 + origin.xz; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }',
      fragmentShader: 'uniform float op; void main(){ gl_FragColor = vec4(0.82, 0.86, 0.9, op); }' }));
    this.obj.frustumCulled = false; this.obj.visible = false; scene.add(this.obj);
  }
  update(t, target, on) { this.obj.visible = on; if (!on) return; this.uni.time.value = t; this.uni.origin.value.copy(target); }
}

/* ---------- camera rig: pan / orbit / zoom with glide and follow ---------- */
class Rig {
  constructor(camera, o) {
    this.cam = camera; this.o = o;
    this.t = V3(); this.dist = o.dist || 100; this.az = o.az || 0; this.tilt = o.tilt || 50;
    this.gt = V3(); this.gdist = this.dist; this.gaz = this.az; this.gtilt = this.tilt;
    this.follow = null; this.groundY = 0;
  }
  goto(t, dist, az, tilt, snap) {
    if (t) this.gt.copy(t); if (dist != null) this.gdist = dist; if (az != null) this.gaz = az; if (tilt != null) this.gtilt = tilt;
    this.clampGoal();
    if (snap) { this.t.copy(this.gt); this.dist = this.gdist; this.az = this.gaz; this.tilt = this.gtilt; }
  }
  clampGoal() { const o = this.o; this.gdist = clamp(this.gdist, o.minDist, o.maxDist); this.gtilt = clamp(this.gtilt, o.minTilt, o.maxTilt);
    if (o.bounds) { this.gt.x = clamp(this.gt.x, o.bounds[0], o.bounds[1]); this.gt.z = clamp(this.gt.z, o.bounds[2], o.bounds[3]); } }
  pan(dx, dy) {            // screen pixels
    const k = this.dist * 2 * Math.tan(this.cam.fov * DEG / 2) / this.cam.viewH;
    const a = this.az * DEG, sx = Math.cos(a), sz = Math.sin(a), f = 1 / Math.max(0.35, Math.sin(this.tilt * DEG));
    this.gt.x -= (dx * sx - dy * sz * f) * k; this.gt.z -= (dx * sz + dy * sx * f) * k; this.follow = null; this.clampGoal();
  }
  orbit(dx, dy) { this.gaz -= dx * 0.28; this.gtilt += dy * 0.22; this.clampGoal(); }
  zoom(f) { this.gdist *= f; this.clampGoal(); }
  update(dt) {
    if (this.follow) { const p = this.follow(); if (p) this.gt.copy(p); }
    const k = 1 - Math.exp(-dt * (this.follow ? 6 : 5.5)), kz = 1 - Math.exp(-dt * 5);
    this.t.lerp(this.gt, k); this.dist = lerp(this.dist, this.gdist, kz);
    this.az += wrap180(this.gaz - this.az) * kz; this.tilt = lerp(this.tilt, this.gtilt, kz);
    const a = this.az * DEG, e = this.tilt * DEG, c = this.cam;
    c.position.set(this.t.x - Math.sin(a) * Math.cos(e) * this.dist, this.t.y + Math.sin(e) * this.dist, this.t.z + Math.cos(a) * Math.cos(e) * this.dist);
    if (c.position.y < this.groundY + 1.2) c.position.y = this.groundY + 1.2;
    c.lookAt(this.t);
  }
}

/* ---------- HTML labels pinned to 3D points ---------- */
class Labels {
  constructor(el) { this.el = el; this.map = new Map(); this.v = V3(); }
  get(key, cls, html) {
    let l = this.map.get(key);
    if (!l) { const d = document.createElement('div'); d.className = 'lbl ' + (cls || ''); if (html != null) d.innerHTML = html; this.el.appendChild(d); l = { d, html, on: true, cls }; this.map.set(key, l); }
    return l;
  }
  text(key, html) { const l = this.map.get(key); if (l && l.html !== html) { l.html = html; l.d.innerHTML = html; } }
  place(key, p, cam, W, H, show, dy) {
    const l = this.map.get(key); if (!l) return;
    let on = show !== false;
    if (on) { this.v.copy(p).project(cam); on = this.v.z < 1 && this.v.z > -1 && Math.abs(this.v.x) < 1.15 && Math.abs(this.v.y) < 1.15; }
    if (on !== l.on) { l.on = on; l.d.style.display = on ? '' : 'none'; }
    if (on) { l.x = (this.v.x * 0.5 + 0.5) * W; l.y = (-this.v.y * 0.5 + 0.5) * H + (dy || 0); l.d.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0)'; }
  }
  hideAll() { for (const l of this.map.values()) if (l.on) { l.on = false; l.d.style.display = 'none'; } }
  remove(key) { const l = this.map.get(key); if (l) { l.d.remove(); this.map.delete(key); } }
  clear() { for (const l of this.map.values()) l.d.remove(); this.map.clear(); }
}

function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry && !Object.values(GC).includes(o.geometry)) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { if (Object.values(MAT).includes(m)) continue; for (const k of ['map', 'bumpMap', 'emissiveMap', 'alphaMap']) if (m[k] && m[k].dispose) m[k].dispose(); m.dispose(); }
  });
}
