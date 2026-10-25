// Usage: node test/seq.js steps.json [W H]  — steps: [{eval:"js", wait:ms, shot:"name.png", clip:[x,y,w,h]}]
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const W = +process.argv[3] || 1600, H = +process.argv[4] || 900, dpr = +process.argv[5] || 1;
  const out = process.env.SHOTS || '.';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: W < 600, isMobile: W < 600 });
  const three = fs.readFileSync(process.env.THREE_MIN);
  await page.route('**/*', route => { const u = route.request().url(); if (u.includes('three.min.js')) return route.fulfill({ body: three, contentType: 'application/javascript' }); if (u.startsWith('file:')) return route.continue(); return route.abort(); });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 700)));
  await page.goto('file://' + path.resolve(__dirname, '../dist/local.html') + (process.env.HASH ? '#' + process.env.HASH : ''));
  await page.waitForFunction('window.__twinReady === true', null, { timeout: 120000 }).catch(() => errs.push('READY TIMEOUT'));
  for (const s of steps) {
    if (s.eval) { const r = await page.evaluate(s.eval).catch(x => 'EVAL ERR ' + String(x).slice(0, 400)); if (r !== undefined && r !== null) console.log('eval>', typeof r === 'string' ? r : JSON.stringify(r)); }
    if (s.click) await page.mouse.click(s.click[0], s.click[1]);
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.shot) { await page.screenshot({ path: path.join(out, s.shot), timeout: 240000, clip: s.clip ? { x: s.clip[0], y: s.clip[1], width: s.clip[2], height: s.clip[3] } : undefined }); console.log('shot', s.shot); }
  }
  const u = [...new Set(errs)].filter(e => !e.includes('ERR_FAILED')); console.log(u.length ? 'ERRORS:\n' + u.slice(0, 10).join('\n') : 'no page errors');
  await browser.close();
})();
