// Usage: node test/shot.js out.png [width height] [--eval "js"] [--wait ms] [--hash tag]
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const args = process.argv.slice(2); const out = args[0];
  const num = args.filter(a => /^\d+$/.test(a)).map(Number); const W = num[0] || 1600, H = num[1] || 900;
  const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const evals = []; args.forEach((a, i) => { if (a === '--eval') evals.push(args[i + 1]); });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(opt('dpr') || 1) });
  const three = fs.readFileSync(process.env.THREE_MIN);
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('three.min.js')) return route.fulfill({ body: three, contentType: 'application/javascript' });
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  const errs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 600)));
  await page.goto('file://' + path.resolve(__dirname, '../dist/local.html') + (opt('hash') ? '#' + opt('hash') : ''));
  await page.waitForFunction('window.__twinReady === true', null, { timeout: 90000 }).catch(e => errs.push('READY TIMEOUT'));
  for (const e of evals) { const r = await page.evaluate(e).catch(x => 'EVAL ERR ' + x); if (r !== undefined && r !== null) console.log('eval>', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+(opt('settle') || 600)); }
  await page.waitForTimeout(+(opt('wait') || 1500));
  await page.screenshot({ path: out, timeout: 180000 });
  const fps = await page.evaluate('window.__fps || null').catch(() => null);
  console.log('shot', out, W + 'x' + H, 'fps', fps, errs.length ? '\n' + [...new Set(errs)].slice(0, 12).join('\n') : 'no console errors');
  await browser.close();
})();
