// Real pointer and keyboard interaction on the built page.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const three = fs.readFileSync(process.env.THREE_MIN);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('three.min.js')) return r.fulfill({ body: three, contentType: 'application/javascript' }); if (u.startsWith('file:')) return r.continue(); return r.abort(); });
  const errs = []; page.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 500)));
  await page.goto('file://' + path.resolve(__dirname, '../dist/local.html'));
  await page.waitForFunction('window.__twinReady === true', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const ev = s => page.evaluate(s);
  const log = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
  const shot = n => page.screenshot({ path: path.join(process.env.SHOTS, n), timeout: 240000 });
  await ev('__app.setSpeed(0)');                                         // pause so targets hold still
  // 1. click an aircraft on the map
  const pt = await ev(`(function(){ const a=__app.sim.aircraft.find(a=>a.scn==='MM'&&a.phase==='CRUISE'&&a.route==='C-33'); const i=__app.sim.aircraft.indexOf(a); const v=__app.map.acPos[i].clone().project(__app.map.cam); return {cs:a.cs,x:(v.x*.5+.5)*__app.map.W,y:(-v.y*.5+.5)*__app.map.H}; })()`);
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(700);
  log('click aircraft ' + pt.cs, await ev('JSON.stringify(__app.sel) + " h2=" + document.querySelector("#dh h2").textContent'));
  // 2. Escape clears
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); log('escape clears selection', await ev('String(__app.sel)'));
  // 3. scenario tab
  await page.click('#tabs button[data-scn="OF"]'); await page.waitForTimeout(2500); log('scenario tab', await ev('__app.scn + " | " + document.querySelector("#dh h2").textContent + " | kpi " + document.querySelector("#kpi .k b").textContent'));
  await shot('i_offshore.png');
  // 4. table row click selects a corridor
  await page.click('#tt button[data-t="CORRIDORS"]'); await page.waitForTimeout(400); await page.click('#tw tr[data-k="route|O-11"]'); await page.waitForTimeout(1800);
  log('corridor row', await ev('JSON.stringify(__app.sel) + " h2=" + document.querySelector("#dh h2").textContent'));
  await shot('i_corridor.png');
  // 5. site chip then OPEN SITE button, with panel re-rendering live
  await ev('__app.setSpeed(120)'); await page.click('#areas button[data-site="MHN"]'); await page.waitForTimeout(900);
  await page.click('#db button[data-act="enter"]'); await page.waitForTimeout(3500);
  log('enter site via button', await ev('__app.view + " " + __app.siteId + " speed " + __app.speed'));
  // 6. area chip, wheel zoom, drag orbit, drag pan
  await page.click('#areas button[data-area="0"]'); await page.waitForTimeout(1200);
  const d0 = await ev('__app.site.rig.gdist'); await page.mouse.move(600, 420); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); log('wheel zoom', [d0, await ev('__app.site.rig.gdist')].map(v => +v.toFixed(1)));
  const a0 = await ev('__app.site.rig.gaz'); await page.mouse.move(600, 420); await page.mouse.down({ button: 'right' }); await page.mouse.move(700, 430, { steps: 4 }); await page.mouse.up({ button: 'right' }); log('right-drag orbit az', [a0, await ev('__app.site.rig.gaz')].map(v => +v.toFixed(1)));
  const t0 = await ev('__app.site.rig.gt.x'); await page.mouse.move(600, 420); await page.mouse.down(); await page.mouse.move(520, 440, { steps: 4 }); await page.mouse.up(); log('drag pan target x', [t0, await ev('__app.site.rig.gt.x')].map(v => +v.toFixed(1)));
  // 7. light and weather buttons
  await page.click('#light button[data-v="NIGHT"]'); await page.click('#wx button[data-v="RAIN"]'); await page.waitForTimeout(1500); log('light / weather', await ev('__app.light + " " + __app.wx + " sim.wx=" + __app.sim.wx'));
  await shot('i_plat_night_rain.png');
  // 8. back to network with Escape, search box
  await page.click('#light button[data-v="AUTO"]'); await page.click('#wx button[data-v="CLEAR"]'); await page.keyboard.press('Escape'); await page.waitForTimeout(1500); log('escape leaves site', await ev('__app.view'));
  await page.fill('#q', 'karwar'); await page.waitForTimeout(300); log('search results', await ev('document.querySelectorAll("#qres button").length + " first=" + document.querySelector("#qres button").textContent'));
  await page.keyboard.press('Enter'); await page.waitForTimeout(4000); await ev('__app.setSpeed(0)'); log('search enter', await ev('JSON.stringify(__app.sel) + " scn=" + __app.scn'));
  // 9. double-click a site on the map
  const sp = await ev(`(function(){ const v=__app.map.siteObj.KWR.g.position.clone().project(__app.map.cam); return {x:(v.x*.5+.5)*__app.map.W,y:(-v.y*.5+.5)*__app.map.H}; })()`);
  await page.mouse.click(sp.x, sp.y); await page.waitForTimeout(120); await page.mouse.click(sp.x, sp.y); await page.waitForTimeout(4500); log('double-click site', await ev('__app.view + " " + __app.siteId'));
  await shot('i_karwar.png');
  // 10. feed drawer and live API
  await page.click('#feedBtn'); await page.waitForTimeout(600); log('feed drawer', await ev('!document.getElementById("feed").hidden + " json=" + document.getElementById("feedJson").textContent.slice(0, 60)'));
  await shot('i_feed.png');
  log('VectorTwin.ingest', await ev('(function(){ const cs=__app.sim.aircraft[5].cs; VectorTwin.ingest({aircraft:[{cs, lat:18.1, lon:79.2, alt_ft_agl:2200, gs_kmh:250, hdg_deg:90}]}); const a=__app.sim.byCs[cs]; return cs+" ext="+a.ext+" lat="+a.lat; })()'));
  log('page overflow', await ev('document.documentElement.scrollWidth + " vs " + document.documentElement.clientWidth'));
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await browser.close();
})();
