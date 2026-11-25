import { describe, expect, it } from 'vitest';
import { formatLabel, pitchFromLength, rawHzFromLength, REF_FREQ, REF_LEN_CM } from '../src/pitch';
import {
  addString, beginPlay, createWorld, dragGrab, onPinchStart, pitchOf, pluckString, mid,
  tryPluckPath, releaseHand, startDraft, commitDraft, step,
} from '../src/rules';
import { StringSession, type GestureHand } from '../src/string-gestures';

const hand = (id: string, x: number, y: number, pinch: number, tips?: { x: number; y: number }[]): GestureHand => ({
  id, pinch, pinchPoint: { x, y }, tips: tips ?? [{ x, y }],
});

describe('pitch from length', () => {
  it('a 49 cm string is E4 at 330 Hz', () => {
    const p = pitchFromLength(REF_LEN_CM);
    expect(p.note).toBe('E4');
    expect(Math.round(p.hz)).toBe(REF_FREQ);
    expect(formatLabel(p)).toBe('E4 · 330Hz · 49cm');
  });

  it('frequency is inversely proportional to length (before snapping)', () => {
    const a = rawHzFromLength(49);
    const b = rawHzFromLength(24.5);
    expect(b / a).toBeCloseTo(2, 8);
    expect(rawHzFromLength(49) * 49).toBeCloseTo(rawHzFromLength(20) * 20, 6);
  });

  it('a shorter string is a higher snapped note than a longer one', () => {
    const low = pitchFromLength(49);
    const high = pitchFromLength(14);
    expect(high.hz).toBeGreaterThan(low.hz);
    expect(high.midi).toBeGreaterThan(low.midi);
  });
});

describe('strings', () => {
  it('two pinch points create a string that stays after release', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const session = new StringSession();
    // open
    session.update(w, [hand('L', 0.2, 0.3, 0), hand('R', 0.8, 0.3, 0)], 1 / 30);
    // pinch both, hold a few frames
    for (let i = 0; i < 4; i++) session.update(w, [hand('L', 0.2, 0.3, 1), hand('R', 0.8, 0.3, 1)], 1 / 30);
    expect(w.draft).not.toBeNull();
    // release
    const r = session.update(w, [hand('L', 0.2, 0.3, 0), hand('R', 0.8, 0.3, 0)], 1 / 30);
    expect(r.created.length).toBeGreaterThanOrEqual(1);
    expect(w.strings).toHaveLength(1);
    expect(w.draft).toBeNull();
    expect(w.strings[0].a.x).toBeCloseTo(0.2, 2);
    expect(w.strings[0].b.x).toBeCloseTo(0.8, 2);
  });

  it('several strings can exist at once, and length changes the pitch', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const long = addString(w, { x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 })!;
    const short = addString(w, { x: 0.4, y: 0.5 }, { x: 0.55, y: 0.5 })!;
    expect(w.strings).toHaveLength(2);
    const pLong = (long.b.x - long.a.x);
    const pShort = (short.b.x - short.a.x);
    expect(pLong).toBeGreaterThan(pShort);
    expect(pitchOf(w, short).rawHz).toBeGreaterThan(pitchOf(w, long).rawHz);
  });

  it('dragging an endpoint shortens the string and raises the pitch', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const s = addString(w, { x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 })!;
    const before = pitchOf(w, s).rawHz;
    onPinchStart(w, 'R', { x: 0.8, y: 0.4 });
    dragGrab(w, 'R', { x: 0.45, y: 0.4 });
    expect(pitchOf(w, s).rawHz).toBeGreaterThan(before * 1.2);
    releaseHand(w, 'R');
    expect(w.grabs).toHaveLength(0);
  });

  it('a fingertip path that crosses the string plucks it and can be heard from the event', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const s = addString(w, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })!;
    const ev = tryPluckPath(w, { x: 0.5, y: 0.35 }, { x: 0.5, y: 0.65 });
    expect(ev).toHaveLength(1);
    expect(ev[0].id).toBe(s.id);
    expect(ev[0].hz).toBeGreaterThan(0);
    expect(w.plucks).toBe(1);
    // cooldown prevents an immediate double-pluck
    expect(tryPluckPath(w, { x: 0.5, y: 0.35 }, { x: 0.5, y: 0.65 })).toHaveLength(0);
    step(w, 0.3);
    expect(tryPluckPath(w, { x: 0.5, y: 0.35 }, { x: 0.5, y: 0.65 })).toHaveLength(1);
    expect(w.plucks).toBe(2);
  });

  it('pinching the body and releasing also plucks', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const s = addString(w, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })!;
    const session = new StringSession();
    session.update(w, [hand('L', 0.5, 0.5, 1)], 1 / 30);
    expect(w.bodyPinches).toHaveLength(1);
    const r = session.update(w, [hand('L', 0.5, 0.5, 0)], 1 / 30);
    expect(r.plucked[0]?.id).toBe(s.id);
  });

  it('a one-pointer drag on empty space creates a string (mouse fallback)', () => {
    const w = createWorld(16 / 9);
    beginPlay(w);
    const session = new StringSession();
    session.update(w, [hand('P', 0.2, 0.4, 1)], 1 / 30, true);
    for (let x = 0.25; x <= 0.75; x += 0.1) session.update(w, [hand('P', x, 0.4, 1)], 1 / 30, true);
    expect(w.draft).not.toBeNull();
    const r = session.update(w, [hand('P', 0.8, 0.4, 0)], 1 / 30, true);
    expect(r.created).toHaveLength(1);
    expect(w.strings).toHaveLength(1);
  });

  it('direct hooks can place a string and pluck it', () => {
    const w = createWorld(16 / 9);
    const s = addString(w, { x: 0.2, y: 0.2 }, { x: 0.7, y: 0.25 })!;
    const ev = pluckString(w, s, mid(s.a, s.b));
    expect(ev?.note).toBeTruthy();
    expect(w.lastPluck?.id).toBe(s.id);
  });

  it('a too-short pair is not committed as a string', () => {
    const w = createWorld(16 / 9);
    startDraft(w, 'a', { x: 0.5, y: 0.5 }, 'b', { x: 0.51, y: 0.5 });
    expect(commitDraft(w)).toBeNull();
    expect(w.strings).toHaveLength(0);
  });
});
