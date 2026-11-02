// Capture a clean overview + a mid-wave combat shot of every level into docs/levels/.
// Usage: npm run build && node tests/e2e/capture-levels.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4181;
const OUT = 'docs/levels';
const LEVELS = process.argv.slice(2).length ? process.argv.slice(2) : ['L1-01', 'L1-02', 'L1-03', 'L1-04'];
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hideHud = '.hud, .hud *, [class*="hud"], [class*="toolbar"], [class*="dock"], .toast, .tutorial { visibility: hidden !important; }';

try {
  await wait(2500);
  for (const id of LEVELS) {
    // fresh browser per level: SwiftShader stalls screenshots once a second WebGL page is open
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`http://localhost:${PORT}/?level=${id}&nointro`);
    await page.waitForFunction(() => !!window.__sky?.scene, null, { timeout: 20000 });
    await wait(1500);

    // 1) overview: whole island, no HUD
    await page.evaluate(() => { const r = window.__sky.scene.rig; r.zoomIndex = 1; r.snapZoom(); });
    await wait(1800);
    const style = await page.addStyleTag({ content: hideHud });
    await page.screenshot({ path: `${OUT}/${id}-overview.jpg`, quality: 88, type: 'jpeg', timeout: 120000 });
    await style.evaluate((n) => n.remove());

    // 2) combat: towers along the routes, then fast-forward into the wave
    const built = await page.evaluate(() => {
      const { controller: c, scene } = window.__sky;
      c.state.gold = 3000;
      const route = new Set(Object.values(c.routes()).flat());
      const xy = (cid) => cid.slice(1).split('_').map(Number);
      const near = scene.level.cells.map((cl) => cl.id).filter((cid) => !route.has(cid)).map((cid) => {
        const [x, z] = xy(cid); let d = 99;
        for (const r of route) { const [rx, rz] = xy(r); d = Math.min(d, Math.max(Math.abs(rx - x), Math.abs(rz - z))); }
        return { cid, d };
      }).filter((o) => o.d === 1 || o.d === 2).sort((a, b) => a.d - b.d);
      const kinds = ['arrow', 'frost', 'cannon', 'lightning', 'wind'];
      let n = 0;
      for (let i = 0; i < near.length && n < 9; i += 3) {
        if (c.dispatch({ type: 'BUILD_TOWER', kind: kinds[n % kinds.length], anchorCellId: near[i].cid }).ok) n++;
      }
      return n;
    });
    await page.getByText('開始波次').click();
    await wait(600);
    await page.evaluate(() => { const c = window.__sky.controller; for (let i = 0; i < 240 && c.state.phase === 'COMBAT' && c.state.enemies.length < 18; i++) c.update(0.25); });
    await page.evaluate(() => { const r = window.__sky.scene.rig; r.zoomIndex = 2; r.snapZoom(); });
    await wait(1800);
    await page.screenshot({ path: `${OUT}/${id}-combat.jpg`, quality: 88, type: 'jpeg', timeout: 120000 });
    const info = await page.evaluate(() => ({ phase: window.__sky.controller.state.phase, enemies: window.__sky.controller.state.enemies.length }));
    console.log(id, 'towers', built, JSON.stringify(info));
    await browser.close();
  }
} finally {
  process.kill(-server.pid);
}
