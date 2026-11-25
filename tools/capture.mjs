// Screenshots of the instrument in GPU headless Chrome, so you can look at it without a webcam.
//   npm run capture              title, then a bot recital: strings appear, get plucked, get retuned
//   npm run capture -- mobile    the same at phone size (390x844, touch)
// Needs the dev server running (npm run dev). URL=http://localhost:5173/ by default.
// Look at every image in captures/: a test passing does not mean the game looks right.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'captures');
mkdirSync(out, { recursive: true });
const BASE = process.env.URL || 'http://localhost:5173/';
const mobile = process.argv[2] === 'mobile';
const tag = mobile ? 'm-' : '';

const gpu = process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : ['--use-gl=angle'];
const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath,  args: [...gpu, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: join(out, `${tag}${name}.png`) }); console.log('saved', `captures/${tag}${name}.png`); };
const game = () => page.evaluate(() => window.__game);

await page.goto(BASE + '?mute=1');
await page.waitForTimeout(1500);
await shot('title');

// a bot recital: stretch strings, pluck, retune
await page.goto(BASE + '?bot=1&mute=1');
await page.waitForFunction(() => window.__game?.phase === 'play', null, { timeout: 10000 });
await page.waitForFunction(() => window.__game?.stringCount >= 2, null, { timeout: 20000 });
await page.waitForTimeout(400);
await shot('strings');
const withStrings = await game();

await page.waitForFunction(() => window.__game?.plucks >= 1, null, { timeout: 15000 });
await page.waitForTimeout(300);
await shot('pluck');
const afterPluck = await game();

// wait for a retune (the long string is shortened by grabbing its right end)
await page.waitForFunction(() => {
  const g = window.__game;
  if (!g?.strings?.length) return false;
  const longest0 = Math.max(...g.strings.map((s) => s.lengthCm));
  return longest0 < 45; // after shortening, the original ~49 cm string should be shorter
}, null, { timeout: 15000 }).then(() => true, () => false);
await page.waitForTimeout(300);
await shot('retune');
const afterTune = await game();

// pointer fallback: drag out a string and swipe to pluck, on a fresh page
await page.goto(BASE + '?autostart=1&mute=1');
await page.waitForFunction(() => window.__game?.phase === 'play' && window.__game?.mode === 'pointer', null, { timeout: 10000 });
const vw = mobile ? 390 : 1440, vh = mobile ? 844 : 900;
await page.mouse.move(vw * 0.18, vh * 0.4);
await page.mouse.down();
await page.mouse.move(vw * 0.82, vh * 0.42, { steps: 40 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForFunction(() => window.__game.stringCount >= 1, null, { timeout: 5000 });
await page.waitForTimeout(400);
const pointerCreated = await page.evaluate(() => window.__game.stringCount);
const beforePluck = await page.evaluate(() => window.__game.plucks);
await page.mouse.move(vw * 0.5, vh * 0.2, { steps: 10 });
await page.waitForTimeout(200);
await page.mouse.move(vw * 0.5, vh * 0.7, { steps: 30 });
await page.waitForFunction((n) => window.__game.plucks > n, beforePluck, { timeout: 5000 }).then(() => true, () => false);
await page.waitForTimeout(250);
await shot('pointer');
const pointer = await game();

// hook: construct + pluck without any gesture, and confirm audio hook increments
const hooked = await page.evaluate(() => {
  window.__app.clear();
  const s = window.__app.createString(0.15, 0.3, 0.85, 0.3);
  const ev = window.__app.pluck(s.id);
  return { count: window.__game.stringCount, plucks: window.__game.plucks, note: ev?.note, notes: window.__game.notes };
});

const lengths = (afterPluck.strings || []).map((s) => s.lengthCm);
const freqs = (afterPluck.strings || []).map((s) => s.rawHz);
let inverse = true;
for (let i = 0; i < lengths.length; i++) {
  for (let j = i + 1; j < lengths.length; j++) {
    if (lengths[i] > lengths[j] * 1.15 && !(freqs[i] < freqs[j])) inverse = false;
    if (lengths[j] > lengths[i] * 1.15 && !(freqs[j] < freqs[i])) inverse = false;
  }
}

console.log(JSON.stringify({
  botStrings: withStrings.stringCount,
  botPlucks: afterPluck.plucks,
  botNotes: afterTune.strings?.map((s) => s.note),
  pointerCreated,
  pointerPlucks: pointer.plucks,
  hooked,
  inverse,
  errors,
}, null, 2));

const ok = withStrings.stringCount >= 2
  && afterPluck.plucks >= 1
  && pointerCreated >= 1
  && pointer.plucks >= 1
  && hooked.plucks >= 1
  && hooked.notes >= 1
  && inverse
  && errors.length === 0;
if (errors.length) console.log('errors:\n  ' + errors.join('\n  '));
console.log(ok
  ? `OK: bot made ${withStrings.stringCount} strings and plucked ${afterPluck.plucks} time(s); pointer made ${pointerCreated}; hooks fired a note; f ∝ 1/L holds`
  : 'FAILED');
process.exitCode = ok ? 0 : 1;
await browser.close();
