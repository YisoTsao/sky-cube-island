// Smoke e2e: build, serve with vite preview, drive the game in Chromium, fail on any page error.
// Usage: npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (m) => { console.error('✕', m); failed = true; };

try {
  await wait(2500);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const badAudio = [];
  page.on('response', (res) => { if (res.url().includes('/audio/') && !res.ok()) badAudio.push(`${res.status()} ${res.url()}`); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('開始遊戲').click();
  await page.waitForFunction(() => !!window.__sky, null, { timeout: 15000 });
  await page.keyboard.press('Escape'); // skip intro
  await wait(800);

  const r = await page.evaluate(() => {
    const { controller } = window.__sky;
    return [
      controller.dispatch({ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: 'c14_13' }).ok,
      controller.dispatch({ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: 'c16_12' }).ok,
    ];
  });
  if (!r.every(Boolean)) fail('build commands rejected');
  await page.keyboard.press('Control+z');
  const towers = await page.evaluate(() => window.__sky.controller.state.towers.length);
  if (towers !== 1) fail(`undo expected 1 tower, got ${towers}`);

  // photo mode (GDD §11.4 T1): hides the HUD, frees the camera, restores everything on exit
  await page.keyboard.press('p');
  await wait(300);
  const photo = await page.evaluate(() => ({ on: !!window.__sky.useUi.getState().photo, panel: !!document.querySelector('.photo-dock'), toolbar: !!document.querySelector('.hud-toolbar'), shot: window.__sky.scene.capture().length }));
  if (!photo.on || !photo.panel || photo.toolbar) fail(`photo mode did not open cleanly: ${JSON.stringify(photo)}`);
  if (photo.shot < 10000) fail('photo capture returned an empty image');
  await page.keyboard.press('Escape');
  await wait(300);
  const photoOff = await page.evaluate(() => ({ on: !!window.__sky.useUi.getState().photo, toolbar: !!document.querySelector('.hud-toolbar') }));
  if (photoOff.on || !photoOff.toolbar) fail(`photo mode did not close: ${JSON.stringify(photoOff)}`);

  // recorded CC0 music + SFX load after the first click and replace the synth fallback
  await page.waitForFunction(() => window.__sky.audio.usingRecordedMusic, null, { timeout: 20000 })
    .catch(() => fail('recorded music did not load'));
  if (badAudio.length) fail('audio requests failed:\n' + badAudio.join('\n'));
  await page.getByText('開始波次').click();
  await wait(1500);
  const phase = await page.evaluate(() => window.__sky.controller.state.phase);
  if (phase !== 'COMBAT') fail(`expected COMBAT, got ${phase}`);
  // fast-forward the simulation headlessly
  await page.evaluate(() => { const c = window.__sky.controller; for (let i = 0; i < 1600 && c.state.phase === 'COMBAT'; i++) c.update(0.25); });
  await wait(800);
  const after = await page.evaluate(() => window.__sky.controller.state.phase);
  if (!['WAVE_RESULT', 'DEFEAT'].includes(after)) fail(`wave did not resolve: ${after}`);
  const ui = await page.evaluate(() => { const u = window.__sky.useUi.getState(); return { phase: u.phase, stats: !!u.lastWaveStats, intro: u.introPlaying, pause: u.pauseOpen, modal: !!document.querySelector('.modal') }; });
  console.log('ui', JSON.stringify(ui));
  if (after === 'WAVE_RESULT' && !ui.modal) fail('wave result panel not shown');
  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  await page.screenshot({ path: 'tests/e2e/last-run.png' });
  await browser.close();
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  server.kill();
}
console.log(failed ? 'E2E FAILED' : '✓ E2E passed');
process.exit(failed ? 1 : 0);
