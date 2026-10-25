/* ============================================================================
   LAND SITES — bases, spoke distribution centres, the MRO hub and the
   quay-side bases (naval dockyard, offshore shore base). One builder, four layouts.
   ========================================================================== */

function vSign(parent, text, w, h, x, y, z, ry, o) {
  o = o || {};
  const c = textCanvas(text, { w: 1024, h: Math.round(1024 * h / w), color: o.color || '#0A4E86', bg: o.bg || null, size: Math.round(1024 * h / w * (o.k || 0.62)), weight: o.weight || 800, spacing: o.spacing || '0px' });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texOf(c, { clamp: true }), transparent: !o.bg, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: !!o.bg }));
  m.position.set(x, y, z); m.rotation.y = ry || 0; parent.add(m); return m;
}
function flatPlane(parent, mat, x0, x1, z0, z1, y, tile, vary) {
  const w = x1 - x0, d = z1 - z0, m = tile ? tiled(mat, w, d, tile) : mat;
  let geo;
  if (vary) {
    // large-scale tone variation in vertex colours, so the tiled texture never reads as a repeat
    const sx = clamp(Math.round(w / vary.cell), 2, 160), sz = clamp(Math.round(d / vary.cell), 2, 160), n = makeNoise(vary.seed || 3);
    geo = new THREE.PlaneGeometry(w, d, sx, sz); const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const X = p.getX(i) + (x0 + x1) / 2, Z = -p.getY(i) + (z0 + z1) / 2, f = n.fbm(X / vary.scale + 31, Z / vary.scale + 17, 4), g2 = n.fbm(X / (vary.scale * 0.22) + 5, Z / (vary.scale * 0.22), 2);
      const k = 1 + (f - 0.5) * 2 * vary.amp + (g2 - 0.5) * vary.amp * 0.6, warm = vary.warm ? (f - 0.5) * vary.warm : 0; col[i * 3] = k * (1 + warm); col[i * 3 + 1] = k; col[i * 3 + 2] = k * (1 - warm); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (m === mat) { /* shared material: clone before enabling vertex colours */ }
    m.vertexColors = true; m.needsUpdate = true;
  } else geo = new THREE.PlaneGeometry(w, d);
  const p = new THREE.Mesh(geo, m); p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); p.receiveShadow = true; parent.add(p); return p;
}
/* soft dark apron around a building footprint: stands in for ambient occlusion */
let _aoTex = null;
function contactShadow(parent, x, z, w, d, ry, y) {
  if (!_aoTex) { const c = cvs(128), g = c.getContext('2d'); g.filter = 'blur(9px)'; g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(22, 22, 84, 84); _aoTex = texOf(c, { clamp: true }); }
  const k = 128 / 84, m = new THREE.Mesh(new THREE.PlaneGeometry(w * k, d * k), new THREE.MeshBasicMaterial({ map: _aoTex, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = -(ry || 0); m.position.set(x, (y || 0) + 0.012, z); m.renderOrder = 1; parent.add(m); return m;
}
function lineDecal(parent, x0, z0, x1, z1, w, color, dash, y) {
  const L = Math.hypot(x1 - x0, z1 - z0), c = cvs(64, 8), g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, dash ? 38 : 64, 8);
  const t = texOf(c, { repeat: [dash ? L / dash : 1, 1] });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(L, w), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z1 - z0, x1 - x0); m.position.set((x0 + x1) / 2, y == null ? 0.02 : y, (z0 + z1) / 2); m.receiveShadow = true; m.renderOrder = 2; parent.add(m); return m;
}
function rooftopKit(g, w, d, h, rnd, solar) {
  for (let i = 0; i < Math.max(2, Math.round(w / 16)); i++) block(g, MAT.galv, -w / 2 + 4 + i * (w - 8) / Math.max(1, Math.round(w / 16) - 1 || 1), (rnd() - 0.5) * d * 0.3, 2.2, 1.1, 1.6, h + 0.35);
  if (solar) {
    const pm = stdMat({ color: 0x15233A, roughness: 0.25, metalness: 0.6 });
    for (let x = -w / 2 + 3; x < w / 2 - 3; x += 3.2) { const p = block(g, pm, x, d * 0.22, 2.8, 0.06, d * 0.36, h + 0.75); p.rotation.x = 0.16; }
  }
}

/* truck dock: one loading bay per station in the layout. Vehicle, forklift, pod and pallets are posed each frame from the sim. */
function buildDock(ctx, S) {
  const root = ctx.root, cfgs = S.L.dock.slice(0, S.dock.st.length), yA = -0.14;
  cfgs.forEach((c, i) => {
    const d = c.d, lat = [-d[1], d[0]], D = Math.hypot(c.bay[0] - c.x, c.bay[1] - c.z), ang = Math.atan2(d[0], d[1]);
    // conveyor stub out of the wall door, bay markings on the asphalt
    conveyorStub(root, c.x + c.into[0] * 0.8, c.z + c.into[1] * 0.8, 3.6, Math.abs(c.into[0]) > 0.5 ? 0 : Math.PI / 2).position.y = yA;
    const P = (a, b) => [c.x + d[0] * a + lat[0] * b, c.z + d[1] * a + lat[1] * b];
    const box4 = (a0, a1, b0, b1, col, dash) => { const q = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)]; for (let k = 0; k < 4; k++) lineDecal(root, q[k][0], q[k][1], q[(k + 1) % 4][0], q[(k + 1) % 4][1], 0.14, col, dash, yA + 0.02); };
    box4(1.4, D - 1.5, -2.3, 2.3, '#E7B416', 1.2); box4(D - 1.25, D + 1.25, -3.6, 4.6, '#F5F5F2', 0);
    const lb = P(D * 0.5, 3.1), tc = textCanvas('POD LOADING L' + (i + 1), { w: 1024, h: 128, color: '#E7B416', size: 80 });
    const dm = decal(root, tc, 7, 0.9, lb[0], yA + 0.03, lb[1], { ry: Math.abs(d[0]) > 0.5 ? Math.PI / 2 : 0 });
    for (const b of [-2.6, 2.6]) { const q = P(0.2, b); mesh(cyl(0.09, 0.09, 1.0, 8), MAT.yellow, root, q[0], 0.36, q[1]); }
    const mp = P(-0.4, 3.6); mesh(cyl(0.07, 0.09, 7, 8), MAT.galv, root, mp[0], 3.4, mp[1]); block(root, ctx.lampMat, mp[0] + d[0] * 0.3, mp[1] + d[1] * 0.3, 0.5, 0.12, 0.5, 6.9, { cast: false });
    const pod = makeOpenPod(); pod.g.rotation.y = Math.atan2(d[1], -d[0]); root.add(pod.g);          // door (-x) turned to face the vehicle
    const fk = makeForklift(); root.add(fk.g);
    const trucks = [0, 1, 2, 3, 4, 5].map(v => { const t = makeLightTruck(v); t.g.visible = false; root.add(t.g); return t; });
    const curve = pts => new THREE.CatmullRomCurve3(pts.map(p => V3(p[0], yA, p[1])), false, 'centripetal');
    const lp = P(D * 0.5, 0); ctx.labels.get('dk' + i, 'pad', 'L' + (i + 1));
    ctx.docks.push({ c, i, d, lat, D, pod, fk, trucks, pathIn: curve(c.pathIn), pathOut: curve(c.pathOut), yA, lblPos: V3(c.x + d[0] * 1.2, 2.4, c.z + d[1] * 1.2), yaw: 0, type: null });
    ctx.asset('dock' + i, 'Pod loading L' + (i + 1), 'TRUCK · PALLET · POD', V3(lp[0] + lat[0] * -5.2, 3.2, lp[1] + lat[1] * -5.2), 'A pod takes ' + POD.pallets + ' standard pallets (' + POD.palletMm[0] + ' × ' + POD.palletMm[1] + ' mm) through its side door. The forklift loads them straight off the truck; the pod closes and goes inside for staging. Delivered pods are unloaded here the same way.');
  });
  for (const c of cfgs) ctx.lamp(c.x - c.d[1] * 3.6, 6.9, c.z + c.d[0] * 3.6, c.x + c.d[0] * 6, 0, c.z + c.d[1] * 6, 40);
}

function buildLandSite(ctx, S) {
  const root = ctx.root, kind = S.def.layout, rnd = mulberry32(S.id.length * 131 + S.id.charCodeAt(0) * 7), coastal = kind === 'quay';
  const name = S.name.toUpperCase();
  // --- terrain beyond the compound
  if (!coastal) {
    flatPlane(root, MAT.ground, -3600, 3600, -3600, 3600, -0.3, 46, { cell: 45, scale: 420, amp: 0.2, warm: 0.12, seed: S.id.length + 2 });
    horizonHills(root, 5 + S.id.charCodeAt(0), 1500, 3400, 150, 0xC2A274);
  } else {
    flatPlane(root, MAT.ground, -3600, 3600, -3600, 17.2, -0.3, 46, { cell: 45, scale: 420, amp: 0.2, warm: 0.12, seed: S.id.length + 2 });
    horizonHills(root, 9 + S.id.charCodeAt(0), 1400, 3300, 220, 0xB5986C, Math.PI * 1.05, Math.PI * 1.95);
    ctx.needOcean(-2.4, 0.55);
  }
  const A = { base: [-74, 92, -50, 50], spoke: [-14, 40, -26, 26], mro: [-62, 72, -18, 42], quay: [-124, 196, -48, 18] }[kind];
  flatPlane(root, MAT.concrete, A[0], A[1], A[2], A[3], 0, 6, { cell: 4, scale: 70, amp: 0.085, warm: 0.03, seed: 8 });
  const inside = (x, z) => x > A[0] - 70 && x < A[1] + 30 && z > A[2] - 40 && z < A[3] + 40 || (coastal && z > 10) || (Math.abs(x + 124) < 14) || (!!S.def.port && x > 440 && x < 640 && Math.abs(z) < 300);
  scatterNature(root, rnd, inside, coastal ? 900 : 1300, coastal ? 40 : 60, coastal ? 160 : 420);       // desert: a few date palms, more rock

  // --- traffic on the public road (set dressing: it moves in real time, not simulation time)
  const road = (a, b, n) => { for (let i = 0; i < n; i++) { const t = makeTruck([0xE4E6E8, 0xB7463A, 0x3E6A94, 0xD9A441][Math.floor(rnd() * 4)]), fwd = i % 2 === 0, A = fwd ? a : b, B = fwd ? b : a, off = fwd ? -2.6 : 2.6;
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), nx = -dz / L * off, nz = dx / L * off; t.rotation.y = Math.atan2(dx, dz); root.add(t);
    ctx.movers.push({ obj: t, a: [A[0] + nx, A[1] + nz], b: [B[0] + nx, B[1] + nz], y: -0.14, len: L, u: rnd() * L, v: 11 + rnd() * 5 }); } };
  if (coastal) road([-124, -55], [196, -55], 2); else road([-125, -900], [-125, 900], 4);
  // --- pads, pod shuttles, doors, pad lights
  const doors = [];
  S.pads.forEach((p, i) => ctx.addPad(p, i, 'land'));

  if (kind === 'base') {
    // public road and site access
    flatPlane(root, MAT.asphalt, -131, -119, -900, 900, -0.14, 8); lineDecal(root, -125, -900, -125, 900, 0.18, '#E9E6D8', 9, -0.12);
    flatPlane(root, MAT.asphalt, -119, -74, -44, 44, -0.14, 8);
    fence(root, [[-117, -7], [-117, -64], [100, -64], [100, 64], [-117, 64], [-117, 7]], 2.4);
    const gh = shed(root, -114.6, -11, 3.6, 4, 2.8, { color: 0xE6E3DA, ao: false }); opening(gh, 'e', 0, 1.6, 1.1, 3.6, 4, MAT.glass, 1.1);
    for (const z of [-7, 7]) { mesh(cyl(0.12, 0.12, 1.1, 8), MAT.yellow, root, -117, 0.5, z); const arm = block(root, MAT.red, -117, z * 0.62, 0.1, 0.1, 5.2, 1.0); arm.rotation.x = z < 0 ? -1.15 : 1.15; arm.position.y = 2.6; }
    // pod spine: the automated swapping dock, one door per pad
    const sp = shed(root, 0, 0, 68, 10, 5.6, { color: 0xDADDDF, band: 0x0A4E86 }); rooftopKit(sp, 68, 10, 5.6, rnd, true);
    vSign(sp, 'LOGIXAIR', 12, 1.6, -22, 4.2, -5.08, Math.PI); vSign(sp, 'LOGIXAIR', 12, 1.6, 22, 4.2, 5.08, 0);
    vSign(sp, name, 9, 0.7, 22, 4.25, -5.08, Math.PI, { color: '#30343A', k: 0.7, weight: 600 }); vSign(sp, name, 9, 0.7, -22, 4.25, 5.08, 0, { color: '#30343A', k: 0.7, weight: 600 });
    ctx.asset('spine', 'Pod spine', 'AUTOMATED SWAPPING DOCK', V3(0, 6.5, 0), 'Pods are staged, charged and sealed here. A shuttle runs straight out of each door to its pad, so no pod path crosses another.');
    // cross-dock warehouse with truck docks on the west face
    const wh = shed(root, -59, 0, 38, 30, 9.5, { color: 0xCDD1D3, roof: 'gable', rise: 3.2 });
    for (let i = 0; i < 5; i++) { const live = i === 0 || i === 4; opening(wh, 'w', -11 + i * 5.5, 3.2, live ? 3.0 : 3.4, 38, 30, MAT.dark, live ? 0 : 1.1); if (!live) block(wh, MAT.yellow, -19.6, -11 + i * 5.5, 1.1, 0.14, 3.4, 1.0); }
    block(root, cladMat(0xC3C8CB, 6, 3), -37, 0, 6, 3, 4, 1.0); vSign(wh, 'CROSS-DOCK', 14, 1.5, 19.08, 7.2, 0, Math.PI / 2, { color: '#30343A' });
    { const t = makeTruck(0xE4E6E8); t.position.set(-84, -0.14, 0); t.rotation.y = -Math.PI / 2; root.add(t); }
    buildDock(ctx, S);
    ctx.asset('xdock', 'Cross-dock', 'POD STAGING', V3(-59, 12, 0), 'Loaded pods come in from the two bays on the west wall and are staged for the pod spine. Pods off the aircraft go back out the same way.');
    // fuel farm
    bund(root, 74, -39, 26, 14); fuelTank(root, 68, -39, 1.7, 9, 'JET A-1'); fuelTank(root, 80, -39, 1.7, 9, 'SAF', 0xDCE8DC);
    block(root, MAT.yellow, 58, -39, 2.2, 1.6, 2.6); block(root, MAT.red, 58, -44, 0.9, 1.4, 0.9);
    ctx.asset('fuel', 'Fuel farm', 'JET A-1 · SAF', V3(74, 6, -39), 'The hybrid powertrain is fuel-agnostic: Jet-A, SAF or biofuel. Bowsers run a fixed lane past each row of pads.');
    // remote operations centre and C2 mast
    const ops = shed(root, 70, -8, 22, 14, 7, { color: 0xE2E4E4, band: 0x0A4E86, bandH: 0.5 });
    ctx.glassBand(ops, 22, 14, 3.4, 1.9); block(ops, MAT.galv, 2, 0, 9, 3.2, 7, 7.3); ctx.glassBand(ops, 9, 7, 8.2, 1.6, 2, 0);
    const dome = mesh(sph(1.3, 20, 14), MAT.white, ops, -6, 8.4, -2); block(ops, MAT.galv, -6, -2, 1.2, 0.9, 1.2, 7.3);
    for (const [dx, dz] of [[8, 5], [9, 3.5], [7, -5]]) mesh(cyl(0.02, 0.03, 3.5, 6), MAT.dark, ops, dx, 9.2, dz);
    vSign(ops, S.def.roc ? 'REMOTE OPERATIONS CENTRE' : 'BASE OFFICE · DISPATCH', 12, 0.8, -11.08, 5.9, 0, -Math.PI / 2, { color: '#30343A', k: 0.7 });
    const mast = latticeMast(root, 86, -20, 27); for (const [y, r] of [[25, 0.6], [22.5, 0.45], [20, 0.9]]) mesh(cyl(r, r, 0.25, 16), MAT.white, mast, 0.6, y, 0, { rz: Math.PI / 2 });
    for (const a of [0, 2.1, 4.2]) block(mast, MAT.white, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.25, 1.8, 0.12, 15);
    ctx.halo(86, 27.3, -20, 0xFF3030, 2.4, true);
    if (S.def.roc) ctx.asset('roc', 'Remote operations centre', 'SUPERVISORY PILOTS · C2', V3(70, 12, -8), 'The only room with pilots in the network. Each supervisory pilot watches up to ' + CORRIDOR.pilotMax + ' aircraft; the number on shift follows demand. Primary C2 runs on the ground network with SATCOM behind it.');
    else ctx.asset('roc', 'Base office', 'DISPATCH · LINE MAINTENANCE · NO PILOTS', V3(70, 12, -8), 'A small site crew: a dispatch desk, line maintenance technicians and security. Every aircraft flying from here is supervised from the ROC at the main base.');
    mesh(cyl(0.05, 0.07, 10, 8), MAT.galv, root, 90, 5, 2); block(root, MAT.white, 90, 2, 0.5, 0.35, 0.5, 9.6);
    // line hangar
    const hg = shed(root, 72, 31, 36, 26, 10.5, { color: 0xD0D4D6, roof: 'gable', rise: 3.4, band: 0x0A4E86, bandH: 0.6 });
    opening(hg, 'w', 0, 20, 8.2, 36, 26, MAT.dark); block(hg, cladMat(0xBFC4C7, 6, 8.2), -18.2, -10.5, 0.25, 8.2, 6); block(hg, cladMat(0xBFC4C7, 6, 8.2), -18.2, 10.5, 0.25, 8.2, 6);
    vSign(hg, 'LINE MAINTENANCE', 13, 1.1, -18.1, 9.2, 0, -Math.PI / 2, { color: '#F4F4F2' });
    ctx.asset('hangar', 'Line hangar', 'DAILY CHECKS · ' + S.L.hangar + ' SLOTS', V3(72, 13, 31), 'Daily and line checks stay at base. Basic checks every ' + MX.basicFh + ' FH go to ' + ((ctx.sim._mroFrom(S.id) && ctx.sim.sites[ctx.sim._mroFrom(S.id).b].name) || 'the MRO hub') + '; a full check falls every ' + MX.fullFh + ' FH.');
    // stands for spare airframes
    S.L.stands.forEach((s, i) => { decal(root, padCanvas('S' + (i + 1), 'stand'), 13, 13, s.x, 0.02, s.z, { ry: -Math.PI / 2 }); });
    for (const z of [-37, 37]) lineDecal(root, -30, z + (z < 0 ? 1.6 : -1.6), 56, z + (z < 0 ? 1.6 : -1.6), 0.15, '#E7B416', 2.4);
    floodMast(ctx, -34, -49, 16, -11, -24); floodMast(ctx, 34, -49, 16, 11, -24); floodMast(ctx, -34, 49, 16, -11, 24); floodMast(ctx, 34, 49, 16, 11, 24); floodMast(ctx, -72, -49, 14, -55, -33); floodMast(ctx, -72, 49, 14, -55, 33);
    windsock(ctx, 44, -47); windsock(ctx, -40, 47);
    ctx.areas = [['Overview', 0, 0, 150, 32, 30], ['North pads', 0, -24, 62, 20, 30], ['South pads', 0, 24, 62, 200, 30], ['Pod spine', -6, -8, 38, 40, 22], ['Fuel farm', 70, -36, 44, -60, 26], ['Operations', 72, -10, 52, 110, 24], ['Hangar', 66, 30, 60, 130, 24], ['Pod loading', -90, 0, 58, 108, 27], ['Cross-dock', -70, 0, 86, 118, 22]];
  }

  if (kind === 'spoke') {
    flatPlane(root, MAT.asphalt, -131, -119, -900, 900, -0.14, 8); lineDecal(root, -125, -900, -125, 900, 0.18, '#E9E6D8', 9, -0.12);
    flatPlane(root, MAT.asphalt, -119, 56, -70, 70, -0.14, 8);
    fence(root, [[-117, -8], [-117, -72], [58, -72], [58, 72], [-117, 72], [-117, 8]], 2.4);
    // the customer's own distribution centre: the yard it already has becomes the launchpad
    const dc = shed(root, -46, 0, 46, 62, 11.5, { color: 0xCFC9BC, roof: 'gable', rise: 3.6 });
    for (let i = 0; i < 8; i++) { opening(dc, 'w', -24.5 + i * 7, 3.2, 3.4, 46, 62, MAT.dark, 1.1); }
    vSign(dc, 'DISTRIBUTION CENTRE', 20, 1.5, 23.08, 9.2, 0, Math.PI / 2, { color: '#3C4046' });
    opening(dc, 'n', 6, 3.2, 3.0, 46, 62, MAT.dark, 0); buildDock(ctx, S);
    for (const [z, c] of [[-17.5, 0xE4E6E8], [-3.5, 0xB7463A], [17.5, 0x3E6A94]]) { const t = makeTruck(c); t.position.set(-74.2, -0.14, z); t.rotation.y = -Math.PI / 2; root.add(t); }
    ctx.asset('dc', S.name.replace(' DC', '') + ' distribution centre', 'EXISTING WAREHOUSE', V3(-46, 14, 0), 'No runway, no vertiport. Two painted pads, a pod dock and a container cabin turn a working yard into a corridor end.');
    const pd = shed(root, 0, 0, 18, 8, 4.4, { color: 0xDADDDF, band: 0x0A4E86, bandH: 0.6 }); vSign(pd, 'LOGIXAIR', 7, 1.0, 9.08, 3.3, 0, Math.PI / 2);
    block(root, cladMat(0xC3C8CB, 14, 2.6), -16, 0, 14, 2.6, 3, 1.0);
    ctx.asset('spine', 'Pod dock', 'AUTOMATED SWAPPING DOCK', V3(0, 5.5, 0), 'A relocatable dock module tied into the warehouse conveyor, with a 10 × 10 m pad on each side. Swap time stays under ten minutes.');
    const cab = isoBox(root, 31, 9, Math.PI / 2, 0x0A4E86); mesh(sph(0.7, 16, 10), MAT.white, root, 31, 3.0, 9);
    ctx.asset('desk', 'Check-in cabin', 'ONE OPERATOR ON SHIFT', V3(31, 5, 9), 'No pilots here. One LogiXair operator checks pods in and out and walks the pads before each release; the supervisory pilots sit in the ROC at the main base.');
    latticeMast(root, 35, 15, 17, { base: 1.1, top: 0.4 }); ctx.halo(35, 17.3, 15, 0xFF3030, 2.2, true);
    ctx.asset('gcs', 'C2 ground station', 'CORRIDOR END · ' + Object.values(ctx.sim.routes).filter(r => r.b === S.id).map(r => r.id).join(' · '), V3(35, 8, 15), 'The station at the end of the corridor. Aircraft hand off between ground stations about every ' + C2.spacingKm + ' km, with SATCOM behind them.');
    bund(root, 30, -19, 9, 5); const tk = isoBox(root, 30, -19, 0, 0xE6E8EA); vSign(root, 'JET A-1', 3.4, 0.7, 30, 1.5, -17.76, 0, { color: '#B3261E' });
    for (const z of [-21, 21]) lineDecal(root, -4, z + (z < 0 ? 1.6 : -1.6), 22, z + (z < 0 ? 1.6 : -1.6), 0.15, '#E7B416', 2.4);
    floodMast(ctx, -13, -24, 13, 0, -12); floodMast(ctx, -13, 24, 13, 0, 12); windsock(ctx, 36, 26);
    S.L.stands.forEach((st, i) => { decal(root, padCanvas('S' + (i + 1), 'stand'), 12, 12, st.x, 0.02, st.z, { ry: Math.PI / 2 }); });
    ctx.asset('stands', 'Parking slot', 'ONE SLOT BESIDE THE PADS', V3(S.L.stands[0].x, 6, S.L.stands[0].z), 'A warehouse yard keeps its space for trucks. Overnight it holds at most one airframe on this slot and one on a pad, with the other pad always kept free for arrivals. Anything more flies on to a base or MRO hub to stand down.');
    ctx.areas = [['Overview', -12, 0, 110, 28, 32], ['Pads', 4, 0, 44, 60, 30], ['Pod dock', 0, -6, 30, 30, 22], ['Pod loading', -40, -39, 40, 205, 27], ['Warehouse', -62, 0, 100, 116, 24]];
    if (S.def.port) {
      // port interface: a bonded container stack inside the fence, and the quay cranes on the skyline
      const cc = [0xB7463A, 0x3E6A94, 0xD9A441, 0x6F7A72, 0x2F6B5A, 0xC9CDD2];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const hgt = 1 + ((r * 5 + k * 3 + S.id.charCodeAt(0)) % 3); for (let y = 0; y < hgt; y++) isoBox(root, 23.5 + k * 6.5, 50 + r * 6.1, 0, cc[(r * 4 + k + y * 5 + S.id.charCodeAt(1)) % cc.length], 6.06, y * 2.6); }
      lineDecal(root, 19, 46.6, 50, 46.6, 0.15, '#E7B416', 2.4);
      vSign(root, 'BONDED  STACK', 9, 0.9, 36.5, 3.2, 46.75, Math.PI, { color: '#F4F4F2' });
      flatPlane(root, MAT.asphalt, 452, 612, -256, 256, -0.2, 8);
      const cr = stdMat({ color: 0x2C5F9E, roughness: 0.6, metalness: 0.3 }), bm = stdMat({ color: 0xC8452F, roughness: 0.6, metalness: 0.3 });
      for (let i = 0; i < 4; i++) { const g = new THREE.Group(); g.position.set(560 + (i % 2) * 26, -0.3, -190 + i * 108); root.add(g);
        for (const [x, z] of [[-10, -11], [10, -11], [-10, 11], [10, 11]]) block(g, cr, x, z, 1.8, 46, 1.8);
        block(g, cr, 0, -11, 22, 2.2, 2, 44); block(g, cr, 0, 11, 22, 2.2, 2, 44); block(g, cr, -10, 0, 2, 2.2, 24, 30); block(g, cr, 10, 0, 2, 2.2, 24, 30);
        block(g, bm, 18, 0, 96, 3, 3.4, 46.2); block(g, cr, -4, 0, 2.4, 20, 2.4, 49); block(g, cr, -18, 0, 9, 7, 8, 49.2);
        ctx.halo(g.position.x - 4, 69.3, g.position.z, 0xFF3030, 3.2, true); }
      for (let i = 0; i < 30; i++) for (let y = 0; y <= (i * 7) % 4; y++) isoBox(root, 478 + (i % 3) * 5.2, -236 + Math.floor(i / 3) * 51 + (i % 2) * 13.5, Math.PI / 2, cc[(i + y * 3) % cc.length], 12.19, y * 2.6);
      ctx.asset('port', 'Port interface', 'BONDED STACK · QUAY 500 M', V3(36.5, 9, 56), 'Ship spares, samples and customs-sealed parcels move between the berth and the corridor here. A part that would wait a day for a truck is alongside in hours.');
      ctx.areas.push(['Port side', 34, 42, 64, 84, 9]);
    }
  }

  if (kind === 'mro') {
    flatPlane(root, MAT.asphalt, -131, -119, -900, 900, -0.14, 8); flatPlane(root, MAT.asphalt, -119, -62, -6, 14, -0.14, 8);
    fence(root, [[-117, -4], [-117, -66], [84, -66], [84, 52], [-117, 52], [-117, 14]], 2.4);
    const hg = shed(root, 0, -38, 100, 40, 13, { color: 0xD0D4D6, roof: 'gable', rise: 5, band: 0x0A4E86, bandH: 0.7 });
    for (const x of [-33, 0, 33]) { opening(hg, 's', x, 26, 9.6, 100, 40, MAT.dark); block(hg, cladMat(0xBFC4C7, 7, 9.6), x - 9.5, 20.25, 7, 9.6, 0.25); }
    vSign(hg, 'LOGIXAIR  MRO  ' + name.split(' ').pop(), 30, 1.8, 0, 11.4, 20.1, 0, { color: '#F4F4F2' });
    ctx.asset('hangar', 'MRO hangar', '50 SLOTS · BASIC AND FULL CHECKS', V3(0, 16, -38), 'Basic check every ' + MX.basicFh + ' flight hours, full check every ' + MX.fullFh + '. Airframe life ' + fmtInt(MX.lifeFh) + ' FH.');
    const ps = shed(root, -70, -4, 16, 22, 6, { color: 0xCFC9BC }); vSign(ps, 'ROTABLES STORE', 9, 0.9, 8.08, 4.6, 0, Math.PI / 2, { color: '#3C4046' });
    bund(root, 66, 32, 9, 5); isoBox(root, 66, 32, 0, 0xE6E8EA); lineDecal(root, -40, 24.4, 58, 24.4, 0.15, '#E7B416', 2.4);
    latticeMast(root, 76, -10, 20); ctx.halo(76, 20.3, -10, 0xFF3030, 2.2, true);
    floodMast(ctx, -44, 38, 15, -22, 12); floodMast(ctx, 44, 38, 15, 22, 12); windsock(ctx, 60, 6);
    ctx.areas = [['Overview', 0, -4, 150, 22, 30], ['Check pads', 0, 12, 70, 12, 26], ['Hangar', 0, -22, 110, -18, 20]];
  }

  if (kind === 'quay') {
    // quay wall, fendering and mooring furniture
    block(root, MAT.concrete, 36, 17.6, 320, 4.2, 1.4, -4.2); lineDecal(root, -124, 16.5, 196, 16.5, 0.3, '#E7B416');
    for (let x = -120; x <= 192; x += 8) mesh(cyl(0.5, 0.5, 2.2, 12), MAT.rubber, root, x, -1.1, 18.5);
    for (let x = -112; x <= 188; x += 15) { mesh(cyl(0.28, 0.36, 0.7, 12), MAT.dark, root, x, 0.35, 16.9); }
    flatPlane(root, MAT.asphalt, -124, 196, -62, -48, -0.14, 8); lineDecal(root, -124, -55, 196, -55, 0.18, '#E9E6D8', 9, -0.12);
    fence(root, [[-126, 17], [-126, -66], [198, -66], [198, 17]], 2.6);
    const wide = S.pads.length > 3, spx = wide ? 22 : 0, spw = wide ? 112 : 68, ox = wide ? 50 : 0;     // a five-pad shore base gets a longer pod store
    const sp = shed(root, spx, -25, spw, 10, 5.6, { color: 0xDADDDF, band: 0x0A4E86 }); rooftopKit(sp, spw, 10, 5.6, rnd, true);
    vSign(sp, 'LOGIXAIR', 12, 1.6, -spx, 4.2, 5.08, 0); vSign(sp, name, 14, 0.7, 28 - spx, 4.25, 5.08, 0, { color: '#30343A', k: 0.7, weight: 600 });
    ctx.asset('hangar', 'Line hangar', 'NIGHT STOP · ' + S.L.hangar + ' SLOTS', V3(-84, 14, -26), 'Airframes that are not needed stand down here for the daily inspection. Click to see who is inside.');
    ctx.asset('spine', 'Pod store', 'AUTOMATED SWAPPING DOCK', V3(0, 6.5, -25), S.def.navy ? 'Stores are consolidated into sealed pods by demand priority, then shuttled to the pad.' : 'Spares and supplies are consolidated into sealed pods against each platform’s call-off.');
    const wh = shed(root, -84, -26, 44, 30, 10, { color: S.def.navy ? 0xBFC6C4 : 0xCDD1D3, roof: 'gable', rise: 3.4 });
    for (let i = 0; i < 4; i++) opening(wh, 's', -15 + i * 10, 5, 5, 44, 30, MAT.dark);
    vSign(wh, S.def.navy ? 'NAVAL STORES' : 'SUPPLY BASE', 14, 1.4, 0, 8, 15.08, 0, { color: '#30343A' });
    const ops = shed(root, 54 + ox, -30, 20, 12, 7, { color: 0xE2E4E4, band: 0x0A4E86, bandH: 0.5 }); ctx.glassBand(ops, 20, 12, 3.6, 1.8);
    mesh(sph(1.2, 18, 12), MAT.white, ops, -5, 8.2, 0); block(ops, MAT.galv, -5, 0, 1.1, 0.8, 1.1, 7.3);
    const mast = latticeMast(root, 68 + ox, -36, 24); for (const [y, r] of [[22, 0.55], [19.5, 0.8]]) mesh(cyl(r, r, 0.25, 16), MAT.white, mast, 0.6, y, 0, { rz: Math.PI / 2 }); ctx.halo(68 + ox, 24.3, -36, 0xFF3030, 2.4, true);
    ctx.asset('roc', 'Operations and C2', 'SHORE GROUND STATION', V3(54 + ox, 11, -30), 'Shore end of the link. Beyond about ' + CORRIDOR.groundLinkKm + ' km the aircraft rides the SATCOM backup until the next station picks it up.');
    bund(root, -50, 9, 9, 5); isoBox(root, -50, 9, 0, 0xE6E8EA); vSign(root, 'JET A-1', 3.4, 0.7, -50, 1.5, 10.24, 0, { color: '#B3261E' });
    lineDecal(root, -44, 10.4, 30, 10.4, 0.15, '#E7B416', 2.4);
    // vessel alongside
    if (S.def.navy) { const v = buildNavalVessel(ctx, true); v.position.set(128, 0, 30); v.rotation.y = -Math.PI / 2; root.add(v);
      for (const [x, z, c] of [[84, -8, 0x6F7A72], [84, -4.8, 0x6F7A72], [92, -8, 0x59636B], [100, -6, 0x6F7A72]]) isoBox(root, x, z, 0, c);
      ctx.asset('ship', 'Vessel alongside', 'UNDER REPLENISHMENT', V3(128, 22, 30), 'Ship-to-shore transfer is the pilot the Navy conversation is built around: the same pod leaves the quay and lands on the deck.');
    } else { const v = buildPSV(ctx); v.position.set(112, 0, 26.5); v.rotation.y = -Math.PI / 2; root.add(v);
      for (let i = 0; i < 9; i++) isoBox(root, 78 + (i % 3) * 6.6, -12 + Math.floor(i / 3) * 3 - (i > 5 ? 3 : 0), 0, [0xB7463A, 0x3E6A94, 0xD9A441, 0x6F7A72][i % 4], 6.06, i > 5 ? 2.6 : 0);
      const pr = stdMat({ color: 0x8C5A3A, roughness: 0.6, metalness: 0.5 }); for (let i = 0; i < 14; i++) mesh(cyl(0.22, 0.22, 12, 10), pr, root, 120 + (i % 7) * 0.5, 0.25 + Math.floor(i / 7) * 0.45, -8, { rx: Math.PI / 2 });
      ctx.asset('ship', 'Supply vessel alongside', 'THE 12-KNOT ALTERNATIVE', V3(112, 16, 26.5), 'Deck cargo still goes by boat. Urgent, light items are what pay helicopter rates today, and what the pod carries instead.');
    }
    floodMast(ctx, -34, -14, 16, -11, 0); floodMast(ctx, 34, -14, 16, 11, 0); floodMast(ctx, 90, -40, 16, 100, 0); windsock(ctx, 40, 13);
    ctx.areas = [['Overview', 10, -4, 150, 200, 30], ['Pads', 0, 0, 62, 215, 28], ['Pod store', 0, -22, 44, 180, 22], ['Berth', 110, 14, 120, 150, 24]];
  }
}
