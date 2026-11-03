// Mobile e2e: phone viewport with touch emulation (portrait + landscape).
// Drives tap-to-preview / tap-to-confirm building, one-finger pan, pinch zoom, and checks the
// HUD fits the screen. Usage: npm run build && npm run e2e:mobile
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4181;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => { console.error('✕', m); failed = true; };

async function touchPath(cdp, pointsA, pointsB = null) {
  const tp = (p, id) => ({ x: p[0], y: p[1], id, radiusX: 4, radiusY: 4, force: 1 });
  const at = (i) => [tp(pointsA[i], 1), ...(pointsB ? [tp(pointsB[i], 2)] : [])];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i < pointsA.length; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) });
    await wait(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const lerpPath = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

async function run(browser, name, device) {
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const vp = page.viewportSize();

  await page.goto(`http://localhost:${PORT}/`);
  // Title screen: every button must be on screen and hit-testable without scrolling. Tap by raw
  // coordinates (not locator.tap, which auto-scrolls and hid a regression where the level cards
  // pushed 開始遊戲 below the fold on phones).
  await wait(700); // let the title pop-in animation settle
  const titleBtns = await page.evaluate(() => [...document.querySelectorAll('.title-buttons .btn, .level-card')].map((b) => {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight && b.contains(document.elementFromPoint(cx, cy));
    return { text: b.textContent.trim().slice(0, 8), hit, bottom: r.bottom, x: cx, y: cy };
  }));
  const unreachable = titleBtns.filter((b) => !b.hit || b.bottom > vp.height);
  if (unreachable.length) fail(`${name}: title buttons off-screen or covered: ${unreachable.map((b) => b.text).join(', ')}`);
  const startBtn = titleBtns.find((b) => b.text.startsWith('開始遊戲'));
  if (!startBtn) throw new Error(`${name}: no start button`);
  await page.touchscreen.tap(startBtn.x, startBtn.y);
  await page.waitForFunction(() => !!window.__sky, null, { timeout: 15000 });
  await page.tap('canvas', { position: { x: vp.width / 2, y: vp.height / 2 } }); // skip intro
  await wait(800);

  const info = await page.evaluate(() => ({ touchUi: window.__sky.useUi.getState().touchUi, quality: window.__sky.useUi.getState().qualityLabel }));
  if (!info.touchUi) fail(`${name}: touch UI not detected`);
  console.log(name, 'quality', info.quality);

  // every visible toolbar button is fully on screen, big enough to hit, and its label fits
  const checkLayout = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const shown = [...document.querySelectorAll('.tool-btn, .dock-tab')].filter((b) => b.getClientRects().length);
    const btns = shown.map((b) => b.getBoundingClientRect());
    const clipped = [...document.querySelectorAll('.tool-label, .dock-tab')].filter((e) => e.getClientRects().length && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((e) => e.textContent.trim());
    const towers = [...document.querySelectorAll('.toolbar-group.towers .tool-btn')].filter((b) => b.getClientRects().length).length;
    const off = btns.filter((r) => r.left < 0 || r.right > vw || r.bottom > vh || r.top < 0).length;
    const small = btns.filter((r) => r.width < 30 || r.height < 30).length;
    const panels = ['.hud-topleft', '.hud-gold', '.hud-cam', '.start-wave', '.hud-toolbar'].map((s) => document.querySelector(s)?.getBoundingClientRect());
    const overlaps = [];
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], b = panels[j];
      if (a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${i}-${j}`);
    }
    return { towers, clipped, off, small, overlaps, scrollW: document.documentElement.scrollWidth, vw };
  });
  const assertLayout = (layout, label) => {
    if (layout.towers !== 5) fail(`${label}: expected 5 tower buttons, got ${layout.towers}`);
    if (layout.off) fail(`${label}: ${layout.off} tool buttons off-screen`);
    if (layout.small) fail(`${label}: ${layout.small} tool buttons smaller than 30px`);
    if (layout.clipped.length) fail(`${label}: clipped labels ${layout.clipped.join(', ')}`);
    if (layout.overlaps.length) fail(`${label}: HUD panels overlap ${layout.overlaps.join(',')}`);
    if (layout.scrollW > layout.vw) fail(`${label}: horizontal overflow`);
  };
  assertLayout(await checkLayout(), name);
  // the 地形 tab swaps in the terrain tools, then back to towers
  await page.locator('.dock-tab', { hasText: '地形' }).tap();
  await wait(150);
  const terrain = await page.evaluate(() => [...document.querySelectorAll('.toolbar-group.terrain .tool-btn')].filter((b) => b.getClientRects().length).length);
  if (terrain !== 4) fail(`${name}: terrain tab shows ${terrain} tools`); // raise, lower, wall, trap (L1-01 has no breakable bridge)
  await page.locator('.dock-tab', { hasText: '防禦塔' }).tap();
  await wait(150);

  // centre the camera on a known buildable cell and tap twice to build
  const cell = 'c14_13';
  await page.evaluate((id) => { const s = window.__sky.scene; s.rig.target.copy(s.cellWorld(id)); s.rig.target.y = 0; }, cell);
  await wait(1000);
  const pt = await page.evaluate((id) => { const s = window.__sky.scene; return s.worldToScreen(s.cellWorld(id)); }, cell);
  await page.locator('.tool-btn', { hasText: '木製箭塔' }).tap();
  await page.touchscreen.tap(pt.x, pt.y);
  await wait(200);
  const afterFirst = await page.evaluate(() => ({ towers: window.__sky.controller.state.towers.length, preview: window.__sky.useUi.getState().preview?.ok ?? null, chip: !!document.querySelector('.chip-confirm') }));
  if (afterFirst.towers !== 0) fail(`${name}: first tap built immediately`);
  if (!afterFirst.preview) fail(`${name}: first tap did not show a valid preview`);
  if (!afterFirst.chip) fail(`${name}: confirm hint not shown`);
  await page.screenshot({ path: `tests/e2e/mobile-${name}-preview.png` });
  await page.touchscreen.tap(pt.x + 5, pt.y + 4); // a slightly-off confirm tap still lands on the previewed cell
  await wait(300);
  const built = await page.evaluate(() => ({ towers: window.__sky.controller.state.towers.length, sel: window.__sky.useUi.getState().selection?.type ?? null }));
  if (built.towers !== 1) fail(`${name}: second tap did not build (towers=${built.towers})`);
  if (built.sel !== 'tower') fail(`${name}: new tower not selected`);
  await page.screenshot({ path: `tests/e2e/mobile-${name}-built.png` });
  if (!(await page.locator('.selection-panel .btn', { hasText: '升級' }).isVisible())) fail(`${name}: upgrade button not visible`);

  // one-finger drag pans
  const camBefore = await page.evaluate(() => window.__sky.scene.rig.target.toArray());
  await touchPath(cdp, lerpPath([vp.width * 0.5, vp.height * 0.45], [vp.width * 0.3, vp.height * 0.35]));
  await wait(200);
  const camAfter = await page.evaluate(() => window.__sky.scene.rig.target.toArray());
  const panned = Math.hypot(camAfter[0] - camBefore[0], camAfter[2] - camBefore[2]);
  if (panned < 0.5) fail(`${name}: one-finger drag did not pan (${panned.toFixed(2)}) at ${await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const r = document.querySelector('.selection-panel')?.getBoundingClientRect(); return e.className + ' sheet ' + JSON.stringify(r); }, [vp.width * 0.5, vp.height * 0.45])}`);
  if ((await page.evaluate(() => window.__sky.controller.state.towers.length)) !== 1) fail(`${name}: drag changed the board`);

  // pinch out zooms in (deselect first so the tower sheet doesn't sit under a finger on small phones)
  await page.evaluate(() => window.__sky.useUi.getState().set({ selection: null }));
  await wait(100);
  const topBefore = await page.evaluate(() => window.__sky.scene.rig.camera.top);
  const cx = vp.width / 2, cy = vp.height * 0.45;
  await touchPath(cdp, lerpPath([cx - 30, cy], [cx - 110, cy]), lerpPath([cx + 30, cy], [cx + 110, cy]));
  await wait(600);
  const topAfter = await page.evaluate(() => window.__sky.scene.rig.camera.top);
  if (!(topAfter < topBefore * 0.95)) fail(`${name}: pinch did not zoom (${topBefore.toFixed(2)} → ${topAfter.toFixed(2)})`);

  // rotate the phone with the view pinched all the way in: the view must come back within the
  // zoom range, the HUD must fit the new orientation and one-finger panning must still work
  {
    await page.evaluate(() => window.__sky.scene.rig.zoomBy(-1e6));
    await wait(500);
    const rotated = { width: vp.height, height: vp.width };
    await page.setViewportSize(rotated);
    await wait(900);
    const z = await page.evaluate(() => { const r = window.__sky.scene.rig; return { top: r.camera.top, max: r.maxZoom, half: r.halfHeightBase }; });
    if (z.top < z.half / z.max - 0.01) fail(`${name}: rotated view zoomed past the limit (${z.top.toFixed(2)})`);
    assertLayout(await checkLayout(), `${name} rotated`);
    const b0 = await page.evaluate(() => window.__sky.scene.rig.target.toArray());
    await touchPath(cdp, lerpPath([rotated.width * 0.5, rotated.height * 0.45], [rotated.width * 0.35, rotated.height * 0.35]));
    await wait(200);
    const b1 = await page.evaluate(() => window.__sky.scene.rig.target.toArray());
    if (Math.hypot(b1[0] - b0[0], b1[2] - b0[2]) < 0.2) fail(`${name} rotated: one-finger drag did not pan`);
    await page.screenshot({ path: `tests/e2e/mobile-${name}-rotated.png` });
    await page.setViewportSize(vp);
    await wait(700);
    await page.evaluate(() => window.__sky.scene.rig.zoomStep(-1));
  }

  // play a wave and check the result panel fits and is tappable
  await page.locator('.btn.start').tap();
  await wait(800);
  await page.evaluate(() => { const c = window.__sky.controller; for (let i = 0; i < 400 && c.state.phase === 'COMBAT'; i++) c.update(0.25); });
  await wait(900);
  const phase = await page.evaluate(() => window.__sky.controller.state.phase);
  if (phase === 'WAVE_RESULT') {
    const m = await page.evaluate(() => { const r = document.querySelector('.modal')?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    if (!m || m.top < 0 || m.left < 0 || m.right > vp.width || m.bottom > vp.height) fail(`${name}: result modal off-screen ${JSON.stringify(m)}`);
    await page.screenshot({ path: `tests/e2e/mobile-${name}-result.png` });
    await page.locator('.modal .btn.primary').tap();
    await wait(400);
    if ((await page.evaluate(() => window.__sky.controller.state.phase)) !== 'PREPARE') fail(`${name}: continue tap did not advance`);
  } else if (phase === 'DEFEAT') {
    // the defeat panel must fit too; it covers the HUD, so the menu check below is skipped
    const m = await page.evaluate(() => { const r = document.querySelector('.modal')?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    if (!m || m.top < 0 || m.left < 0 || m.right > vp.width || m.bottom > vp.height) fail(`${name}: defeat modal off-screen ${JSON.stringify(m)}`);
    await page.screenshot({ path: `tests/e2e/mobile-${name}-result.png` });
    if (errors.length) fail(`${name}: page errors:\n` + errors.join('\n'));
    await ctx.close();
    return;
  } else fail(`${name}: wave did not resolve (${phase})`);

  // menu → settings opens and closes on touch
  await page.locator('.hud-cam .icon-btn[aria-label="選單"]').tap();
  await page.getByRole('button', { name: '設定' }).tap();
  await wait(300);
  const s = await page.evaluate(() => { const r = document.querySelector('.modal.settings')?.getBoundingClientRect(); return r && { top: r.top, bottom: r.bottom }; });
  if (!s || s.top < 0 || s.bottom > vp.height) fail(`${name}: settings modal off-screen ${JSON.stringify(s)}`);
  await page.screenshot({ path: `tests/e2e/mobile-${name}-settings.png` });

  if (errors.length) fail(`${name}: page errors:\n` + errors.join('\n'));
  await ctx.close();
}

try {
  await wait(2500);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await run(browser, 'portrait', devices['iPhone 13']);
  await run(browser, 'landscape', devices['iPhone 13 landscape']);
  await run(browser, 'landscape-small', devices['iPhone SE landscape']);
  await run(browser, 'android', devices['Pixel 7']);
  await browser.close();
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  server.kill();
}
console.log(failed ? 'MOBILE E2E FAILED' : '✓ Mobile E2E passed');
process.exit(failed ? 1 : 0);
