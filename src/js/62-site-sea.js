/* ============================================================================
   SEA SITES — a naval vessel under way (deck landing), a production platform
   (helideck landing) and the supply vessel used as set dressing.
   Vessels are generic: no real class or hull number is depicted.
   ========================================================================== */

function railing(parent, pts, y, h, color) {
  const pos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (const k of [0.5, 1]) pos.push(a[0], y + h * k, a[1], b[0], y + h * k, b[1]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 2));
    for (let j = 0; j <= n; j++) { const x = lerp(a[0], b[0], j / n), z = lerp(a[1], b[1], j / n); pos.push(x, y, z, x, y + h, z); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COL(color || 0xC9CED2) })); parent.add(l); return l;
}

function buildNavalVessel(ctx, moored) {
  const g = new THREE.Group(), H = hullGeo(132, 19, 8.5, -5.5, { color: 0x7F8A93, boot: 0x23262A, rake: 7 });
  const hm = stdMat({ map: texOf(TEX.plate, { repeat: [10, 2] }), vertexColors: true, roughness: 0.6, metalness: 0.25, side: THREE.DoubleSide });
  mesh(H.hull, hm, g); const dk = tiled(MAT.deck, 19, 132, 6); dk.side = THREE.DoubleSide; dk.color = COL(0x9AA2A8); mesh(H.deck, dk, g, 0, 0.02, 0, { cast: false });
  const grey = stdMat({ map: texOf(TEX.plate, { repeat: [3, 1] }), color: 0x8C969E, roughness: 0.62, metalness: 0.2 }), dark = MAT.navyDark;
  const D = 8.5;
  // forward superstructure, bridge, funnel, mast
  block(g, grey, 0, -23, 15, 5.6, 34, D); block(g, grey, 0, -31, 13.6, 3.0, 14, D + 5.6); block(g, MAT.glass, 0, -31, 13.7, 1.1, 14.1, D + 6.9, { cast: false });
  block(g, grey, 0, -31, 11, 0.4, 16, D + 8.6); block(g, grey, 0, -13, 9, 2.6, 12, D + 5.6);
  block(g, grey, 0, -10, 5, 5.5, 7, D + 8.2); block(g, MAT.dark, 0, -10, 4.4, 0.8, 6.4, D + 13.7);
  mesh(cyl(0.35, 0.55, 13, 10), grey, g, 0, D + 15.2, -24); block(g, grey, 0, -24, 9, 0.25, 0.4, D + 17.5); block(g, grey, 0, -24, 5, 0.25, 0.4, D + 20);
  const radar = block(g, MAT.dark, 0, -24, 4.2, 0.5, 0.5, D + 21.7); ctx.spinners.push(radar);
  mesh(sph(1.3, 16, 10), MAT.white, g, 0, D + 10.4, -36); mesh(sph(0.8, 14, 10), MAT.white, g, 3.5, D + 12.4, -27);
  for (const s of [-1, 1]) { block(g, grey, s * 8.3, -6, 0.3, 3, 0.3, D); const rb = mesh(sph(1, 14, 10), MAT.orange, g, s * 9.0, D + 3.2, -6); rb.scale.set(1.0, 0.8, 3.4); }
  // life-raft canisters, bridge wings, whip aerials and a stores crane amidships
  for (const s of [-1, 1]) { for (const z of [-20, -17, -14]) mesh(cyl(0.45, 0.45, 1.5, 10), MAT.white, g, s * 7.9, D + 0.6, z, { rx: Math.PI / 2 }); block(g, grey, s * 8.4, -34, 3.2, 0.3, 4, D + 5.6); mesh(cyl(0.03, 0.05, 6, 6), dark, g, s * 5.5, D + 11.6, -36); }
  mesh(cyl(0.7, 0.8, 3.2, 12), grey, g, -5.5, D + 1.6, 1.5); { const b = block(g, grey, -5.5, 1.5, 0.5, 0.5, 9, D + 3.2); b.position.z = -2.2; b.rotation.x = 0.35; }
  for (const s of [-1, 1]) mesh(cyl(0.5, 0.6, 2.6, 10), MAT.dark, g, s * 1.2, D + 15.2, -10);
  // foredeck: capstans, breakwater, replenishment kingpost
  block(g, grey, 0, -47, 12, 1.0, 0.4, D); for (const s of [-1, 1]) mesh(cyl(0.6, 0.7, 0.9, 12), dark, g, s * 2.2, D + 0.45, -55);
  mesh(cyl(0.3, 0.45, 9, 10), grey, g, 0, D + 4.5, -43); tube(g, grey, V3(0, D + 8.6, -43), V3(0, D + 5, -52), 0.14, 8);
  // hangar with its door on to the flight deck
  block(g, grey, 0, 16.4, 15.5, 7.2, 21, D); block(g, grey, 0, 12, 10, 2.2, 8, D + 7.2);
  // flight deck: darker non-skid, markings, safety nets, deck-edge lights
  const fd = tiled(MAT.deck, 19, 36, 6); fd.color = COL(0x70777D); flatPlane(g, fd, -9.6, 9.6, 27, 64.5, D + 0.03);
  const mk = cvs(512, 1024), c = mk.getContext('2d'), sx = 512 / 19.2, sz = 1024 / 37.5; c.strokeStyle = '#F2F2EE'; c.lineWidth = 5;
  c.strokeRect(0.9 * sx, 1.0 * sz, 17.4 * sx, 35.2 * sz); c.setLineDash([26, 18]); c.beginPath(); c.moveTo(256, 1.0 * sz); c.lineTo(256, 36.2 * sz); c.stroke(); c.setLineDash([]);
  c.lineWidth = 7; c.beginPath(); c.moveTo(0.9 * sx, 8 * sz); c.lineTo(18.3 * sx, 8 * sz); c.stroke();
  decal(g, mk, 19.2, 37.5, 0, D + 0.05, 45.75);
  const nm = stdMat({ color: 0x4E555B, roughness: 0.8, metalness: 0.4, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  for (const s of [-1, 1]) { const n = block(g, nm, s * 10.5, 46, 1.9, 0.06, 34, D - 0.3, { cast: false }); n.rotation.z = -s * 0.25; }
  { const n = block(g, nm, 0, 65.4, 18, 0.06, 1.9, D - 0.3, { cast: false }); n.rotation.x = 0.25; }
  railing(g, [[-8.6, -62], [-9.4, -40], [-9.5, 26]], D, 1.1, 0xB8BEC3); railing(g, [[8.6, -62], [9.4, -40], [9.5, 26]], D, 1.1, 0xB8BEC3);
  for (let z = 29; z <= 63; z += 4.25) for (const s of [-1, 1]) { mesh(sph(0.09, 8, 6), basicMat({ color: 0x38FF9A }), g, s * 9.3, D + 0.12, z, { cast: false }); if (ctx && !moored) ctx.halo(s * 9.3, D + 0.15, z, 0x38FF9A, 1.1); }
  if (ctx && !moored) { ctx.halo(0, D + 22.6, -24, 0xffffff, 2.6); ctx.halo(-9.2, D + 7, -31, 0xff3030, 2); ctx.halo(9.2, D + 7, -31, 0x30ff80, 2); ctx.halo(0, D + 1.5, 65.5, 0xffffff, 2); }
  return g;
}

function buildPSV(ctx) {
  const g = new THREE.Group(), H = hullGeo(74, 16.5, 5.2, -4.5, { color: 0xC8502E, boot: 0x1E2124, rake: 4, bow: 20, stern: 0.96 });
  mesh(H.hull, stdMat({ map: texOf(TEX.plate, { repeat: [6, 1.5] }), vertexColors: true, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }), g);
  const dk = tiled(MAT.deck, 16, 74, 6); dk.side = THREE.DoubleSide; dk.color = COL(0x8A6F52); mesh(H.deck, dk, g, 0, 0.02, 0, { cast: false });
  const wh = stdMat({ color: 0xE9EBEC, roughness: 0.5 }), D = 5.2;
  block(g, stdMat({ color: 0xC8502E, roughness: 0.6 }), 0, -27, 15.4, 3, 18, D); block(g, wh, 0, -26, 14, 8.4, 14, D + 3); block(g, wh, 0, -27, 15.5, 3, 9, D + 11.4);
  block(g, MAT.glass, 0, -27, 15.6, 1.2, 9.1, D + 12.5, { cast: false }); block(g, wh, 0, -27, 12, 0.4, 10, D + 14.4);
  mesh(cyl(0.2, 0.3, 7, 8), wh, g, 0, D + 18, -25); mesh(sph(0.9, 12, 8), MAT.white, g, 3, D + 15.6, -29);
  for (const s of [-1, 1]) block(g, MAT.dark, s * 4.5, -19, 1.6, 4, 1.6, D + 11.4);
  for (const s of [-1, 1]) block(g, stdMat({ color: 0xC8502E, roughness: 0.6 }), s * 7.9, 12, 0.5, 2.4, 46, D);
  for (let i = 0; i < 6; i++) isoBox(g, (i % 2 ? 2.6 : -2.6), -6 + Math.floor(i / 2) * 7.5, Math.PI / 2, [0x3E6A94, 0xD9A441, 0x6F7A72, 0xB7463A][i % 4], 6.06, D);
  const pr = stdMat({ color: 0x8C5A3A, roughness: 0.6, metalness: 0.5 }); for (let i = 0; i < 10; i++) mesh(cyl(0.2, 0.2, 12, 8), pr, g, -1.2 + (i % 5) * 0.5, D + 0.25 + Math.floor(i / 5) * 0.42, 24, { rx: Math.PI / 2 });
  return g;
}

function buildShipSite(ctx, S) {
  ctx.needOcean(0, 1.0);
  const ship = buildNavalVessel(ctx, false); ctx.root.add(ship); ctx.ship = ship;
  ctx.addPad(S.pads[0], 0, 'deck');
  // wake: stern wash and two bow-wave arms, scrolled aft with ship speed
  const wc = cvs(256, 512), g = wc.getContext('2d'), n = makeNoise(41), im = g.createImageData(256, 512);
  for (let y = 0, i = 0; y < 512; y++) for (let x = 0; x < 256; x++, i += 4) {
    const u = x / 256, v = y / 512, e = Math.sin(u * Math.PI), f = n.fbm(u * 6, v * 12, 4, 6) * 1.3;
    const a = clamp01((f - 0.42) * 3) * e * e; im.data[i] = im.data[i + 1] = im.data[i + 2] = 245; im.data[i + 3] = a * 235;
  }
  g.putImageData(im, 0, 0);
  const mk = (w, L, x, z, ry, taper) => {
    const geo = new THREE.PlaneGeometry(w, L, 1, 24); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, al = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { const t = (p.getZ(i) + L / 2) / L; p.setX(i, p.getX(i) * (1 + t * taper)); al[i] = (1 - t) * (1 - t); }
    geo.setAttribute('fade', new THREE.BufferAttribute(al, 1)); geo.translate(0, 0, L / 2);
    const t = texOf(wc); t.repeat.set(1, L / 60);
    const m = new THREE.ShaderMaterial({ uniforms: { map: { value: t }, off: { value: 0 }, rep: { value: L / 60 }, lum: { value: 1 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute float fade; varying float vf; varying vec2 vu; void main(){ vf = fade; vu = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float off; uniform float rep; uniform float lum; varying float vf; varying vec2 vu; void main(){ vec4 c = texture2D(map, vec2(vu.x, (1.0 - vu.y) * rep - off)); gl_FragColor = vec4(vec3(lum), c.a * vf); }' });
    const o = new THREE.Mesh(geo, m); o.position.set(x, 0.75, z); o.rotation.y = ry; o.renderOrder = 3; ctx.root.add(o); ctx.wakes.push(m); return o;
  };
  mk(17, 320, 0, 60, 0, 2.6); mk(7, 190, -7, -52, 0.33, 2.2); mk(7, 190, 7, -52, -0.33, 2.2);
  ctx.lamp(-6.5, 17.2, 26.4, -2, 8.5, 44, 90); ctx.lamp(6.5, 17.2, 26.4, 2, 8.5, 44, 90); ctx.lamp(0, 21, -18, 0, 8.5, -50, 120);
  ctx.asset('ship', S.name, 'UNDER WAY · ' + S.def.track.kt + ' KT', V3(0, 34, -20), 'Generic fleet support vessel. The aircraft joins from astern, matches the ship and lands on the flight deck; the pod goes below through the hangar.');
  ctx.areas = [['Flight deck', 0, 44, 62, -28, 24], ['Whole ship', 0, 5, 230, -40, 20], ['From astern', 0, 70, 150, 4, 9], ['Bridge', 0, -28, 90, 150, 16]];
  ctx.home = [0, 30, 150, -32, 20];
}

function buildPlatformSite(ctx, S) {
  ctx.needOcean(0, 0.8);
  const g = ctx.root, st = stdMat({ color: 0xB9952B, roughness: 0.6, metalness: 0.4 }), grey = stdMat({ map: texOf(TEX.plate, { repeat: [2, 1] }), color: 0xAEB4B8, roughness: 0.6, metalness: 0.3 });
  const steel = stdMat({ color: 0xA98E32, roughness: 0.65, metalness: 0.4 }), white = stdMat({ color: 0xE8EAEA, roughness: 0.55 });
  const jacket = (cx, cz, half, top, legR) => {
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [V3(cx + sx * (half + 3.2), -16, cz + sz * (half + 3.2)), V3(cx + sx * half, top, cz + sz * half)]);
    for (const l of legs) tube(g, steel, l[0], l[1], legR, 14);
    const lv = [0.14, 0.42, 0.72, 0.97];
    for (let k = 0; k < 4; k++) for (let i = 0; i < lv.length; i++) {
      const a = legs[k][0].clone().lerp(legs[k][1], lv[i]), b = legs[(k + 1) % 4][0].clone().lerp(legs[(k + 1) % 4][1], lv[i]); tube(g, steel, a, b, legR * 0.42, 8);
      if (i < lv.length - 1) { const b2 = legs[(k + 1) % 4][0].clone().lerp(legs[(k + 1) % 4][1], lv[i + 1]), a2 = legs[k][0].clone().lerp(legs[k][1], lv[i + 1]); tube(g, steel, a, b2, legR * 0.34, 8); tube(g, steel, b, a2, legR * 0.34, 8); }
    }
    for (let i = 0; i < 6; i++) mesh(cyl(0.38, 0.38, top + 14, 8), steel, g, cx - 5 + (i % 3) * 5, (top - 14) / 2, cz - 3 + Math.floor(i / 3) * 6);
  };
  // main process platform
  jacket(0, 0, 17, 21, 1.15);
  const deck = (y, w, d, x, z) => { block(g, MAT.navyDark, x || 0, z || 0, w, 0.9, d, y - 0.9); railing(g, [[(x || 0) - w / 2, (z || 0) - d / 2], [(x || 0) + w / 2, (z || 0) - d / 2], [(x || 0) + w / 2, (z || 0) + d / 2], [(x || 0) - w / 2, (z || 0) + d / 2], [(x || 0) - w / 2, (z || 0) - d / 2]], y, 1.1, 0xE7B416); };
  deck(22, 44, 44); deck(30, 48, 46);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) mesh(cyl(0.5, 0.5, 8, 10), steel, g, sx * 19, 26, sz * 19);
  block(g, grey, -12, -11, 18, 4.5, 14, 22); block(g, grey, 8, 10, 16, 4, 12, 22); block(g, st, -14, 12, 10, 3, 8, 22);
  // topsides modules, pipe rack, exhaust stacks
  block(g, grey, -12, -12, 20, 7.5, 13, 30); block(g, grey, -14, 10, 14, 6, 14, 30); block(g, white, -3, 2, 6, 4, 8, 30);
  for (const z of [5, 9, 13]) mesh(cyl(0.7, 0.8, 9, 14), MAT.galv, g, -18, 40.5, z);
  const pm = stdMat({ color: 0xB8BDC1, roughness: 0.45, metalness: 0.6 });
  for (let i = 0; i < 9; i++) mesh(cyl(0.22, 0.22, 30, 8), pm, g, -6, 31 + (i % 3) * 0.6, -1.5 + Math.floor(i / 3) * 0.7 + 18, { rz: Math.PI / 2 });
  for (const x of [-18, -6, 6]) { block(g, st, x, 18.6, 0.3, 2.4, 0.3, 30); block(g, st, x, 20.2, 0.3, 2.4, 0.3, 30); }
  // living quarters with the helideck cantilevered to the east
  block(g, white, 17.5, 0, 15, 7, 26, 30.01);
  for (const y of [32.2, 35.2]) { block(g, MAT.glass, 17.5, 0, 15.06, 0.9, 22, y, { cast: false }); }
  block(g, white, 22.4, 0, 6, 2.9, 6, 37.01); block(g, MAT.orange, 17.5, 0, 15.1, 0.5, 26.1, 36.5);
  const oct = new THREE.CylinderGeometry(12, 12, 0.5, 8); oct.rotateY(Math.PI / 8);
  const hd = tiled(MAT.deck, 24, 24, 6); hd.color = COL(0x4F6B5C); mesh(oct, hd, g, 36, 37.75, 0);
  const net = new THREE.CylinderGeometry(13.6, 12, 0.5, 8, 1, true); net.rotateY(Math.PI / 8);
  mesh(net, stdMat({ color: 0x4E555B, roughness: 0.8, transparent: true, opacity: 0.7, side: THREE.DoubleSide }), g, 36, 37.55, 0, { cast: false });
  for (const z of [-8, 0, 8]) { tube(g, steel, V3(25, 30.2, z), V3(42, 37.4, z * 0.9), 0.3, 8); tube(g, steel, V3(25, 36, z), V3(34, 37.4, z), 0.22, 8); }
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283 + 0.2, x = 36 + Math.cos(a) * 11.6, z = Math.sin(a) * 11.6; mesh(sph(0.09, 8, 6), basicMat({ color: 0x38FF9A }), g, x, 38.08, z, { cast: false }); ctx.halo(x, 38.1, z, 0x38FF9A, 1.0); }
  const nm = textCanvas(S.name.toUpperCase(), { w: 1024, h: 128, color: '#F5F5F2', size: 78 }); decal(g, nm, 12, 1.5, 36, 38.03, 8.6);
  for (const s of [-1, 1]) { const lb = mesh(sph(1, 14, 10), MAT.orange, g, 12, 28.2, s * 15.2); lb.scale.set(4, 1.5, 1.6); tube(g, st, V3(12, 30, s * 13), V3(12, 30, s * 15.6), 0.12, 6); }
  // pedestal cranes
  const crane = (x, z, ang, el) => { mesh(cyl(0.9, 1.0, 7, 12), st, g, x, 33.5, z); const c = new THREE.Group(); c.position.set(x, 37, z); c.rotation.y = ang; g.add(c); block(c, st, 0, 0, 3, 2.6, 3.4); const bm = block(c, st, 0, 14, 1.0, 1.0, 28, 2); bm.geometry = box(1.0, 1.0, 28); bm.position.set(0, 2.2 + Math.sin(el) * 14, Math.cos(el) * 14); bm.rotation.x = -el; };
  crane(-20, 18, 2.3, 0.55); crane(8, -20, -0.5, 0.75);
  // flare boom
  const f0 = V3(-24, 30, -16), f1 = V3(-58, 62, -40); for (const o of [V3(0, 0, 0), V3(0, 1.6, 0), V3(1.2, 0.8, 1.2)]) tube(g, steel, f0.clone().add(o), f1.clone().add(o.clone().multiplyScalar(0.3)), 0.16, 6);
  for (let i = 1; i < 9; i++) { const p = f0.clone().lerp(f1, i / 9); tube(g, steel, p, p.clone().add(V3(0, 1.6 * (1 - i / 12), 0)), 0.08, 5); }
  ctx.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: AC.glowTex, color: COL(0xFF8A2A), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); ctx.flare.position.copy(f1).add(V3(0, 2.5, 0)); ctx.flare.scale.set(9, 13, 1); g.add(ctx.flare);
  ctx.flareLight = new THREE.PointLight(COL(0xFF8A2A), 0, 260, 1.6); ctx.flareLight.position.copy(f1); g.add(ctx.flareLight);
  // bridge-linked wellhead platform with a derrick
  jacket(0, -92, 10, 19, 0.9); deck(20, 26, 26, 0, -92); deck(26, 28, 28, 0, -92);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { tube(g, steel, V3(sx * 5, 26, -92 + sz * 5), V3(sx * 1.4, 58, -92 + sz * 1.4), 0.22, 6); mesh(cyl(0.4, 0.4, 6, 8), steel, g, sx * 11, 23, -92 + sz * 11); }
  for (let i = 1; i < 6; i++) { const y = 26 + i * 5.3, r = lerp(5, 1.4, i / 6); for (let k = 0; k < 4; k++) { const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; tube(g, steel, V3(c[k][0] * r, y, -92 + c[k][1] * r), V3(c[(k + 1) % 4][0] * r, y, -92 + c[(k + 1) % 4][1] * r), 0.1, 5); } }
  block(g, MAT.navyDark, 0, -51, 3, 0.4, 56, 26.6); railing(g, [[-1.5, -23], [-1.5, -79]], 27, 1.1, 0xE7B416); railing(g, [[1.5, -23], [1.5, -79]], 27, 1.1, 0xE7B416);
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) tube(g, steel, V3(s * 1.5, 27, -23 - i * 6.2), V3(s * 1.5, 30, -26.1 - i * 6.2), 0.08, 5);
  for (const s of [-1, 1]) tube(g, steel, V3(s * 1.5, 30, -23), V3(s * 1.5, 30, -79), 0.12, 6);
  // boat landing and a supply vessel standing by
  block(g, MAT.rubber, -22.5, 0, 0.8, 5, 8, -1.5);
  const psv = buildPSV(ctx); psv.position.set(-120, 0, 70); psv.rotation.y = 0.6; g.add(psv); ctx.bobbers.push(psv);
  for (const [x, z] of [[-24, -23], [24, -23], [24, 23], [-24, 23]]) ctx.halo(x, 31.4, z, 0xffffff, 2.2, true);
  ctx.halo(0, 58.6, -92, 0xff3030, 2.6, true);
  ctx.lamp(23, 41.2, -9, 36, 38, 0, 70); ctx.lamp(23, 41.2, 9, 36, 38, 0, 70); ctx.lamp(-2, 44, 0, -12, 30, 6, 90); ctx.lamp(0, 34, -80, 0, 26, -92, 60);
  ctx.addPad(S.pads[0], 0, 'heli');
  ctx.asset('plat', S.name, 'PRODUCTION PLATFORM', V3(0, 48, 0), 'Indicative field position. A helideck is already a landing pad: the 7 m × 5 m footprint needs about 35 m² of clear deck.');
  ctx.areas = [['Helideck', 34, 0, 70, -62, 22], ['Platform', 0, -30, 280, -48, 16], ['From the sea', 20, 0, 200, -80, 4]];
  ctx.home = [14, -10, 215, -52, 17]; ctx.homeY = 30;
}
