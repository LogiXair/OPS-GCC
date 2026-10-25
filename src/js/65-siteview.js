/* ============================================================================
   SITE VIEW — the 1:1 scene for one site (1 unit = 1 m), driven by the same
   simulation state as the map. Pads, pod shuttles, bowsers and aircraft take
   their state from the sim every frame; nothing here invents motion of its own
   except water, rotors and lamps.
   ========================================================================== */

const HALO_VS = 'attribute float size; attribute vec3 color; attribute float blink; uniform float scale; uniform float time; uniform float dark; varying vec3 vc; varying float va; void main(){ vc = color; float b = blink > 0.5 ? step(0.5, fract(time * 0.55 + blink)) : 1.0; va = b * mix(0.12, 1.0, dark); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z) * mix(0.55, 1.0, dark); gl_Position = projectionMatrix * mv; }';
const HALO_FS = 'uniform sampler2D map; varying vec3 vc; varying float va; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vc * a * va, 1.0); }';

const DRY = new WeakMap();        // dry-weather look of each ground material (kept off userData, which three clones as JSON)
const wetPods = st => { let n = 0; for (const k in WET_TYPES) n += (st.fin.by[k] ? st.fin.by[k].pods : 0) + (st.fout.by[k] ? st.fout.by[k].pods : 0); return n; };
class SiteView {
  constructor(app) {
    this.app = app; this.sim = app.sim;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(36, 1, 0.6, 14000);
    this.rig = new Rig(this.cam, { minDist: 7, maxDist: 900, minTilt: 2, maxTilt: 88 });
    this.atm = new Atmosphere(this.scene, app.renderer, { shadowRange: 130, shadowSize: 2048, domeR: 11000 });
    this.labels = new Labels(document.getElementById('labels-site'));
    this.rain = new Rain(this.scene, 6000);
    buildAircraftAssets();
    this.pool = []; for (let i = 0; i < 16; i++) { const m = new L560Model(); m.root.visible = false; this.scene.add(m.root); this.pool.push({ m, cs: null }); }
    const rg = new THREE.RingGeometry(0.965, 1, 72); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: COL(0xE8523F), transparent: true, opacity: 0.95, depthWrite: false })); this.ring.renderOrder = 6; this.ring.visible = false; this.scene.add(this.ring);
    this.ring2 = new THREE.Mesh(rg, this.ring.material.clone()); this.ring2.renderOrder = 6; this.scene.add(this.ring2);
    this.lampMat = stdMat({ color: 0x4A4A46, emissive: 0xFFF1D6, emissiveIntensity: 0, roughness: 0.4 });
    this.site = null; this.root = null; this.tmp = V3(); this.t = 0; this.wetK = -1;
  }

  /* ----- builder context ----- */
  halo(x, y, z, color, size, blink) { this._h.push(x, y, z, color, size, blink ? 0.01 + Math.random() : 0); }
  /* a deck or yard floodlight: glow by day, a real light after dark (a handful per site at most) */
  lamp(x, y, z, ax, ay, az, reach) {
    this.halo(x, y, z, 0xFFF1D6, 4.2);
    if (this.spots.length < 5) { const s = new THREE.SpotLight(COL(0xFFE9C4), 0, reach || 110, 1.0, 0.7, 1.3); s.position.set(x, y, z); s.target.position.set(ax, ay, az); this.root.add(s); this.root.add(s.target); this.spots.push(s); }
  }
  asset(key, name, tag, pos, desc) { this.assets.push({ key, name, tag, pos, desc }); this.labels.get('as' + key, 'asset', '<b>' + name + '</b><i>' + tag + '</i>'); }
  needOcean(y, chop) { this.ocean = new Ocean(this.root, 14000); this.ocean.mesh.position.y = y; this.chop = chop; }
  glassBand(g, w, d, y, h, cx, cz) {
    const m = stdMat({ map: texOf(TEX.glass, { repeat: [Math.max(1, Math.round(Math.max(w, d) / 16)), 1] }), emissiveMap: texOf(TEX.glassLit, { repeat: [Math.max(1, Math.round(Math.max(w, d) / 16)), 1] }), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.12, metalness: 0.7 });
    this.litMats.push(m); return block(g, m, cx || 0, cz || 0, w + 0.08, h, d + 0.08, y, { cast: false });
  }
  addPad(p, i, kind) {
    const S = this.site, y = S.padElev, root = this.root, h = p.hdg * DEG, P = { p, i, kind };
    decal(root, padCanvas(p.id, kind), 16, 16, p.x, y + 0.03, p.z, { ry: -h });
    if (kind === 'land') for (let k = 0; k < 12; k++) {
      const s = Math.floor(k / 3), f = (k % 3) / 3 + 1 / 6, e = 5.0, q = [[-e + 2 * e * f, -e], [e, -e + 2 * e * f], [e - 2 * e * f, e], [-e, e - 2 * e * f]][s];
      mesh(sph(0.07, 8, 6), basicMat({ color: 0x38FF9A }), root, p.x + q[0], y + 0.07, p.z + q[1], { cast: false }); this.halo(p.x + q[0], y + 0.1, p.z + q[1], 0x38FF9A, 0.9);
    }
    // pad status beacon
    const fwd = [Math.sin(h), -Math.cos(h)], rgt = [Math.cos(h), Math.sin(h)], bx = p.x + rgt[0] * 6.2 + fwd[0] * 6.2, bz = p.z + rgt[1] * 6.2 + fwd[1] * 6.2;
    if (kind === 'land') { mesh(cyl(0.05, 0.07, 1.3, 8), MAT.galv, root, bx, y + 0.65, bz); }
    P.beaconMat = basicMat({ color: 0x38FF9A }); P.beacon = mesh(sph(0.13, 10, 8), P.beaconMat, root, bx, y + (kind === 'land' ? 1.38 : 0.2), bz, { cast: false });
    P.pos = V3(p.x, y, p.z); P.lblPos = V3(bx, y + (kind === 'land' ? 2.2 : 1.2), bz); this.labels.get('pad' + i, 'pad', p.id);
    // a low safety fence round each land pad, open on the side the pod shuttle comes from
    if (kind === 'land') {
      const F = 6.4, dx0 = p.door ? p.door[0] - p.x : 0, dz0 = p.door ? p.door[1] - p.z : -1, open = Math.abs(dx0) > Math.abs(dz0) ? (dx0 > 0 ? 1 : 3) : (dz0 > 0 ? 2 : 0);
      const c = [[p.x - F, p.z - F], [p.x + F, p.z - F], [p.x + F, p.z + F], [p.x - F, p.z + F]];   // sides: 0 north, 1 east, 2 south, 3 west
      for (let sd = 0; sd < 4; sd++) { if (sd === open) continue; const a = c[sd], b = c[(sd + 1) % 4]; const fg = fence(root, [a, b], 1.1); if (fg) fg.position.y = y; }
      if (open === 0 || open === 2) { const zz = open === 0 ? p.z - F : p.z + F; fence(root, [[p.x - F, zz], [p.x - 2.2, zz]], 1.1); fence(root, [[p.x + 2.2, zz], [p.x + F, zz]], 1.1); }
      else { const xx = open === 1 ? p.x + F : p.x - F; fence(root, [[xx, p.z - F], [xx, p.z - 2.2]], 1.1); fence(root, [[xx, p.z + 2.2], [xx, p.z + F]], 1.1); }
    }
    // door and shuttle
    if (S.def.layout !== 'mro' && p.door) {
      const dx = p.x - p.door[0], dz = p.z - p.door[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      const face = Math.abs(uz) > Math.abs(ux) ? (uz > 0 ? 's' : 'n') : (ux > 0 ? 'e' : 'w');
      const dg = new THREE.Group(); dg.position.y = y; root.add(dg);
      P.door = rollerDoor(dg, p.door[0], p.door[1], kind === 'land' ? 3.4 : 2.6, kind === 'land' ? 3.0 : 2.4, face);
      const a = makeAGV(); a.g.rotation.y = Math.atan2(ux, uz); root.add(a.g); P.agv = a; P.path = { x: p.door[0], z: p.door[1], ux, uz, L };
      lineDecal(root, p.door[0] + ux * 0.4, p.door[1] + uz * 0.4, p.x - ux * 3.0, p.z - uz * 3.0, 1.5, 'rgba(46,160,110,0.55)', 0, y + 0.025);
    }
    // refuelling hose from the bowser stop to the port
    const lane = S.bowsers.find(b => b.lanePads.includes(i));
    if (lane) {
      const side = (-Math.cos(h)) * 1 > 0 ? 1 : -1, px = p.x + (-Math.cos(h)) * side * 0.42 + Math.sin(h) * 0.9, pz = p.z + (-Math.sin(h)) * side * 0.42 - Math.cos(h) * 0.9;
      const rx = p.x + 3.2 + 1.35 * Math.sign(p.x + 3.2 - lane.home || 1), c = new THREE.QuadraticBezierCurve3(V3(rx, 1.55, lane.z), V3((rx + px) / 2 + 0.8, 0.02, (lane.z + pz) / 2), V3(px, 1.72, pz));
      P.hose = mesh(new THREE.TubeGeometry(c, 20, 0.035, 6), MAT.rubber, root); P.hose.visible = false;
    }
    // maintenance kit, shown during a check
    const mk = new THREE.Group(); mk.position.set(p.x, y, p.z); mk.rotation.y = -h; root.add(mk); mk.visible = false; P.mx = mk;
    for (const [cx, cz] of [[-5, -4], [5, -4], [5, 4], [-5, 4]]) mesh(new THREE.ConeGeometry(0.18, 0.5, 10), MAT.orange, mk, cx, 0.25, cz);
    block(mk, MAT.yellow, 2.4, 0.6, 1.2, 0.08, 1.6, 1.25); for (const [ax, az] of [[1.9, -0.1], [2.9, -0.1], [1.9, 1.3], [2.9, 1.3]]) mesh(cyl(0.03, 0.03, 1.25, 6), MAT.galv, mk, ax, 0.63, az);
    block(mk, MAT.red, -2.6, -1.0, 0.9, 0.9, 0.55); block(mk, MAT.blue, -2.6, 0.6, 0.7, 1.1, 0.5);
    this.pads.push(P);
  }

  /* truck dock: pose the vehicle, the pod, the forklift and the pallets from each station's state */
  _dock() {
    const S = this.site; if (!S.dock) return;
    const REACH = 1.54, va = V3(), vb = V3();
    for (const K of this.docks) {
      const st = S.dock.st[K.i], f = st.dur > 0 ? clamp01(st.t / st.dur) : 0, c = K.c, build = st.job === 'BUILD', mv = st.state === 'MOVE';
      const key = st.job + st.type + st.veh; if (key !== K.key && st.job) { K.key = key; const T = POD_TYPES[st.type]; K.pod.shell.color.copy(COL(T.color)); K.pod.stripe.color.copy(COL(T.stripe)); for (const p of K.pod.pals) palletType(p, st.type); for (const t of K.trucks) for (const p of t.pals) palletType(p, st.type); palletType(K.fk.pal, st.type); }
      // vehicle along its lane
      const T = K.trucks[st.veh % K.trucks.length]; for (const t of K.trucks) if (t !== T) t.g.visible = false;
      const put = (curve, u) => { const p = curve.getPointAt(clamp01(u)), t = curve.getTangentAt(clamp01(u)); T.g.position.copy(p); T.g.rotation.y = Math.atan2(t.x, t.z); };
      T.g.visible = st.state !== 'IDLE';
      if (st.state === 'V_IN') put(K.pathIn, 1 - Math.pow(1 - f, 1.7)); else if (mv) put(K.pathIn, 1); else if (st.state === 'V_OUT') put(K.pathOut, Math.pow(clamp01((f - 0.14) / 0.86), 1.7));
      // pod: out of the wall door, side door up, then closed and back inside
      let vis = false, off = 1, open = 0;
      if (st.state === 'V_IN') { vis = f > 0.25; off = 1 - smooth((f - 0.25) / 0.3); open = smooth((f - 0.62) / 0.3); }
      else if (mv) { vis = true; off = 0; open = 1; }
      else if (st.state === 'V_OUT') { vis = f < 0.3; open = 1 - smooth(f / 0.1); off = smooth((f - 0.1) / 0.2); }
      const pg = K.pod.g; pg.visible = vis; pg.position.set(c.x + c.into[0] * off * 3.9, K.yA + 0.55, c.z + c.into[1] * off * 3.9);
      K.pod.door.rotation.z = -open * 1.9; K.pod.open.visible = open > 0.015; K.pod.closed.visible = !K.pod.open.visible;
      // pallets: where each of the two is right now
      const moved = mv ? st.k : st.state === 'V_OUT' ? POD.pallets : 0, lifted = mv && f >= 0.27, placed = mv && f >= 0.72;
      const src = POD.pallets - moved - (lifted ? 1 : 0), dst = moved + (placed ? 1 : 0);
      const srcP = build ? T.pals : K.pod.pals, dstP = build ? K.pod.pals : T.pals;
      srcP.forEach((p, j) => { p.visible = j >= POD.pallets - src; }); dstP.forEach((p, j) => { p.visible = j < dst; });
      K.fk.pal.visible = lifted && !placed;
      // forklift cycle: fetch from the source, turn, place in the destination, return to its mark
      const F = K.fk.g, d = K.d, park = va.set(c.x + d[0] * K.D * 0.5 + K.lat[0] * 3.2, K.yA, c.z + d[1] * K.D * 0.5 + K.lat[1] * 3.2).clone(), yawD = Math.atan2(d[0], d[1]);
      let pos = park, yaw = yawD, h = 0.25;
      if (mv) {
        const k = Math.min(st.k, POD.pallets - 1);
        const ts = T.g.localToWorld(vb.set(0, 0, [0.72, -0.72][k])).clone(), ps = pg.localToWorld(vb.set(0, 0, [-0.43, 0.43][k])).clone();
        const A = build ? { p: ts, s: 1, h: 0.99 } : { p: ps, s: -1, h: 0.61 }, B = build ? { p: ps, s: -1, h: 0.61 } : { p: ts, s: 1, h: 0.99 };
        const at = (o, extra) => V3(o.p.x - d[0] * o.s * (REACH + extra), K.yA, o.p.z - d[1] * o.s * (REACH + extra)), yw = o => o.s > 0 ? yawD : yawD + Math.PI;
        const seg = (a, b) => smooth((f - a) / (b - a)), mix = (p, q, t) => p.clone().lerp(q, t);
        if (f < 0.16) { const t = seg(0, 0.16); pos = mix(park, at(A, 1.7), t); yaw = lerp(yawD, yw(A), t); h = lerp(0.25, A.h, t); }
        else if (f < 0.27) { pos = mix(at(A, 1.7), at(A, 0), seg(0.16, 0.27)); yaw = yw(A); h = A.h; }
        else if (f < 0.38) { const t = seg(0.27, 0.38); pos = mix(at(A, 0), at(A, 1.7), t); yaw = yw(A); h = lerp(A.h + 0.1, 0.3, t); }
        else if (f < 0.60) { const t = seg(0.38, 0.60); pos = mix(at(A, 1.7), at(B, 1.7), t); yaw = lerp(yw(A), yw(A) + (yw(B) - yw(A)), t); h = lerp(0.3, B.h + 0.1, t); }
        else if (f < 0.72) { pos = mix(at(B, 1.7), at(B, 0), seg(0.60, 0.72)); yaw = yw(B); h = B.h + 0.1 - 0.1 * seg(0.68, 0.72); }
        else if (f < 0.84) { const t = seg(0.72, 0.84); pos = mix(at(B, 0), at(B, 1.7), t); yaw = yw(B); h = lerp(B.h, 0.25, t); }
        else { const t = seg(0.84, 1); pos = mix(at(B, 1.7), park, t); yaw = lerp(yw(B), yawD + (st.k < POD.pallets - 1 ? 0 : 0), t); h = 0.25; }
      }
      F.position.copy(pos); F.rotation.y = yaw; K.fk.carriage.position.y = h; K.fk.beacon.visible = mv && (this.t * 2.4) % 1 < 0.5;
    }
  }

  /* ----- lifecycle ----- */
  enter(siteId) {
    if (this.root) { this.scene.remove(this.root); disposeTree(this.root); }
    this.labels.clear();
    const S = this.site = this.sim.sites[siteId];
    this.root = new THREE.Group(); this.scene.add(this.root);
    this._h = []; this.assets = []; this.spots = []; this.socks = []; this.spinners = []; this.wakes = []; this.bobbers = []; this.pads = []; this.litMats = []; this.bowsers = []; this.movers = []; this.docks = [];
    this.ocean = null; this.flare = null; this.flareLight = null; this.areas = []; this.home = null; this.homeY = null; this.ship = null;
    const k = S.def.layout;
    if (k === 'ship') buildShipSite(this, S); else if (k === 'platform') buildPlatformSite(this, S); else buildLandSite(this, S);
    for (const b of S.bowsers) { const g = makeBowser(); this.root.add(g); this.bowsers.push({ b, g }); }
    // halos: one point cloud for every lamp on the site
    const n = this._h.length / 6, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), blink = new Float32Array(n);
    for (let i = 0; i < n; i++) { const o = i * 6, c = COL(this._h[o + 3]); pos.set([this._h[o], this._h[o + 1], this._h[o + 2]], i * 3); col.set([c.r, c.g, c.b], i * 3); size[i] = this._h[o + 4]; blink[i] = this._h[o + 5]; }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.BufferAttribute(col, 3)); hg.setAttribute('size', new THREE.BufferAttribute(size, 1)); hg.setAttribute('blink', new THREE.BufferAttribute(blink, 1));
    this.haloUni = { map: { value: AC.glowTex }, scale: { value: 800 }, time: { value: 0 }, dark: { value: 0 } };
    this.halos = new THREE.Points(hg, new THREE.ShaderMaterial({ uniforms: this.haloUni, vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); this.halos.frustumCulled = false; this.root.add(this.halos);
    for (const a of this.sim.aircraft) this.labels.get('a' + a.cs, 'actag', a.cs);
    for (const s of this.pool) { s.cs = null; s.m.root.visible = false; }
    this.wetK = -1;
    const h = this.home || this.areas[0].slice(1), ty = this.homeY != null ? this.homeY : S.padElev;
    this.rig.groundY = 0; this.rig.follow = null;
    this.rig.goto(V3(h[0], ty, h[1]), h[2] * 2.6, h[3] - 35, 62, true); this.rig.goto(V3(h[0], ty, h[1]), h[2], h[3], h[4]);
  }
  goArea(i) { const a = this.areas[i]; if (!a) return; this.app.tInput = this.app.tReal; this.app.following = false; this.rig.follow = null; this.rig.goto(V3(a[1], this.homeY != null && i > 0 ? this.homeY : this.site.padElev, a[2]), a[3], a[4], a[5]); }

  /* local scene position of an aircraft, or null when it is too far to draw */
  acLocal(a, out) {
    const S = this.site, l = this.sim.llToLocal(S, a.lat, a.lon), d = Math.hypot(l[0], l[1]);
    if (d > 4200) return null;
    const k = 1 - smooth((d - 900) / 900);
    return out.set(l[0], a.alt + S.padElev * k, l[1]);
  }

  resize(W, H) { this.W = W; this.H = H; this.cam.aspect = W / H; this.cam.viewH = H; this.cam.updateProjectionMatrix(); }
  update(dt, tReal) {
    const sim = this.sim, S = this.site, app = this.app, atm = this.atm; this.t += dt;
    atm.set(app.lightHour(), app.wx); const dark = atm.darkness;
    if (app.tReal - app.tInput > 9 && !app.following && !app.calm) this.rig.gaz += dt * 1.1;                       // left alone, the camera drifts slowly round the site
    this.rig.update(dt); atm.follow(this.rig.t, clamp(this.rig.dist * 0.95, 55, 210));
    const nr = clamp(this.rig.dist * 0.03, 0.4, 14); if (Math.abs(nr - this.cam.near) > nr * 0.15) { this.cam.near = nr; this.cam.updateProjectionMatrix(); }   // keep depth precision as the camera pulls back
    this.lampMat.emissiveIntensity = dark * 2.4; for (const m of this.litMats) m.emissiveIntensity = dark * 1.15; for (const s of this.spots) s.intensity = dark * 1.25;
    this.haloUni.scale.value = this.H / (2 * Math.tan(this.cam.fov * DEG / 2)); this.haloUni.time.value = this.t; this.haloUni.dark.value = dark;
    const wet = app.wx === 'RAIN' ? 1 : app.wx === 'FOG' ? 0.35 : 0;
    if (wet !== this.wetK) { this.wetK = wet; this.scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) if (m.userData && m.userData.wet) { let d = DRY.get(m); if (!d) { d = { r: m.roughness, c: m.color.clone() }; DRY.set(m, d); } m.roughness = lerp(d.r, 0.3, wet); m.color.copy(d.c).multiplyScalar(lerp(1, 0.6, wet)); } }); }
    this.rain.update(this.t, this.rig.t, app.wx === 'RAIN');
    const windDir = S.wind.dir, windKt = app.wx === 'RAIN' ? 24 : app.wx === 'CLEAR' ? 9 : 5;
    if (this.ocean) {
      this.ocean.update(this.t, atm, this.chop * (app.wx === 'RAIN' ? 1.7 : app.wx === 'FOG' ? 0.5 : 1));
      if (S.moving) { this.ocean.uni.drift.value.y -= S.speedMs * dt; for (const w of this.wakes) { w.uniforms.off.value += S.speedMs * dt / 60; w.uniforms.lum.value = 0.2 + 0.8 * clamp01(atm.sun.intensity + atm.hemi.intensity); } }
    }
    for (const s of this.socks) { s.rotation.y = -(windDir - S.rot + 90) * DEG + Math.sin(this.t * 2.1) * 0.12; s.rotation.z = -clamp(1 - windKt / 18, 0, 0.9) * 1.1 + Math.sin(this.t * 5) * 0.03; }
    for (const s of this.spinners) s.rotation.y = this.t * 1.6;
    for (const b of this.bobbers) { b.position.y = Math.sin(this.t * 0.7) * 0.35; b.rotation.z = Math.sin(this.t * 0.5) * 0.02; }
    if (this.flare) { const f = 0.8 + 0.2 * Math.sin(this.t * 17) * Math.sin(this.t * 7.3); this.flare.scale.set(8 * f, 13 * f, 1); this.flare.material.opacity = 0.85; this.flareLight.intensity = dark * 1.6 * f; }

    // pads, doors, shuttles, hoses
    for (const P of this.pads) {
      const pad = S.pads[P.i], a = pad.cs ? sim.byCs[pad.cs] : null, f = pad.dur > 0 ? clamp01(pad.t / pad.dur) : 0;
      const blinkOn = (this.t * 2) % 1 < 0.5;
      P.beaconMat.color.copy(COL(pad.state === 'FREE' ? 0x38FF9A : pad.state === 'RESERVED' || pad.step === 'DEPARTING' || pad.step === 'RELEASE' ? (blinkOn ? 0xFFB020 : 0x3A2A08) : 0xFF4A3A));
      P.podOnAc = true; let agvU = -3.2, lift = 0, agvPod = null, open = 0;
      if (P.agv && a && a.phase === 'GROUND') {
        const L = P.path.L, out = t => lerp(-3.2, L, smooth(t)), mv = (t0, t1) => clamp01((f - t0) / (t1 - t0));
        if (pad.step === 'POD_OUT' && a.pod && pad.dur > 60) {
          if (f < 0.22) agvU = out(mv(0, 0.22)); else if (f < 0.42) { agvU = L; lift = Math.sin(mv(0.22, 0.42) * Math.PI); } else if (f < 0.66) agvU = out(1 - mv(0.42, 0.66));
          if (f >= 0.32) { P.podOnAc = false; if (f < 0.66) agvPod = a.pod.type; }
          open = f < 0.70 ? 1 : 0;
        } else if (pad.step === 'POD_IN' && a.pod && pad.dur > 60) {
          if (f < 0.10) agvU = -3.2; else if (f < 0.32) agvU = out(mv(0.10, 0.32)); else if (f < 0.52) { agvU = L; lift = Math.sin(mv(0.32, 0.52) * Math.PI); } else if (f < 0.74) agvU = out(1 - mv(0.52, 0.74));
          if (f < 0.44) { P.podOnAc = false; if (f >= 0.10) agvPod = a.pod.type; }
          open = f > 0.06 && f < 0.78 ? 1 : 0;
        } else if (pad.step === 'POD_OUT' || pad.step === 'POD_IN') P.podOnAc = !a.pod || pad.step !== 'POD_OUT';     // an empty pod stays fitted
      }
      if (P.agv) {
        const A = P.agv, q = P.path; A.g.position.set(q.x + q.ux * agvU, S.padElev, q.z + q.uz * agvU); A.g.visible = agvU > -3.1;
        A.table.position.y = 0.3 + lift * 0.24; A.pod.visible = !!agvPod;
        if (agvPod) { const T = POD_TYPES[agvPod]; A.podMat.color.copy(COL(T.color)); A.stripeMat.color.copy(COL(T.stripe)); }
        A.beacon.visible = blinkOn;
        P.doorK = lerp(P.doorK || 0, open, 1 - Math.exp(-dt * 3)); setDoor(P.door, P.doorK);
      }
      if (P.hose) P.hose.visible = pad.fuel === 'FUELLING';
      P.mx.visible = pad.step === 'MAINT';
    }
    for (const o of this.bowsers) { o.g.position.set(o.b.x, 0, o.b.z); o.g.rotation.y = o.b.dir > 0 ? 0 : Math.PI; }
    this._dock();
    for (const m of this.movers) { m.u = (m.u + m.v * dt) % m.len; const k = m.u / m.len; m.obj.position.set(lerp(m.a[0], m.b[0], k), m.y, lerp(m.a[1], m.b[1], k)); }      // road traffic outside the fence

    // aircraft: assign pooled models to whatever is on or near this site
    const near = []; const v = this.tmp;
    for (const a of sim.aircraft) {
      if (a.phase === 'REST' && a.restAt === 'HANGAR') continue;              // inside the hangar
      const here = (a.phase === 'GROUND' || a.phase === 'STANDBY' || a.phase === 'REST') ? a.site === S.id : true;
      if (!here) continue; const p = this.acLocal(a, v); if (!p) continue;
      near.push({ a, x: p.x, y: p.y, z: p.z, d: Math.hypot(p.x, p.z) });
    }
    near.sort((p, q) => p.d - q.d); near.length = Math.min(near.length, this.pool.length);
    const want = new Set(near.map(n => n.a.cs));
    for (const s of this.pool) if (s.cs && !want.has(s.cs)) { s.cs = null; s.m.root.visible = false; }
    this.acShown = near;
    for (const nItem of near) {
      const a = nItem.a; let s = this.pool.find(s => s.cs === a.cs);
      if (!s) { s = this.pool.find(s => !s.cs); s.cs = a.cs; s.m.setCallsign(a.cs); s.m.root.visible = true; }
      nItem.m = s.m; const R = s.m.root, air = AIRBORNE[a.phase];
      R.position.set(nItem.x, nItem.y, nItem.z);
      const wing = 1 - a.tilt / 90, pitch = a.gs > 15 ? clamp(Math.atan2(a.vs, a.gs), -0.16, 0.16) : 0;
      R.rotation.set(-pitch * wing - (a.phase === 'TRANS_IN' ? 0.07 * (1 - wing) * wing * 4 : 0), Math.PI - (a.hdg - S.rot) * DEG, (a.bank || 0) * 0.4 * wing);
      let podType = a.pod ? a.pod.type : 'EMPTY', rpm = air ? 1 : a.rpm;
      if (a.phase === 'GROUND') { const P = this.pads[a.pad]; if (P && !P.podOnAc) podType = null; }
      s.m.setPod(podType);
      s.m.update({ tilt: a.tilt, rpm, dt, t: this.t, dark, alt: a.alt, lit: a.phase !== 'STANDBY' && a.phase !== 'REST' });
    }
    // selection ring
    const sp = app.selPos();
    if (sp) { const pul = (tReal * 0.9) % 1, sel = app.sel, r = sel.type === 'aircraft' ? 5.2 : sel.type === 'pad' ? 8.6 : 6; this.ring.visible = this.ring2.visible = true;
      const overDeck = Math.hypot(sp.x - S.pads[0].x, sp.z - S.pads[0].z) < 14 || !this.ocean || S.def.layout === 'quay';
      const gy = sel.type === 'asset' ? sp.y - 3 : (overDeck ? S.padElev : 0.4) + 0.07;                       // the ring marks the spot on the surface below
      this.ring.position.set(sp.x, gy, sp.z); this.ring2.position.set(sp.x, gy, sp.z); this.ring.scale.setScalar(r); this.ring2.scale.setScalar(r * (1 + pul * 0.6)); this.ring2.material.opacity = 0.7 * (1 - pul); }
    else this.ring.visible = this.ring2.visible = false;
    this._labels();
  }
  _labels() {
    const L = this.labels, cam = this.cam, W = this.W, H = this.H, S = this.site, sim = this.sim, sel = this.app.sel, d = this.rig.dist, v = this.tmp;
    const shown = new Set();
    for (const n of this.acShown) {
      const a = n.a, key = 'a' + a.cs; shown.add(key);
      const isSel = sel && sel.type === 'aircraft' && sel.id === a.cs, l = L.get(key);
      const txt = '<b>' + a.cs + '</b>' + (a.phase === 'STANDBY' ? ' STANDBY' : a.phase === 'REST' ? ' STOOD DOWN' : a.phase === 'GROUND' ? '' : ' ' + PHASE_LABEL[a.phase] + ' · ' + fmtInt(a.alt / FT) + ' ft');
      L.text(key, txt); l.d.classList.toggle('sel', !!isSel);
      L.place(key, v.set(n.x, n.y + 3.6, n.z), cam, W, H, d < 420 || isSel || AIRBORNE[a.phase]);
    }
    for (const a of sim.aircraft) if (!shown.has('a' + a.cs)) { const l = L.map.get('a' + a.cs); if (l && l.on) { l.on = false; l.d.style.display = 'none'; } }
    for (const P of this.pads) {
      const pad = S.pads[P.i], key = 'pad' + P.i;
      let t = '<b>' + pad.id + '</b> ';
      if (pad.state === 'FREE') t += '<s class="ok">FREE</s>'; else if (pad.state === 'RESERVED') t += '<s class="warn">INBOUND ' + pad.cs + '</s>';
      else if (pad.step === 'DEPARTING') t += '<s class="warn">DEPARTING</s>'; else t += '<s>' + (STEP_LABEL[pad.step] || '') + (pad.dur > 0 && pad.step !== 'RELEASE' && pad.step !== 'FUELWAIT' ? ' ' + fmtMS(pad.dur - pad.t) : '') + '</s>';
      L.text(key, t); L.place(key, P.lblPos, cam, W, H, d < 260);
    }
    for (const K of this.docks) {
      const st = S.dock.st[K.i], key = 'dk' + K.i, n = Math.min(POD.pallets, st.k + 1), ty = st.job ? POD_TYPES[st.type].label : '';
      L.text(key, '<b>L' + (K.i + 1) + '</b> ' + (st.state === 'IDLE' ? '<s class="ok">BAY FREE</s>' : st.state === 'V_IN' ? '<s class="warn">' + (st.job === 'BUILD' ? 'TRUCK IN · ' + POD.pallets + ' PALLETS ' + ty : 'TRUCK IN · EMPTY') + '</s>'
        : st.state === 'MOVE' ? '<s>' + (st.job === 'BUILD' ? 'LOADING POD · PALLET ' : 'UNLOADING POD · PALLET ') + n + ' OF ' + POD.pallets + '</s>' : '<s>' + (st.job === 'BUILD' ? 'POD CLOSED · TO STAGING' : 'TRUCK OUT · ' + POD.pallets + ' PALLETS') + '</s>') +
        '<br><s>IN  ' + st.fin.pods + ' pods · ' + (st.fin.kg / 1000).toFixed(1) + ' t</s><br><s>OUT ' + st.fout.pods + ' pods · ' + (st.fout.kg / 1000).toFixed(1) + ' t</s><br><s>DRY ' + (st.fin.pods + st.fout.pods - wetPods(st)) + ' · WET ' + wetPods(st) + '</s>');
      L.place(key, K.lblPos, cam, W, H, d < 260);
    }
    for (const as of this.assets) L.place('as' + as.key, as.pos, cam, W, H, d > 70 || (sel && sel.type === 'asset' && sel.id === as.key));
  }
  pick(x, y) {
    const cam = this.cam, W = this.W, H = this.H, v = this.tmp; let best = null, bd = 30;
    const test = (p, type, id, r) => { v.copy(p).project(cam); if (v.z > 1) return; const d = Math.hypot((v.x * 0.5 + 0.5) * W - x, (-v.y * 0.5 + 0.5) * H - y) - (r || 0); if (d < bd) { bd = d; best = { type, id }; } };
    const pxm = this.H / (2 * Math.tan(this.cam.fov * DEG / 2)) / Math.max(10, this.rig.dist);               // pixels per metre near the target
    for (const n of this.acShown) test(V3(n.x, n.y + 1.6, n.z), 'aircraft', n.a.cs, Math.min(60, 3.2 * pxm));
    if (!best) for (const P of this.pads) test(P.pos, 'pad', this.site.id + ':' + P.i, Math.min(70, 5 * pxm));
    if (!best) for (const a of this.assets) test(a.pos, 'asset', a.key, 26);
    return best;
  }
  selPos() {
    const s = this.app.sel; if (!s) return null;
    if (s.type === 'aircraft') { const n = this.acShown && this.acShown.find(n => n.a.cs === s.id); return n ? this.tmp2.set(n.x, n.y + 1.4, n.z) : null; }
    if (s.type === 'pad') { const [sid, i] = s.id.split(':'); return sid === this.site.id && this.pads[+i] ? this.pads[+i].pos : null; }
    if (s.type === 'asset') { const a = this.assets.find(a => a.key === s.id); return a ? a.pos : null; }
    return null;
  }
  render(r) { r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.render(this.scene, this.cam); }
}
SiteView.prototype.tmp2 = new THREE.Vector3();
