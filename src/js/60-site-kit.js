/* ============================================================================
   SITE KIT — parts shared by every site scene: buildings, masts, vehicles,
   tanks, fences, vegetation, pad markings. Dimensions are metres.
   ========================================================================== */

/* a building shell: clad walls on a concrete plinth with a gable or flat roof */
function shed(parent, x, z, w, d, h, o) {
  o = o || {}; const g = new THREE.Group(); g.position.set(x, 0, z); if (o.ry) g.rotation.y = o.ry; parent.add(g);
  const col = o.color == null ? 0xD4D8DA : o.color;
  const mx = cladMat(col, d, h), mz = cladMat(col, w, h), top = MAT.roof;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mx, mx, top, top, mz, mz]); body.position.y = h / 2 + 0.01; body.castShadow = body.receiveShadow = true; g.add(body);
  block(g, MAT.concrete, 0, 0, w + 0.5, 0.35, d + 0.5);
  if (o.ao !== false) contactShadow(g, 0, 0, w + 5, d + 5, 0, o.aoY || 0);
  if (o.band) { const bm = stdMat({ color: o.band, roughness: 0.6, metalness: 0.2 }); block(g, bm, 0, 0, w + 0.06, o.bandH || 0.9, d + 0.06, h - (o.bandH || 0.9) - (o.bandOff || 0.5)); }
  if (o.roof === 'gable') {
    const rise = o.rise || w * 0.12, sh = new THREE.Shape(); sh.moveTo(-w / 2 - 0.4, 0); sh.lineTo(0, rise); sh.lineTo(w / 2 + 0.4, 0); sh.closePath();
    const rg = new THREE.ExtrudeGeometry(sh, { depth: d + 0.8, bevelEnabled: false }); rg.translate(0, h, -d / 2 - 0.4);
    const rm = tiled(MAT.roof, 1, 1, 1); rm.map.repeat.set(0.25, 0.25); rm.map.rotation = Math.PI / 2;
    mesh(rg, rm, g);
  } else { block(g, MAT.galv, 0, 0, w + 0.3, 0.35, d + 0.3, h); }
  return g;
}
/* dark recessed opening on a wall; side: 'n' (-z), 's' (+z), 'e' (+x), 'w' (-x) */
function opening(g, side, off, w, h, bw, bd, mat, y0) {
  const t = 0.12, m = mat || MAT.dark;
  if (side === 'n') return block(g, m, off, -bd / 2 - t / 2, w, h, t, y0 || 0, { cast: false });
  if (side === 's') return block(g, m, off, bd / 2 + t / 2, w, h, t, y0 || 0, { cast: false });
  if (side === 'e') return block(g, m, bw / 2 + t / 2, off, t, h, w, y0 || 0, { cast: false });
  return block(g, m, -bw / 2 - t / 2, off, t, h, w, y0 || 0, { cast: false });
}
/* roller door that can open: returns the slat panel (scale.y 1 = closed) */
function rollerDoor(parent, x, z, w, h, facing) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = facing === 's' ? 0 : facing === 'n' ? Math.PI : facing === 'e' ? Math.PI / 2 : -Math.PI / 2; parent.add(g);
  block(g, MAT.dark, 0, -0.5, w, h, 1.0, 0, { cast: false });                                 // dark void behind
  block(g, MAT.yellow, -w / 2 - 0.1, 0.05, 0.2, h + 0.2, 0.25); block(g, MAT.yellow, w / 2 + 0.1, 0.05, 0.2, h + 0.2, 0.25); block(g, MAT.galv, 0, 0.05, w + 0.6, 0.3, 0.3, h);
  const pm = stdMat({ map: texOf(TEX.roof, { repeat: [1, h / 0.8] }), color: 0xB8BEC3, roughness: 0.5, metalness: 0.5 }); pm.map.rotation = Math.PI / 2;
  const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), pm); p.geometry.translate(0, -h / 2, 0); p.position.set(0, h, 0.04); p.castShadow = true; g.add(p);
  return p;
}
function setDoor(p, open) { p.scale.y = Math.max(0.04, 1 - open); }

function latticeMast(parent, x, z, h, o) {
  o = o || {}; const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const b = o.base || 1.5, tp = o.top || 0.5, m = o.mat || MAT.galv, legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { legs.push([V3(sx * b / 2, 0, sz * b / 2), V3(sx * tp / 2, h, sz * tp / 2)]); tube(g, m, legs[legs.length - 1][0], legs[legs.length - 1][1], 0.045, 6); }
  const n = Math.round(h / 2.4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const a0 = legs[k][0].clone().lerp(legs[k][1], i / n), b1 = legs[(k + 1) % 4][0].clone().lerp(legs[(k + 1) % 4][1], (i + 1) / n), a1 = legs[k][0].clone().lerp(legs[k][1], (i + 1) / n), b1h = legs[(k + 1) % 4][0].clone().lerp(legs[(k + 1) % 4][1], (i + 1) / n);
    tube(g, m, a0, b1, 0.02, 4).castShadow = false; tube(g, m, a1, b1h, 0.02, 4).castShadow = false;
  }
  block(g, MAT.concrete, 0, 0, b + 0.8, 0.3, b + 0.8);
  return g;
}
/* floodlight mast; registers its lamp head with the site so it can glow and cast light at night */
function floodMast(site, x, z, h, ax, az) {
  const g = new THREE.Group(); g.position.set(x, 0, z); site.root.add(g);
  mesh(cyl(0.11, 0.17, h, 10), MAT.galv, g, 0, h / 2, 0); block(g, MAT.concrete, 0, 0, 0.9, 0.3, 0.9);
  const head = new THREE.Group(); head.position.y = h; head.rotation.y = Math.atan2(ax - x, az - z); g.add(head);
  block(head, MAT.dark, 0, 0, 2.0, 0.12, 0.2, 0.1);
  for (const dx of [-0.75, -0.25, 0.25, 0.75]) { const l = block(head, site.lampMat, dx, 0.22, 0.4, 0.34, 0.14, -0.2, { cast: false }); l.rotation.x = 0.7; }
  site.halo(x, h + 0.05, z, 0xFFF1D6, 5.5);
  if (site.spots.length < 5) {
    const s = new THREE.SpotLight(COL(0xFFE9C4), 0, 150, 0.95, 0.6, 1.2); s.position.set(x, h, z); s.target.position.set(ax, 0, az); site.root.add(s); site.root.add(s.target); site.spots.push(s);
  }
  return g;
}
function windsock(site, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); site.root.add(g);
  mesh(cyl(0.04, 0.06, 6, 8), MAT.galv, g, 0, 3, 0);
  const sock = new THREE.Group(); sock.position.y = 6; g.add(sock);
  const c = cvs(64, 16), cx = c.getContext('2d'); for (let i = 0; i < 5; i++) { cx.fillStyle = i % 2 ? '#F2F2EE' : '#E8523F'; cx.fillRect(i * 12.8, 0, 12.8, 16); }
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.14, 2.4, 12, 1, true), new THREE.MeshStandardMaterial({ map: texOf(c, { clamp: true }), side: THREE.DoubleSide, roughness: 0.9 }));
  cone.geometry.rotateZ(Math.PI / 2); cone.geometry.rotateX(Math.PI / 2); cone.geometry.translate(1.3, 0, 0); cone.castShadow = true; sock.add(cone); cone.material.map.rotation = Math.PI / 2;
  site.socks.push(sock); return g;
}
/* horizontal storage tank in a bund */
function fuelTank(parent, x, z, r, L, label, col) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const m = stdMat({ color: col || 0xE4E7E9, roughness: 0.45, metalness: 0.3 });
  const t = mesh(new THREE.CylinderGeometry(r, r, L, 28), m, g, 0, r + 0.7, 0, { rz: Math.PI / 2 });
  for (const s of [-1, 1]) { const c = mesh(sph(r, 24, 14), m, g, s * L / 2, r + 0.7, 0); c.scale.x = 0.32; block(g, MAT.concrete, s * L * 0.3, 0, 0.5, 0.75 + r * 0.25, r * 1.7); }
  mesh(cyl(0.3, 0.3, 0.4, 12), MAT.galv, g, 0, 2 * r + 0.8, 0); tube(g, MAT.yellow, V3(-L * 0.35, 2 * r + 0.75, 0), V3(L * 0.35, 2 * r + 0.75, 0), 0.03, 6);
  const dc = textCanvas(label, { w: 512, h: 128, color: '#0A4E86', size: 84 });
  for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.5, L * 0.125), new THREE.MeshStandardMaterial({ map: texOf(dc, { clamp: true }), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); d.position.set(0, r + 0.75, s * (r + 0.012)); d.rotation.y = s > 0 ? 0 : Math.PI; g.add(d); }
  return g;
}
function bund(parent, x, z, w, d) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  block(g, MAT.concrete, 0, -d / 2, w, 0.7, 0.25); block(g, MAT.concrete, 0, d / 2, w, 0.7, 0.25); block(g, MAT.concrete, -w / 2, 0, 0.25, 0.7, d); block(g, MAT.concrete, w / 2, 0, 0.25, 0.7, d);
  return g;
}
function isoBox(parent, x, z, ry, color, len, y0) {
  len = len || 6.06; const m = cladMat(color, len, 2.59, 2.6);
  const b = mesh(new THREE.BoxGeometry(len, 2.59, 2.44), m, parent, x, (y0 || 0) + 1.3, z, { ry: ry || 0 }); return b;
}
/* box truck (cab toward +z) */
function makeTruck(color) {
  const g = new THREE.Group();
  const cab = stdMat({ color: color || 0xE4E6E8, roughness: 0.4, metalness: 0.3 }), body = cladMat(0xECEEEE, 7.2, 2.7, 2.6);
  block(g, MAT.dark, 0, 0, 2.2, 0.35, 9.4, 0.55);
  block(g, cab, 0, 3.55, 2.4, 2.3, 2.1, 0.9); block(g, MAT.glass, 0, 4.62, 2.2, 0.9, 0.06, 2.0, { cast: false });
  block(g, body, 0, -1.3, 2.5, 2.7, 7.2, 0.95);
  for (const z of [3.5, -2.7, -4.0]) for (const s of [-1, 1]) mesh(cyl(0.5, 0.5, 0.32, 16), MAT.rubber, g, s * 1.12, 0.5, z, { rz: Math.PI / 2 });
  return g;
}
/* automated pod shuttle: low deck with a lift table; local +z is the direction it drives out of the door */
function makeAGV() {
  const g = new THREE.Group();
  block(g, MAT.yellow, 0, 0, 0.96, 0.2, 1.7, 0.1); block(g, MAT.dark, 0, 0, 1.0, 0.07, 1.74, 0.07);
  for (const z of [-0.62, 0.62]) for (const s of [-1, 1]) mesh(cyl(0.11, 0.11, 0.1, 12), MAT.rubber, g, s * 0.45, 0.11, z, { rz: Math.PI / 2 });
  const table = new THREE.Group(); table.position.y = 0.3; g.add(table);
  block(table, MAT.galv, 0, 0, 0.9, 0.05, 1.5, 0);
  const beacon = mesh(sph(0.06, 8, 6), basicMat({ color: 0xFFB020 }), g, 0.4, 0.34, -0.78, { cast: false });
  mesh(cyl(0.05, 0.05, 0.06, 10), MAT.dark, g, -0.4, 0.33, 0.78);
  // the pod it carries
  const podMat = stdMat({ color: 0xC9CDD2, roughness: 0.55, metalness: 0.1 }), stripeMat = stdMat({ color: 0xE8523F, roughness: 0.6 });
  const pod = new THREE.Group(); pod.position.y = 0.06 - PODY; table.add(pod);
  mesh(AC.pod, podMat, pod); mesh(AC.podStripe, stripeMat, pod, 0, PODY + POD.heightM * 0.8, 0);
  return { g, table, pod, podMat, stripeMat, beacon };
}
/* autonomous fuel bowser running along its lane (drives along x) */
function makeBowser() {
  const g = new THREE.Group();
  block(g, MAT.dark, 0, 0, 3.4, 0.25, 1.5, 0.4);
  const t = mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.3, 20), stdMat({ color: 0xE6E8EA, roughness: 0.4, metalness: 0.3 }), g, -0.3, 1.3, 0, { rz: Math.PI / 2 });
  for (const s of [-1, 1]) { const c = mesh(sph(0.62, 16, 10), t.material, g, -0.3 + s * 1.15, 1.3, 0); c.scale.x = 0.35; }
  block(g, MAT.orange, 0, 0, 3.42, 0.12, 1.52, 0.62); block(g, MAT.yellow, 1.35, 0, 0.6, 0.8, 1.2, 0.65);
  mesh(cyl(0.3, 0.3, 0.16, 14), MAT.red, g, 1.35, 1.55, 0);                                    // hose reel on top, on the centreline
  for (const x of [-1.15, 1.15]) for (const s of [-1, 1]) mesh(cyl(0.36, 0.36, 0.26, 14), MAT.rubber, g, x, 0.36, s * 0.72, { rx: Math.PI / 2 });
  return g;
}
/* chain-link fence along a closed or open path */
function fence(parent, pts, h) {
  const c = cvs(64), g2 = c.getContext('2d'); g2.strokeStyle = 'rgba(190,196,200,0.85)'; g2.lineWidth = 1.2;
  for (let i = -64; i < 128; i += 8) { g2.beginPath(); g2.moveTo(i, 0); g2.lineTo(i + 64, 64); g2.moveTo(i + 64, 0); g2.lineTo(i, 64); g2.stroke(); }
  const posts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 3));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, h), new THREE.MeshStandardMaterial({ map: texOf(c, { repeat: [L / 0.9, h / 0.9] }), transparent: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6, alphaTest: 0.25 }));
    m.position.set((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); parent.add(m);
    for (let k = 0; k <= n; k++) posts.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  const im = new THREE.InstancedMesh(cyl(0.04, 0.04, h + 0.15, 6), MAT.galv, posts.length), M = new THREE.Matrix4();
  posts.forEach((p, i) => { M.makeTranslation(p[0], (h + 0.15) / 2, p[1]); im.setMatrixAt(i, M); }); im.castShadow = true; parent.add(im);
}
/* scrubland outside the compound: neem and acacia in loose groups, thorn scrub, and granite boulder piles */
function scatterNature(parent, rnd, inside, R, nTree, nRock) {
  const NC = 4, nShrub = nTree * 5;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.26, 1, 6), stdMat({ color: 0x4E4034, roughness: 1 }), nTree);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), stdMat({ color: 0xffffff, roughness: 1 }), nTree * NC);
  const shrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), stdMat({ color: 0xffffff, roughness: 1 }), nShrub);
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stdMat({ color: 0x9C958A, roughness: 0.95 }), nRock);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  crown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nTree * NC * 3), 3); shrub.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nShrub * 3), 3);
  const place = (rMin) => { for (let k = 0; k < 60; k++) { const a = rnd() * 6.283, r = (rMin || 50) + Math.pow(rnd(), 0.75) * R, x = Math.cos(a) * r, z = Math.sin(a) * r; if (!inside(x, z)) return [x, z]; } return [R, R]; };
  let gx = 0, gz = 0;
  for (let i = 0; i < nTree; i++) {
    if (i % 5 === 0) [gx, gz] = place();
    let x = gx + (rnd() - 0.5) * 46, z = gz + (rnd() - 0.5) * 46; if (inside(x, z)) [x, z] = place();
    const h = 2.6 + rnd() * 3.4, s = 2.2 + rnd() * 2.6;
    M.compose(V3(x, h / 2, z), q.identity(), V3(1, h, 1)); trunk.setMatrixAt(i, M);
    const hue = 0.23 + rnd() * 0.07, sat = 0.3 + rnd() * 0.16, lum = 0.13 + rnd() * 0.07;
    for (let k = 0; k < NC; k++) {
      e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
      const a = k / NC * 6.283 + rnd(), o = k === 0 ? 0 : s * 0.55;
      M.compose(V3(x + Math.cos(a) * o, h + s * (k === 0 ? 0.55 : 0.2 + rnd() * 0.25), z + Math.sin(a) * o), q, V3(s * (k === 0 ? 1 : 0.72), s * (k === 0 ? 0.7 : 0.5), s * (k === 0 ? 1 : 0.72))); crown.setMatrixAt(i * NC + k, M);
      c.setHSL(hue, sat, lum * (0.85 + rnd() * 0.3)); crown.instanceColor.setXYZ(i * NC + k, c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nShrub; i++) {
    const [x, z] = place(30), s = 0.5 + rnd() * 1.3; e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
    M.compose(V3(x, s * 0.28, z), q, V3(s * 1.2, s * 0.6, s * 1.2)); shrub.setMatrixAt(i, M);
    c.setHSL(0.19 + rnd() * 0.1, 0.25 + rnd() * 0.2, 0.12 + rnd() * 0.1); shrub.instanceColor.setXYZ(i, c.r, c.g, c.b);
  }
  let rx = 0, rz = 0;
  for (let i = 0; i < nRock; i++) {
    if (i % 7 === 0) [rx, rz] = place();
    const s = 0.7 + rnd() * rnd() * 5.5; e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
    M.compose(V3(rx + (rnd() - 0.5) * 11, s * 0.3, rz + (rnd() - 0.5) * 11), q, V3(s, s * 0.78, s * 1.15)); rock.setMatrixAt(i, M);
  }
  for (const o of [trunk, crown, shrub, rock]) { o.castShadow = true; o.receiveShadow = true; parent.add(o); }
}
/* ring of low hills on the horizon; arc limits it to the land side for coastal sites */
function horizonHills(parent, seed, r0, r1, hMax, color, a0, a1) {
  const n = makeNoise(seed), SEG = 120, RINGS = 6, pos = [], idx = [];
  a0 = a0 == null ? 0 : a0; a1 = a1 == null ? Math.PI * 2 : a1;
  for (let i = 0; i <= SEG; i++) for (let j = 0; j <= RINGS; j++) {
    const a = lerp(a0, a1, i / SEG), f = j / RINGS, r = lerp(r0, r1, f), prof = Math.sin(f * Math.PI);
    const h = prof * hMax * (0.25 + 0.9 * n.fbm(i / SEG * 14 + 3, f * 2 + 1, 4)) * (0.5 + 0.8 * n(i / SEG * 5, 7));
    pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
  }
  for (let i = 0; i < SEG; i++) for (let j = 0; j < RINGS; j++) { const a = i * (RINGS + 1) + j, b = a + RINGS + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, stdMat({ color: color || 0x6F7557, roughness: 1, side: THREE.DoubleSide })); parent.add(m); return m;
}
/* touchdown markings for one pad: 16 m canvas, nose toward the top of the canvas */
function padCanvas(id, kind) {
  const c = cvs(512), g = c.getContext('2d'), S = 512 / 16; g.translate(256, 256);
  const m = v => v * S;
  if (kind === 'deck' || kind === 'heli') {
    g.strokeStyle = '#F5F5F2'; g.lineWidth = m(0.35); g.beginPath(); g.arc(0, 0, m(5.2), 0, 7); g.stroke();
    g.strokeStyle = '#E7B416'; g.lineWidth = m(0.22); g.strokeRect(-m(3.5), -m(2.5), m(7), m(5));
  } else {
    g.fillStyle = 'rgba(30,34,40,0.35)'; g.fillRect(-m(5), -m(5), m(10), m(10));                         // 10 x 10 m touchdown and lift-off area
    g.strokeStyle = 'rgba(245,245,242,0.95)'; g.lineWidth = m(0.22); g.strokeRect(-m(5), -m(5), m(10), m(10));
    g.fillStyle = 'rgba(40,44,50,0.42)'; g.fillRect(-m(3.5), -m(2.5), m(7), m(5));
    g.strokeStyle = '#E7B416'; g.lineWidth = m(0.24); g.strokeRect(-m(3.5), -m(2.5), m(7), m(5));
  }
  // nose chevron and pad id
  g.strokeStyle = '#F5F5F2'; g.lineWidth = m(0.2); g.lineJoin = 'miter'; g.beginPath(); g.moveTo(-m(0.9), -m(3.3)); g.lineTo(0, -m(4.2)); g.lineTo(m(0.9), -m(3.3)); g.stroke();
  if (kind !== 'deck' && kind !== 'heli') {
    g.fillStyle = '#F5F5F2'; g.font = '800 ' + m(1.5) + 'px Archivo, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(id, -m(3.6), m(3.9));
    g.font = '600 ' + m(0.62) + 'px "JetBrains Mono", ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(245,245,242,0.85)'; g.fillText('10 × 10', m(3.2), m(4.3));
  }
  return c;
}
/* generic displacement hull, bow toward -z, waterline at y = 0 */
function hullGeo(L, B, deckY, keelY, o) {
  o = o || {}; const NS = 40, K = 9, pos = [], col = [], idx = [], bowLen = o.bow || L * 0.3, sternK = o.stern == null ? 0.82 : o.stern;
  const half = z => { const fwd = (z + L / 2) / bowLen, aft = (L / 2 - z) / (L * 0.16); return B / 2 * Math.min(Math.pow(clamp01(fwd), 0.62), lerp(sternK, 1, clamp01(aft))); };
  const c1 = COL(o.color || 0x848E96), c2 = COL(o.boot || 0x2A2D31);
  for (let i = 0; i <= NS; i++) {
    const z = -L / 2 + L * i / NS, hb = Math.max(0.05, half(z));
    for (let s = -1; s <= 1; s += 2) for (let k = 0; k <= K; k++) {
      const t = k / K, y = lerp(keelY, deckY, t), rake = (i / NS < 0.2) ? (1 - i / NS / 0.2) * (t - 0.4) * (o.rake || 5) : 0;
      const x = s * hb * Math.pow(Math.sin(Math.min(1, t * 1.9) * Math.PI / 2), 0.55) * (1 + 0.04 * t);
      pos.push(x, y, z - rake); const c = y < 0.9 ? c2 : c1; col.push(c.r, c.g, c.b);
    }
  }
  const row = 2 * (K + 1);
  for (let i = 0; i < NS; i++) for (let s = 0; s < 2; s++) for (let k = 0; k < K; k++) {
    const a = i * row + s * (K + 1) + k, b = a + 1, c = a + row, d = c + 1;
    s === 0 ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
  }
  // transom
  const t0 = NS * row; for (let k = 0; k < K; k++) idx.push(t0 + k, t0 + k + 1, t0 + K + 1 + k, t0 + k + 1, t0 + K + 1 + k + 1, t0 + K + 1 + k);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  // deck outline at the sheer
  const sh = new THREE.Shape(); const pts = []; for (let i = 0; i <= NS; i++) { const z = -L / 2 + L * i / NS, rk = (i / NS < 0.2) ? (1 - i / NS / 0.2) * 0.6 * (o.rake || 5) : 0; pts.push([half(z) * 1.04, z - rk]); }
  sh.moveTo(-pts[0][0], pts[0][1]); for (const p of pts) sh.lineTo(p[0], p[1]); for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(-pts[i][0], pts[i][1]);
  const dg = new THREE.ShapeGeometry(sh); dg.rotateX(Math.PI / 2); dg.translate(0, deckY, 0);
  return { hull: g, deck: dg, half };
}

/* ---------- truck dock kit: pallets, forklift, light trucks, the pod with its side door ---------- */
const CARTON = { DRY: 0xB8946A, COLD: 0xE6ECEF, LIQ: 0x3F6FA8, SENS: 0x8E8A84, DEF: 0x5E6B58 };
/* EUR pallet, 1200 x 800 mm, with a strapped load; local x is the 1.2 m side */
function makePallet() {
  const g = new THREE.Group(), wood = stdMat({ color: 0xB89A6A, roughness: 0.9 });
  for (const z of [-0.35, 0, 0.35]) block(g, wood, 0, z, 1.2, 0.1, 0.1, 0);
  for (const x of [-0.52, -0.26, 0, 0.26, 0.52]) block(g, wood, x, 0, 0.15, 0.024, 0.8, 0.1);
  const load = stdMat({ color: 0xB8946A, roughness: 0.55 });
  block(g, load, 0, 0, 1.12, 0.5, 0.72, 0.124);
  const strap = stdMat({ color: 0x1C1F24, roughness: 0.6 }); for (const x of [-0.3, 0.3]) block(g, strap, x, 0, 0.04, 0.505, 0.73, 0.124, { cast: false });
  g.userData.load = load; return g;
}
function palletType(p, type) { p.userData.load.color.copy(COL(CARTON[type] || CARTON.DRY)); }
/* driverless counterbalance forklift; local +z is the fork direction; carriage.position.y is the fork height */
function makeForklift() {
  const g = new THREE.Group(), body = stdMat({ color: 0xE2A21A, roughness: 0.5, metalness: 0.2 });
  block(g, body, 0, -0.1, 1.1, 0.6, 1.5, 0.22); block(g, MAT.dark, 0, -0.78, 1.12, 0.75, 0.42, 0.22);
  for (const [x, z, r] of [[-0.5, 0.45, 0.3], [0.5, 0.45, 0.3], [-0.46, -0.7, 0.22], [0.46, -0.7, 0.22]]) mesh(cyl(r, r, 0.2, 14), MAT.rubber, g, x, r, z, { rz: Math.PI / 2 });
  for (const x of [-0.36, 0.36]) { block(g, MAT.dark, x, 0.78, 0.08, 2.1, 0.1, 0.1); mesh(cyl(0.03, 0.03, 1.5, 6), MAT.galv, g, x, 1.55, -0.6); mesh(cyl(0.03, 0.03, 1.38, 6), MAT.galv, g, x, 1.5, 0.5, { rx: -0.2 }); }
  block(g, MAT.dark, 0, -0.05, 0.95, 0.05, 1.25, 2.26);
  mesh(cyl(0.07, 0.07, 0.07, 10), MAT.dark, g, 0, 2.36, 0.3); const beacon = mesh(sph(0.055, 8, 6), basicMat({ color: 0x4FA8FF }), g, 0, 2.36, -0.4, { cast: false });
  const carriage = new THREE.Group(); carriage.position.set(0, 0.25, 0.86); g.add(carriage);
  block(carriage, MAT.dark, 0, 0, 0.92, 0.5, 0.05, 0); for (const x of [-0.24, 0.24]) block(carriage, MAT.steel, x, 0.62, 0.1, 0.04, 1.2, -0.04);
  const pal = makePallet(); pal.rotation.y = Math.PI / 2; pal.position.set(0, 0, 0.68); pal.visible = false; carriage.add(pal);
  return { g, carriage, pal, beacon };
}
/* open-bed light truck; origin at the centre of the bed, cab toward +z, bed top at 0.99 m */
function makeLightTruck(v) {
  const g = new THREE.Group(), big = v % 3 === 0, L = big ? 3.9 : 3.0, col = [0xE9EAEA, 0xD9A441, 0x3E6A94, 0xE9EAEA, 0xB7463A, 0x4E8A6B][v % 6];
  const cab = stdMat({ color: col, roughness: 0.4, metalness: 0.25 }), bed = stdMat({ color: 0x565B60, roughness: 0.7, metalness: 0.3 });
  block(g, MAT.dark, 0, 0.75, 1.5, 0.28, L + 2.3, 0.5);
  block(g, bed, 0, 0, 1.9, 0.09, L, 0.9); block(g, bed, 0, L / 2 + 0.04, 1.9, 1.0, 0.08, 0.99);
  for (const x of [-0.93, 0.93]) block(g, bed, x, 0, 0.05, 0.1, L, 0.99, { cast: false });
  block(g, cab, 0, L / 2 + 0.98, 1.86, 1.45, 1.7, 0.72); block(g, MAT.glass, 0, L / 2 + 1.84, 1.7, 0.62, 0.05, 1.4, { cast: false });
  for (const x of [-0.94, 0.94]) block(g, MAT.glass, x, L / 2 + 1.15, 0.03, 0.5, 0.8, 1.48, { cast: false });
  for (const z of [L / 2 + 1.1, -L / 2 + 0.75]) for (const x of [-0.86, 0.86]) mesh(cyl(0.42, 0.42, 0.26, 16), MAT.rubber, g, x, 0.42, z, { rz: Math.PI / 2 });
  const pals = [0.72, -0.72].map(z => { const p = makePallet(); p.position.set(0, 0.99, z); g.add(p); return p; });
  return { g, pals };
}
/* the pod at a loading bay: long axis z, pallet door on the -x side, floor at y = 0 */
function makeOpenPod() {
  const g = new THREE.Group(), shell = stdMat({ color: 0xC9CDD2, roughness: 0.55, metalness: 0.1 }), stripe = stdMat({ color: 0xE8523F, roughness: 0.6 });
  const open = new THREE.Group(); g.add(open);
  const W = POD.widthM, Hh = POD.heightM, Ln = POD.lenM, hw = W / 2;
  block(open, shell, 0, 0, W - 0.06, 0.06, Ln - 0.06, 0); block(open, shell, hw - 0.025, 0, 0.05, Hh - 0.06, Ln - 0.06, 0.04);
  for (const z of [-(Ln / 2 - 0.025), Ln / 2 - 0.025]) block(open, shell, 0, z, W, Hh - 0.06, 0.05, 0.04);
  block(open, shell, 0, 0, W, 0.05, Ln, Hh - 0.05); block(open, MAT.dark, -hw + 0.025, 0, 0.05, Hh - 0.08, 0.05, 0.05);
  block(open, stripe, 0, 0, W + 0.015, 0.2, 1.5, Hh * 0.8 - 0.1, { cast: false });
  const door = new THREE.Group(); door.position.set(-hw - 0.01, Hh, 0); open.add(door);
  const leaf = block(door, shell, 0, 0, 0.04, Hh - 0.06, Ln - 0.1, -(Hh - 0.02)); block(door, stripe, -0.022, 0, 0.012, 0.2, 1.5, -Hh * 0.2 - 0.1, { cast: false });
  const pals = [-0.45, 0.45].map(z => { const p = makePallet(); p.rotation.y = 0; p.position.set(0, 0.06, z); open.add(p); return p; });
  // closed, it is the same faired pod the aircraft carries
  const closed = new THREE.Group(); closed.position.y = -PODY; g.add(closed);
  mesh(AC.pod, shell, closed); mesh(AC.podStripe, stripe, closed, 0, PODY + POD.heightM * 0.8, 0);
  return { g, open, closed, door, pals, shell, stripe };
}
/* roller conveyor stub: length along local x, top at 0.5 m */
function conveyorStub(parent, x, z, len, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; parent.add(g);
  block(g, MAT.galv, 0, -0.95, len, 0.12, 0.1, 0.36); block(g, MAT.galv, 0, 0.95, len, 0.12, 0.1, 0.36);
  for (let k = -len / 2 + 0.3; k <= len / 2 - 0.2; k += 0.9) for (const s of [-0.95, 0.95]) block(g, MAT.dark, k, s, 0.08, 0.36, 0.08, 0);
  const n = Math.floor(len / 0.22), im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.86, 8), MAT.steel, n), M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i < n; i++) { M.compose(V3(-len / 2 + 0.11 + i * 0.22, 0.455, 0), q, V3(1, 1, 1)); im.setMatrixAt(i, M); } im.castShadow = true; g.add(im);
  return g;
}
