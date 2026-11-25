/**
 * The instrument's rules, with no DOM and no camera, so they can be unit-tested and driven by the bot.
 * Everything is in screen space: x 0..1 left to right, y 0..1 top to bottom. Distances used for hit-testing
 * are measured in screen heights (x offsets multiplied by the aspect), so a grab feels the same on a wide
 * or a tall screen.
 *
 * Mechanic: two pinches stretch a floating string; after release it stays. Length sets pitch (f ∝ 1/L).
 * A pinch near an endpoint drags it. A fingertip (or cursor) crossing the body plucks the note.
 */
import { MIN_LEN_CM, formatLabel, pitchOfSegment, type Pitch } from './pitch';

export type Phase = 'title' | 'play';
export type End = 'a' | 'b';

export interface Pt { x: number; y: number }

export interface StringWire {
  id: number;
  a: Pt;
  b: Pt;
  color: string;
  /** Remaining vibration amplitude after a pluck, in screen heights. */
  vibr: number;
  vibrPhase: number;
  /** Seconds before this string can be plucked again. */
  cooldown: number;
  /** Temporary bend toward a body-pinch, 0..1. */
  pull: number;
  pullX: number;
  pullY: number;
}

export interface Grab {
  handId: string;
  stringId: number;
  end: End;
}

export interface BodyPinch {
  handId: string;
  stringId: number;
}

export interface Draft {
  handA: string;
  handB: string;
  a: Pt;
  b: Pt;
  color: string;
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; r: number; color: string;
}

export interface PluckEvent {
  id: number;
  note: string;
  hz: number;
  lengthCm: number;
  t: number;
  x: number;
  y: number;
}

export interface World {
  phase: Phase;
  time: number;
  aspect: number;
  strings: StringWire[];
  draft: Draft | null;
  grabs: Grab[];
  bodyPinches: BodyPinch[];
  particles: Particle[];
  nextId: number;
  paletteI: number;
  plucks: number;
  lastPluck: PluckEvent | null;
  created: number;
}

export const PALETTE = [
  '#5ee2c4', // mint / teal
  '#f0c14a', // gold
  '#6ec8ff', // cyan
  '#e889f0', // pink
  '#b08cff', // purple
  '#5adf7a', // green
  '#ff9a62', // orange
  '#7ad0d8', // aqua
];

/** How close a pinch must be to an endpoint to grab it, in screen heights. */
export const GRAB_R = 0.055;
/** How close a fingertip must come to the string body to pluck it, in screen heights. */
export const PLUCK_R = 0.022;
/** How close a pinch must be to the body (and not an end) to start a pinch-pluck. */
export const BODY_R = 0.03;
export const PLUCK_COOLDOWN = 0.22;

export function createWorld(aspect = 16 / 9): World {
  return {
    phase: 'title', time: 0, aspect,
    strings: [], draft: null, grabs: [], bodyPinches: [], particles: [],
    nextId: 1, paletteI: 0, plucks: 0, lastPluck: null, created: 0,
  };
}

export function beginPlay(w: World) {
  w.phase = 'play';
  w.time = 0;
}

export function clearInstrument(w: World) {
  w.strings = [];
  w.draft = null;
  w.grabs = [];
  w.bodyPinches = [];
  w.particles = [];
  w.lastPluck = null;
}

export function pitchOf(w: World, s: { a: Pt; b: Pt }): Pitch {
  return pitchOfSegment(s.a.x, s.a.y, s.b.x, s.b.y, w.aspect);
}

export function labelOf(w: World, s: { a: Pt; b: Pt }): string {
  return formatLabel(pitchOf(w, s));
}

export function distH(ax: number, ay: number, bx: number, by: number, aspect: number): number {
  return Math.hypot((bx - ax) * aspect, by - ay);
}

export function distToSegment(p: Pt, a: Pt, b: Pt, aspect: number): number {
  const abx = (b.x - a.x) * aspect, aby = b.y - a.y;
  const apx = (p.x - a.x) * aspect, apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  return Math.hypot(apx - abx * t, apy - aby * t);
}

/** Closest point on segment AB to P, in screen 0..1. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt, aspect: number): Pt {
  const abx = (b.x - a.x) * aspect, aby = b.y - a.y;
  const apx = (p.x - a.x) * aspect, apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsIntersect(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const o1 = orient(p, q, a), o2 = orient(p, q, b), o3 = orient(a, b, p), o4 = orient(a, b, q);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function nextColor(w: World): string {
  const c = PALETTE[w.paletteI % PALETTE.length];
  w.paletteI++;
  return c;
}

function makeString(w: World, a: Pt, b: Pt, color?: string): StringWire {
  return {
    id: w.nextId++, a: { ...a }, b: { ...b }, color: color ?? nextColor(w),
    vibr: 0, vibrPhase: 0, cooldown: 0, pull: 0, pullX: 0, pullY: 0,
  };
}

/** Directly place a committed string (tests, pointer drag, hooks). */
export function addString(w: World, a: Pt, b: Pt, color?: string): StringWire | null {
  if (pitchOfSegment(a.x, a.y, b.x, b.y, w.aspect).lengthCm < MIN_LEN_CM) return null;
  const s = makeString(w, a, b, color);
  w.strings.push(s);
  w.created++;
  burst(w, mid(a, b), s.color, 10);
  burst(w, a, s.color, 6);
  burst(w, b, s.color, 6);
  return s;
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function nearestEnd(w: World, p: Pt): { s: StringWire; end: End; d: number } | null {
  let best: { s: StringWire; end: End; d: number } | null = null;
  for (const s of w.strings) {
    const da = distH(p.x, p.y, s.a.x, s.a.y, w.aspect);
    const db = distH(p.x, p.y, s.b.x, s.b.y, w.aspect);
    const end: End = da <= db ? 'a' : 'b';
    const d = Math.min(da, db);
    if (!best || d < best.d) best = { s, end, d };
  }
  return best;
}

export function nearestBody(w: World, p: Pt): { s: StringWire; d: number; at: Pt } | null {
  let best: { s: StringWire; d: number; at: Pt } | null = null;
  for (const s of w.strings) {
    const d = distToSegment(p, s.a, s.b, w.aspect);
    if (!best || d < best.d) best = { s, d, at: closestOnSegment(p, s.a, s.b, w.aspect) };
  }
  return best;
}

/**
 * A new pinch at `p`. Grabs an endpoint if close enough, otherwise starts a body-pinch
 * if close to a string, otherwise counts as a free pinch for stretching a new string.
 * Returns 'grab' | 'body' | 'free'.
 */
export function onPinchStart(w: World, handId: string, p: Pt): 'grab' | 'body' | 'free' {
  releaseHand(w, handId);
  const end = nearestEnd(w, p);
  if (end && end.d <= GRAB_R) {
    w.grabs.push({ handId, stringId: end.s.id, end: end.end });
    burst(w, end.end === 'a' ? end.s.a : end.s.b, '#ffd36a', 14);
    return 'grab';
  }
  const body = nearestBody(w, p);
  if (body && body.d <= BODY_R) {
    w.bodyPinches.push({ handId, stringId: body.s.id });
    return 'body';
  }
  return 'free';
}

export function dragGrab(w: World, handId: string, p: Pt) {
  const g = w.grabs.find((g) => g.handId === handId);
  if (!g) return;
  const s = w.strings.find((s) => s.id === g.stringId);
  if (!s) return;
  s[g.end] = { x: p.x, y: p.y };
}

export function pullBody(w: World, handId: string, p: Pt) {
  const b = w.bodyPinches.find((b) => b.handId === handId);
  if (!b) return;
  const s = w.strings.find((s) => s.id === b.stringId);
  if (!s) return;
  const at = closestOnSegment(p, s.a, s.b, w.aspect);
  s.pull = 1;
  s.pullX = p.x - at.x;
  s.pullY = p.y - at.y;
}

export function startDraft(w: World, handA: string, a: Pt, handB: string, b: Pt) {
  w.draft = { handA, handB, a: { ...a }, b: { ...b }, color: nextColor(w) };
}

export function updateDraft(w: World, handId: string, p: Pt) {
  const d = w.draft;
  if (!d) return;
  if (d.handA === handId) d.a = { ...p };
  if (d.handB === handId) d.b = { ...p };
}

export function commitDraft(w: World): StringWire | null {
  const d = w.draft;
  w.draft = null;
  if (!d) return null;
  return addString(w, d.a, d.b, d.color);
}

export function cancelDraft(w: World) {
  w.draft = null;
}

/** Drop any grab / body-pinch / draft involvement for this hand. Commits a draft if this hand was in it. */
export function releaseHand(w: World, handId: string): { plucked: PluckEvent | null; created: StringWire | null } {
  let plucked: PluckEvent | null = null;
  let created: StringWire | null = null;
  const body = w.bodyPinches.find((b) => b.handId === handId);
  if (body) {
    const s = w.strings.find((s) => s.id === body.stringId);
    w.bodyPinches = w.bodyPinches.filter((b) => b.handId !== handId);
    if (s) {
      s.pull = 0;
      plucked = pluckString(w, s, mid(s.a, s.b));
    }
  }
  w.grabs = w.grabs.filter((g) => g.handId !== handId);
  if (w.draft && (w.draft.handA === handId || w.draft.handB === handId)) {
    created = commitDraft(w);
  }
  return { plucked, created };
}

export function isBusy(w: World, handId: string): boolean {
  return w.grabs.some((g) => g.handId === handId) || w.bodyPinches.some((b) => b.handId === handId);
}

export function pluckString(w: World, s: StringWire, at: Pt, strength = 1): PluckEvent | null {
  if (s.cooldown > 0) return null;
  const p = pitchOf(w, s);
  s.vibr = 0.016 * Math.max(0.4, Math.min(1.4, strength));
  s.vibrPhase = 0;
  s.cooldown = PLUCK_COOLDOWN;
  s.pull = 0;
  burst(w, at, s.color, 18);
  burst(w, at, '#ffe9a8', 10);
  const ev: PluckEvent = { id: s.id, note: p.note, hz: p.hz, lengthCm: p.lengthCm, t: w.time, x: at.x, y: at.y };
  w.plucks++;
  w.lastPluck = ev;
  return ev;
}

/**
 * A fingertip or cursor moved from `prev` to `curr`. Plucks every eligible string it crosses
 * (or comes close enough to after having been further away).
 */
export function tryPluckPath(w: World, prev: Pt, curr: Pt, ignoreIds?: Set<number>): PluckEvent[] {
  const out: PluckEvent[] = [];
  const skip = ignoreIds ?? new Set<number>();
  for (const g of w.grabs) skip.add(g.stringId);
  for (const b of w.bodyPinches) skip.add(b.stringId);
  for (const s of w.strings) {
    if (skip.has(s.id) || s.cooldown > 0) continue;
    const d0 = distToSegment(prev, s.a, s.b, w.aspect);
    const d1 = distToSegment(curr, s.a, s.b, w.aspect);
    const hit = segmentsIntersect(prev, curr, s.a, s.b) || (d0 > PLUCK_R && d1 <= PLUCK_R);
    if (!hit) continue;
    const at = closestOnSegment(curr, s.a, s.b, w.aspect);
    const ev = pluckString(w, s, at, 0.7 + Math.min(1, distH(prev.x, prev.y, curr.x, curr.y, w.aspect) / 0.08) * 0.5);
    if (ev) out.push(ev);
  }
  return out;
}

export function burst(w: World, p: Pt, color: string, n: number) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.04 + Math.random() * 0.18;
    w.particles.push({
      x: p.x, y: p.y,
      vx: Math.cos(ang) * sp / Math.max(w.aspect, 1),
      vy: Math.sin(ang) * sp * 0.7 - 0.04,
      life: 0.45 + Math.random() * 0.5,
      maxLife: 0.8,
      r: 0.0025 + Math.random() * 0.004,
      color,
    });
  }
}

/** Gold sparkle around a grabbed endpoint, called each frame. */
export function sparkle(w: World, p: Pt, dt: number) {
  if (Math.random() > dt * 28) return;
  burst(w, { x: p.x + (Math.random() - 0.5) * 0.01, y: p.y + (Math.random() - 0.5) * 0.01 }, '#ffd36a', 1);
}

export function step(w: World, dt: number) {
  if (w.phase !== 'play') return;
  w.time += dt;
  for (const s of w.strings) {
    s.cooldown = Math.max(0, s.cooldown - dt);
    s.vibr *= Math.pow(0.08, dt);
    s.vibrPhase += dt * 42;
    if (s.vibr < 0.0004) s.vibr = 0;
    if (!w.bodyPinches.some((b) => b.stringId === s.id)) s.pull *= Math.pow(0.02, dt);
  }
  for (const p of w.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.12 * dt;
    p.vx *= Math.pow(0.25, dt);
  }
  w.particles = w.particles.filter((p) => p.life > 0);
}

export function grabbedEnds(w: World, s: StringWire): Set<End> {
  const out = new Set<End>();
  for (const g of w.grabs) if (g.stringId === s.id) out.add(g.end);
  return out;
}
