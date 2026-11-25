// The gestures this game asks for (a pinch on each hand, independently) must be recognised from
// synthetic hands through the real engine, and the latch must turn a jittery pinch into one press
// and one release per hand.
import { describe, expect, it } from 'vitest';
import { GestureEngine, syntheticHand, SYNTHETIC_POSES as P } from '../src/hand-gesture-kit';
import { PinchLatch, PinchSet } from '../src/pinch';

const run = (pose: typeof P.open, handedness: 'Left' | 'Right' = 'Right', frames = 10) => {
  const e = new GestureEngine();
  let f = e.update([syntheticHand(0.5, 0.5, pose, { handedness })], 0);
  for (let i = 1; i < frames; i++) f = e.update([syntheticHand(0.5, 0.5, pose, { handedness })], i * 33);
  return f.hands[0];
};

describe('gestures', () => {
  for (const hand of ['Left', 'Right'] as const) {
    it(`${hand} pinch reads as a strong pinch, an open hand as none`, () => {
      expect(run(P.pinch, hand).pinch).toBeGreaterThan(0.75);
      expect(run(P.open, hand).pinch).toBeLessThan(0.3);
    });
  }

  it('two hands can pinch at the same time', () => {
    const e = new GestureEngine();
    let f = e.update([
      syntheticHand(0.25, 0.4, P.pinch, { handedness: 'Left' }),
      syntheticHand(0.75, 0.4, P.pinch, { handedness: 'Right' }),
    ], 0);
    for (let i = 1; i < 10; i++) {
      f = e.update([
        syntheticHand(0.25, 0.4, P.pinch, { handedness: 'Left' }),
        syntheticHand(0.75, 0.4, P.pinch, { handedness: 'Right' }),
      ], i * 33);
    }
    expect(f.hands).toHaveLength(2);
    expect(f.hands.every((h) => h.pinch > 0.75)).toBe(true);
    const sides = new Set(f.hands.map((h) => h.handedness));
    expect(sides.has('Left') && sides.has('Right')).toBe(true);
  });

  it('the latch gives one press and one release for a pinch with jitter', () => {
    const l = new PinchLatch();
    const edges = [0.1, 0.4, 0.65, 0.55, 0.7, 0.45, 0.5, 0.3, 0.4, 0.2].map((p) => l.update(p)).filter(Boolean);
    expect(edges).toEqual(['press', 'release']);
  });

  it('PinchSet tracks two hands independently', () => {
    const s = new PinchSet();
    expect(s.update('L', 0.8)).toBe('press');
    expect(s.update('R', 0.2)).toBeNull();
    expect(s.update('R', 0.8)).toBe('press');
    expect(s.update('L', 0.1)).toBe('release');
    expect(s.isDown('R')).toBe(true);
    expect(s.isDown('L')).toBe(false);
    expect(s.prune(['R'])).toEqual([]);
    expect(s.prune([])).toEqual(['R']);
  });
});
