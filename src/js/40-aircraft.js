/* ============================================================================
   L560 AIRFRAME — built from the plan-view schematic in the thesis (Fig. 01):
   tandem tilt-wing, four rotors on the front wing, two on the rear wing, two
   fixed rotors on the centreline, 7 m x 5 m footprint, pod carried under the spine.
   Model axes: +z forward, +y up, +x port.
   ========================================================================== */

const AC = { built: false };
function buildAircraftAssets() {
  if (AC.built) return; AC.built = true;
  // spine fuselage
  AC.spine = loft([
    { z: 2.02, w: 0.20, h: 0.19, y: 1.74 }, { z: 1.70, w: 0.31, h: 0.27, y: 1.77 }, { z: 1.20, w: 0.38, h: 0.31, y: 1.81 },
    { z: 0.50, w: 0.40, h: 0.33, y: 1.83, e: 3 }, { z: -0.70, w: 0.40, h: 0.33, y: 1.83, e: 3 }, { z: -1.40, w: 0.30, h: 0.27, y: 1.89 },
    { z: -2.05, w: 0.17, h: 0.19, y: 1.99 }, { z: -2.45, w: 0.06, h: 0.09, y: 2.06 }
  ], 24);
  AC.radome = loft([{ z: 2.02, w: 0.20, h: 0.19, y: 1.74 }, { z: 2.16, w: 0.13, h: 0.125, y: 1.735 }, { z: 2.25, w: 0.05, h: 0.05, y: 1.73 }], 24, false, true);
  // pod: EUR-pallet class container with faired ends, hangs between the legs
  // 2.10 m long x 1.75 m wide x 1.75 m high, two pallets in tandem [LogiXair]; underside 0.60 m above ground so the shuttle runs beneath it
  const pw = POD.widthM / 2, ph = POD.heightM / 2, pl = POD.lenM / 2, pc = PODY + ph;
  AC.pod = loft([
    { z: pl, w: pw * 0.66, h: ph * 0.66, y: pc, e: 3 }, { z: pl - 0.07, w: pw * 0.95, h: ph * 0.95, y: pc, e: 4 }, { z: pl - 0.18, w: pw, h: ph, y: pc, e: 7 },
    { z: -pl + 0.18, w: pw, h: ph, y: pc, e: 7 }, { z: -pl + 0.07, w: pw * 0.95, h: ph * 0.95, y: pc, e: 4 }, { z: -pl, w: pw * 0.66, h: ph * 0.66, y: pc, e: 3 }
  ], 28);
  AC.podStripe = new THREE.BoxGeometry(POD.widthM + 0.015, 0.2, 1.5);
  // wing section: 12% thick, pivot at 35% chord
  const foil = c => {
    const s = new THREE.Shape(), N = 14, pts = [];
    for (let i = 0; i <= N; i++) { const x = 1 - Math.cos(i / N * Math.PI / 2) ** 1 * 1; pts.push(x); }
    const th = x => 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const up = [], lo = [];
    for (let i = 0; i <= N; i++) { const x = (1 - Math.cos(i / N * Math.PI)) / 2, t = th(x), cam = 0.03 * (1 - (2 * x - 1) ** 2); up.push([(0.35 - x) * c, (cam + t) * c]); lo.push([(0.35 - x) * c, (cam - t) * c]); }
    s.moveTo(up[0][0], up[0][1]); for (let i = 1; i <= N; i++) s.lineTo(up[i][0], up[i][1]); for (let i = N - 1; i >= 0; i--) s.lineTo(lo[i][0], lo[i][1]);
    return s;
  };
  const wing = (span, chord) => { const g = new THREE.ExtrudeGeometry(foil(chord), { depth: span, bevelEnabled: false, steps: 1 }); g.rotateY(-Math.PI / 2); g.translate(span / 2, 0, 0); return g; };
  AC.wingF = wing(6.86, 0.74); AC.wingR = wing(5.96, 0.68);
  AC.tipF = wing(0.34, 0.74); AC.tipR = wing(0.30, 0.68);
  AC.nacelle = loft([{ z: 0.56, w: 0.07, h: 0.07, y: 0 }, { z: 0.46, w: 0.115, h: 0.115, y: 0 }, { z: 0.0, w: 0.125, h: 0.125, y: 0 }, { z: -0.36, w: 0.085, h: 0.085, y: 0 }, { z: -0.52, w: 0.02, h: 0.02, y: 0 }], 14);
  AC.spinner = new THREE.ConeGeometry(0.075, 0.2, 14); AC.spinner.rotateX(Math.PI / 2);
  const blade = (R) => { const g = new THREE.BoxGeometry(0.105, R - 0.05, 0.022, 1, 4, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + (R - 0.05) / 2, k = y / R, tw = (0.55 - k * 0.42), x = p.getX(i) * (1.05 - k * 0.55), z = p.getZ(i);
      p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y + 0.05, x * Math.sin(tw) + z * Math.cos(tw)); }
    g.computeVertexNormals(); return g; };
  AC.bladeF = blade(0.66); AC.bladeR = blade(0.80); AC.bladeL = blade(0.42);
  AC.discF = new THREE.CircleGeometry(0.66, 40); AC.discR = new THREE.CircleGeometry(0.80, 40); AC.discL = new THREE.CircleGeometry(0.42, 32);
  AC.wheel = new THREE.CylinderGeometry(0.15, 0.15, 0.11, 18); AC.wheel.rotateZ(Math.PI / 2);
  AC.light = new THREE.SphereGeometry(0.04, 10, 8);
  AC.mBody = stdMat({ color: 0xE9ECEE, roughness: 0.36, metalness: 0.08 });
  AC.mBlue = stdMat({ color: 0x0A4E86, roughness: 0.38, metalness: 0.12 });
  AC.mDark = stdMat({ color: 0x17191D, roughness: 0.5, metalness: 0.35 });
  AC.mBlade = stdMat({ color: 0x1B1D21, roughness: 0.45, metalness: 0.2 });
  AC.mLeg = stdMat({ color: 0x9AA0A6, roughness: 0.4, metalness: 0.75 });
  AC.mDisc = new THREE.MeshBasicMaterial({ map: texOf(TEX.prop, { clamp: true }), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 });
  AC.mRed = basicMat({ color: 0xff2b2b }); AC.mGreen = basicMat({ color: 0x25ff7a }); AC.mWhite = basicMat({ color: 0xffffff });
  AC.glowTex = texOf(TEX.glow, { clamp: true });
}

class L560Model {
  constructor() {
    buildAircraftAssets();
    const R = this.root = new THREE.Group(); R.rotation.order = 'YXZ';
    const U = new THREE.Group(); U.position.y = AIRFRAME_DY; R.add(U);                 // everything above the gear sits on longer legs to clear the pod
    const add = (g, m, p, x, y, z, o) => mesh(g, m, p || U, x, y, z, o);
    add(AC.spine, AC.mBody); add(AC.radome, AC.mDark);
    // fin carrying the rear wing, ventral strake, exhaust and sensor bumps
    add(box(0.075, 0.36, 0.62), AC.mBlue, U, 0, 2.15, -1.72, { rx: -0.16 });
    add(box(0.05, 0.16, 0.5), AC.mBody, U, 0, 1.70, -1.75, { rx: 0.2 });
    const sat = add(sph(0.16, 14, 10), AC.mBody, U, 0, 2.13, 0.15); sat.scale.set(1, 0.42, 1.5);
    add(box(0.016, 0.14, 0.1), AC.mDark, U, 0, 2.22, -0.45); add(box(0.016, 0.12, 0.09), AC.mDark, U, 0, 1.46, 1.3);
    add(sph(0.075, 12, 10), AC.mDark, U, 0, 1.47, 1.72);
    add(box(0.2, 0.02, 0.3), AC.mDark, U, 0, 2.165, -0.85); add(cyl(0.035, 0.045, 0.14, 10), AC.mDark, U, -0.37, 1.9, -1.0, { rz: Math.PI / 2 });
    // legs: four struts splayed to feet at the corners, sides and ends left open for the pod
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const top = V3(sx * 0.32, (sz > 0 ? 1.62 : 1.68) + AIRFRAME_DY, sz * 1.24), foot = V3(sx * 1.06, 0.2, sz * 1.46);
      tube(R, AC.mLeg, top, foot, 0.045, 10); tube(R, AC.mLeg, V3(sx * 0.3, 1.6 + AIRFRAME_DY, sz * 1.02), top.clone().lerp(foot, 0.55), 0.028, 8);
      add(AC.wheel, MAT.rubber, R, sx * 1.06, 0.15, sz * 1.46); add(box(0.07, 0.2, 0.12), AC.mLeg, R, sx * 1.06, 0.25, sz * 1.46);
    }
    for (const sx of [-1, 1]) tube(R, AC.mLeg, V3(sx * 1.06, 0.27, -1.58), V3(sx * 1.06, 0.27, 1.58), 0.034, 8);   // skid rail tying the feet on each side
    // tilting wings
    this.props = [];
    const mkWing = (geo, tipGeo, span, chord, y, z, xs, bladeG, discG, pr) => {
      const g = new THREE.Group(); g.position.set(0, y, z); U.add(g);
      add(geo, AC.mBody, g, 0, 0, 0);
      for (const s of [-1, 1]) add(tipGeo, AC.mBlue, g, s * (span / 2 + 0.15), 0, 0);
      for (const x of xs) {
        add(AC.nacelle, AC.mBlue, g, x, 0, 0.42);
        const p = new THREE.Group(); p.position.set(x, 0, 1.0); g.add(p);
        add(AC.spinner, AC.mDark, p, 0, 0, 0.06);
        const bl = new THREE.Group(); p.add(bl);
        for (let k = 0; k < 3; k++) { const b = add(bladeG, AC.mBlade, bl); b.rotation.z = k * Math.PI * 2 / 3; }
        const d = new THREE.Mesh(discG, AC.mDisc); d.position.z = 0.02; d.visible = false; p.add(d);
        this.props.push({ p, bl, d, dir: x > 0 ? 1 : -1, ph: Math.random() * 6, lift: false });
      }
      return g;
    };
    this.wingF = mkWing(AC.wingF, AC.tipF, 6.86, 0.74, 1.60, 1.12, [-2.86, -1.40, 1.40, 2.86], AC.bladeF, AC.discF);
    this.wingR = mkWing(AC.wingR, AC.tipR, 5.96, 0.68, 2.33, -1.72, [-2.48, 2.48], AC.bladeR, AC.discR);
    // two fixed rotors on the centreline, stowed fore-and-aft in cruise
    for (const [z, y] of [[1.42, 2.18], [-1.0, 2.24]]) {
      add(cyl(0.035, 0.05, 0.16, 10), AC.mDark, U, 0, y - 0.07, z);
      const p = new THREE.Group(); p.position.set(0, y + 0.02, z); p.rotation.x = -Math.PI / 2; U.add(p);
      const bl = new THREE.Group(); p.add(bl);
      for (let k = 0; k < 2; k++) { const b = add(AC.bladeL, AC.mBlade, bl); b.rotation.z = k * Math.PI; }
      const d = new THREE.Mesh(AC.discL, AC.mDisc); d.position.z = 0.02; d.visible = false; p.add(d);
      this.props.push({ p, bl, d, dir: z > 0 ? 1 : -1, ph: 0, lift: true });
    }
    // pod
    this.podMat = stdMat({ color: 0xC9CDD2, roughness: 0.55, metalness: 0.1 }); this.stripeMat = stdMat({ color: 0xE8523F, roughness: 0.6 });
    this.pod = new THREE.Group(); R.add(this.pod);
    add(AC.pod, this.podMat, this.pod); add(AC.podStripe, this.stripeMat, this.pod, 0, PODY + POD.heightM * 0.8, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.09, 0.07, 0.12), AC.mDark, this.pod, sx * 0.34, PODY + POD.heightM + 0.03, sz * 0.5);
    this.podLed = add(sph(0.03, 8, 6), AC.mGreen, this.pod, POD.widthM / 2 + 0.005, PODY + POD.heightM * 0.7, -0.6);
    this.podType = null;
    // livery decals
    this.liveryC = cvs(512, 96); this.liveryT = texOf(this.liveryC, { clamp: true });
    const lm = new THREE.MeshStandardMaterial({ map: this.liveryT, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), lm); d.position.set(s * 0.404, 1.85, 0.05); d.rotation.y = s * Math.PI / 2; U.add(d); }
    this.cs = null;
    // lights
    this.navL = add(AC.light, AC.mRed, this.wingF, 3.76, 0, 0.1, { cast: false }); this.navR = add(AC.light, AC.mGreen, this.wingF, -3.76, 0, 0.1, { cast: false });
    this.tail = add(AC.light, AC.mWhite, U, 0, 2.08, -2.46, { cast: false });
    this.strobe = add(AC.light, AC.mWhite, U, 0, 2.36, -1.6, { cast: false });
    this.land = add(AC.light, AC.mWhite, U, 0, 1.5, 1.55, { cast: false });
    this.halos = [];
    const halo = (parent, x, y, z, col, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: AC.glowTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); sp.position.set(x, y, z); sp.scale.setScalar(s); parent.add(sp); this.halos.push(sp); return sp; };
    halo(this.wingF, 3.76, 0, 0.1, 0xff3030, 1.6); halo(this.wingF, -3.76, 0, 0.1, 0x30ff80, 1.6); halo(U, 0, 2.08, -2.46, 0xffffff, 1.2);
    this.strobeHalo = halo(U, 0, 2.36, -1.6, 0xffffff, 3.2); this.landHalo = halo(U, 0, 1.5, 1.6, 0xfff2d0, 3.6);
    this.spin = 0;
  }
  setCallsign(cs) {
    if (cs === this.cs) return; this.cs = cs;
    const g = this.liveryC.getContext('2d'); g.clearRect(0, 0, 512, 96);
    g.fillStyle = '#0A4E86'; g.font = '800 54px Archivo, Helvetica, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('LOGIXAIR', 8, 50);
    g.fillStyle = '#30343A'; g.font = '600 30px "JetBrains Mono", ui-monospace, Menlo, monospace'; g.textAlign = 'right'; g.fillText(cs, 504, 54); g.textAlign = 'left';
    this.liveryT.needsUpdate = true;
  }
  setPod(type) {
    if (type === this.podType) return; this.podType = type;
    this.pod.visible = !!type; if (!type) return;
    const T = POD_TYPES[type]; this.podMat.color.copy(COL(T.color)); this.stripeMat.color.copy(COL(T.stripe));
  }
  /* tilt: degrees (0 cruise, 90 hover); rpm 0..1; dt real seconds; t real time; dark 0..1 */
  update(o) {
    const tilt = o.tilt * DEG;
    this.wingF.rotation.x = -tilt; this.wingR.rotation.x = -tilt;
    this.spin += o.dt * 38 * o.rpm;
    const liftK = o.rpm * smooth((o.tilt - 12) / 30);
    for (const p of this.props) {
      const r = p.lift ? liftK : o.rpm;
      if (p.lift && r < 0.02) { p.bl.rotation.z = Math.PI / 2; p.bl.visible = true; p.d.visible = false; continue; }
      p.bl.rotation.z = p.ph + this.spin * p.dir * (p.lift ? 1.3 : 1);
      p.bl.visible = r < 0.55; p.d.visible = r > 0.12; if (p.d.visible) p.d.rotation.z = -this.spin * 0.13 * p.dir;
    }
    const blink = ((o.t * 1.1 + (this.cs ? this.cs.charCodeAt(this.cs.length - 1) * 0.13 : 0)) % 1) < 0.07;
    const on = o.rpm > 0.02 || o.lit;
    this.strobe.visible = on && blink; this.navL.visible = this.navR.visible = this.tail.visible = on; this.land.visible = on && o.tilt > 30 && o.alt > 0.5;
    const d = o.dark; const hs = this.halos;
    hs[0].material.opacity = hs[1].material.opacity = on ? 0.25 + 0.6 * d : 0; hs[2].material.opacity = on ? 0.2 + 0.5 * d : 0;
    this.strobeHalo.material.opacity = on && blink ? 0.5 + 0.5 * d : 0; this.landHalo.material.opacity = this.land.visible ? 0.25 + 0.7 * d : 0;
  }
}
