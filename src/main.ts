/**
 * Wiring: two-hand input → string rules → overlay and piano, plus the title screen, HUD and test hooks.
 *
 * URL flags:
 *   ?bot=1        a synthetic two-hand player plays through the real gesture engine (implies autostart)
 *   ?autostart=1  skip the title (mouse mode)
 *   ?mute=1       no sound
 */
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import './style.css';
import { Input, type HandView } from './input';
import { addString, beginPlay, clearInstrument, createWorld, mid, pluckString, step, type World } from './rules';
import { StringSession } from './string-gestures';
import { Scene } from './scene';
import { Sound } from './audio';
import { Bot } from './bot';
import { pitchOfSegment } from './pitch';

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.get(k) === '1';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const world = createWorld(innerWidth / Math.max(1, innerHeight));
const scene = new Scene($('stage'));
const input = new Input($<HTMLVideoElement>('cam'), document.body);
const sound = new Sound();
const session = new StringSession();
const bot = flag('bot') ? new Bot() : null;
sound.muted = flag('mute');

function showTitle(on: boolean) {
  $('title').classList.toggle('hidden', !on);
  $('chrome').classList.toggle('hidden', on);
}

function begin() {
  sound.start();
  beginPlay(world);
  session.reset();
  showTitle(false);
  refreshHud();
}

$('b-cam').addEventListener('click', async () => {
  sound.start();
  $('err').textContent = '';
  $('b-cam').textContent = '正在開啟鏡頭…';
  try {
    await input.startCamera();
    begin();
  } catch {
    $('b-cam').textContent = '開啟鏡頭';
    $('err').textContent = '鏡頭無法使用或已被阻擋。仍可用滑鼠或觸控演奏。';
  }
});
$('b-mouse').addEventListener('click', () => { input.setMode('pointer'); begin(); });
$('b-clear').addEventListener('click', () => { clearInstrument(world); refreshHud(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && world.phase !== 'play') { if (input.mode === 'none') input.setMode('pointer'); begin(); }
  if (e.key === 'm' || e.key === 'M') sound.setMuted(!sound.muted);
  if (e.key === 'Escape' && world.phase === 'play') { clearInstrument(world); refreshHud(); }
});
addEventListener('resize', () => { scene.resize(); input.setSize(scene.w, scene.h); world.aspect = scene.aspect; });
input.setSize(scene.w, scene.h);

if (bot) input.setMode('bot');
if (bot || flag('autostart')) { if (input.mode === 'none') input.setMode('pointer'); begin(); }
else showTitle(true);

function refreshHud() {
  const cam = input.mode === 'camera';
  $('status-text').textContent = cam ? 'AR雙手琴弦追蹤進行中' : (input.mode === 'bot' ? '示範演奏進行中' : '滑鼠／觸控演奏中');
  $('string-count').textContent = `${world.strings.length} 條懸浮弦`;
  $('status').classList.toggle('live', cam || input.mode === 'bot');
}

function interpret(hands: HandView[], dt: number) {
  const { plucked } = session.update(world, hands, dt, input.mode === 'pointer');
  for (const ev of plucked) sound.pluck(ev.hz);
}

let last = performance.now(), fps = 60;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;

  if (bot) input.bot = bot.update(dt);
  input.update(dt);
  world.aspect = scene.aspect;
  if (world.phase === 'play') interpret(input.views, dt);
  step(world, dt);
  refreshHud();

  const grabbed = new Set(world.grabs.map((g) => g.handId));
  const video = input.mode === 'camera' ? input.video : null;
  scene.render(world, input.views, video, input.videoCover(), grabbed);
}
requestAnimationFrame(frame);

function snapshotStrings(w: World) {
  return w.strings.map((s) => {
    const p = pitchOfSegment(s.a.x, s.a.y, s.b.x, s.b.y, w.aspect);
    return { id: s.id, note: p.note, freq: p.hz, rawHz: p.rawHz, lengthCm: p.lengthCm, a: s.a, b: s.b, color: s.color };
  });
}

// Playwright and the capture / fps / loud tools read this.
Object.defineProperty(window, '__game', {
  get: () => ({
    phase: world.phase,
    mode: input.mode,
    strings: snapshotStrings(world),
    stringCount: world.strings.length,
    created: world.created,
    plucks: world.plucks,
    lastPluck: world.lastPluck,
    notes: sound.notes,
    lastHz: sound.lastHz,
    hands: input.views.map((h) => ({ id: h.id, x: h.pinchPoint.x, y: h.pinchPoint.y, pinch: h.pinch, handedness: h.handedness })),
    fps: Math.round(fps),
    dpr: scene.dpr,
    draft: !!world.draft,
  }),
});

// Imperative hooks so a test can place a string or fire a pluck without a webcam.
Object.defineProperty(window, '__app', {
  value: {
    clear: () => { clearInstrument(world); },
    begin,
    createString: (x1: number, y1: number, x2: number, y2: number) => {
      return addString(world, { x: x1, y: y1 }, { x: x2, y: y2 });
    },
    pluck: (id?: number) => {
      const s = id != null ? world.strings.find((s) => s.id === id) : world.strings[0];
      if (!s) return null;
      const ev = pluckString(world, s, mid(s.a, s.b));
      if (ev) sound.pluck(ev.hz);
      return ev;
    },
  },
});
