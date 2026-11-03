// In-game shot of a wave made of every enemy kind (before/after model comparisons).
// Usage: npm run build && node tests/e2e/capture-enemies-combat.mjs <out.png> [level] [width] [height]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4187;
const [OUT = 'enemies-combat.png', LEVEL = 'L1-01', W = '1600', H = '900'] = process.argv.slice(2);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hideHud = '.hud, .hud *, [class*="hud"], [class*="toolbar"], [class*="dock"], .toast, .tutorial { visibility: hidden !important; }';
try {
  await wait(2500);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/?level=${LEVEL}&nointro&quality=high`);
  await page.waitForFunction(() => !!window.__sky?.scene, null, { timeout: 30000 });
  await wait(1500);
  await page.evaluate(() => {
    const c = window.__sky.controller;
    const kinds = ['slime', 'runner', 'knight', 'boar', 'ghost', 'crab', 'mole', 'salamander', 'bat', 'yeti', 'shaman', 'imp', 'phoenix', 'wyvern', 'ram', 'wisp', 'splitter', 'golem', 'queen', 'frostGiant', 'boss'];
    const first = c.level.waves[0].entries[0];
    c.level.waves[0].entries = kinds.map((k, i) => ({ enemyKind: k, count: 1, portalIds: first.portalIds, intervalTicks: 1, delayTicks: i * 2 }));
  });
  await page.getByText('開始波次').click();
  await wait(600);
  await page.evaluate(() => { const c = window.__sky.controller; for (let i = 0; i < 400 && c.state.phase === 'COMBAT' && !c.state.enemies.some((e) => e.kind === 'boss'); i++) c.update(0.05); for (let i = 0; i < 10; i++) c.update(0.05); });
  await page.evaluate(() => {
    const { controller: c, scene } = window.__sky;
    const es = c.state.enemies;
    const r = scene.rig;
    const p = r.target.clone().set(0, 0, 0), q = p.clone();
    const tail = es.slice(-8); // the freshly spawned, tightly packed end of the column
    for (const e of tail) { scene.enemyWorld(e, q); p.add(q); }
    p.multiplyScalar(1 / tail.length);
    r.zoomIndex = r.zoomLevels.length - 1; r.snapZoom();
    r.target.copy(p);
  }).catch((e) => console.error('focus', e.message));
  await wait(1800);
  const style = await page.addStyleTag({ content: hideHud });
  await page.screenshot({ path: OUT, timeout: 120000 });
  await style.evaluate((n) => n.remove());
  console.log('enemies', await page.evaluate(() => window.__sky.controller.state.enemies.map((e) => e.kind).join(',')));
  await browser.close();
} finally {
  process.kill(-server.pid);
}
