// Capture the enemy lineup (dev gallery) for model before/after comparisons.
// Usage: node tests/e2e/capture-enemies.mjs <out-dir> [suffix]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4183;
const OUT = process.argv[2] ?? 'docs/enemies';
const SUF = process.argv[3] ? `-${process.argv[3]}` : '';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [
  ['group1', '?cols=4&kinds=slime,mini,splitter,queen,runner,wisp,knight,boar', 1600, 1000],
  ['group2', '?cols=4&kinds=ghost,crab,mole,salamander,bat,wyvern,phoenix,imp', 1600, 1000],
  ['group3', '?cols=3&gap=3.3&kinds=shaman,yeti,ram,golem,boss,frostGiant', 1600, 1000],
];
try {
  await wait(3500);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, q, w, h] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`http://localhost:${PORT}/enemy-gallery.html${q}`);
    await page.waitForFunction(() => window.__galleryReady, null, { timeout: 60000 });
    await wait(2500);
    await page.screenshot({ path: `${OUT}/${name}${SUF}.png`, timeout: 120000 });
    console.log('saved', name);
    await page.close();
  }
  await browser.close();
} finally {
  process.kill(-server.pid);
}
