/**
 * Two-hand string gestures, built on top of the kit's per-hand pinch strength.
 * The kit already emits clap / zoom / steer; this module is the instrument-specific
 * vocabulary: two pinches stretch a new string, a pinch near an end grabs it, a
 * fingertip (or cursor) crossing the body plucks it.
 *
 * No extra smoothing is applied — pinch edges come from PinchSet hysteresis only.
 */
import { PinchSet } from './pinch';
import {
  isBusy, onPinchStart, pullBody, releaseHand, sparkle, startDraft,
  tryPluckPath, updateDraft, dragGrab, type Pt, type PluckEvent, type StringWire, type World,
} from './rules';
import { MIN_LEN_CM, pitchOfSegment } from './pitch';

export interface GestureHand {
  id: string;
  pinch: number;
  pinchPoint: Pt;
  tips: Pt[];
}

export interface GestureResult {
  plucked: PluckEvent[];
  created: StringWire[];
}

export class StringSession {
  readonly latches = new PinchSet();
  private prevTips = new Map<string, Pt[]>();
  private prevPinch = new Map<string, Pt>();
  private origins = new Map<string, Pt>();

  reset() {
    this.latches.reset();
    this.prevTips.clear();
    this.prevPinch.clear();
    this.origins.clear();
  }

  /**
   * Feed the current hands. `allowAnchor` enables the one-pointer fallback: dragging
   * on empty space stretches a string from the press origin to the cursor.
   */
  update(world: World, hands: GestureHand[], dt: number, allowAnchor = false): GestureResult {
    const plucked: PluckEvent[] = [];
    const created: StringWire[] = [];
    const live = new Set(hands.map((h) => h.id));

    for (const id of this.latches.prune(live)) {
      const r = releaseHand(world, id);
      if (r.plucked) plucked.push(r.plucked);
      if (r.created) created.push(r.created);
      this.prevTips.delete(id);
      this.prevPinch.delete(id);
      this.origins.delete(id);
    }

    const free: GestureHand[] = [];
    for (const h of hands) {
      const edge = this.latches.update(h.id, h.pinch);
      const p = h.pinchPoint;
      if (edge === 'press') {
        const kind = onPinchStart(world, h.id, p);
        if (kind === 'free') this.origins.set(h.id, { ...p });
      }
      if (this.latches.isDown(h.id)) {
        if (world.grabs.some((g) => g.handId === h.id)) {
          dragGrab(world, h.id, p);
          const g = world.grabs.find((g) => g.handId === h.id);
          const s = g && world.strings.find((s) => s.id === g.stringId);
          if (s) sparkle(world, s[g.end], dt);
        } else if (world.bodyPinches.some((b) => b.handId === h.id)) {
          pullBody(world, h.id, p);
        } else {
          free.push(h);
          updateDraft(world, h.id, p);
        }
      }
      if (edge === 'release') {
        const r = releaseHand(world, h.id);
        if (r.plucked) plucked.push(r.plucked);
        if (r.created) created.push(r.created);
        this.origins.delete(h.id);
      }
    }

    if (free.length >= 2 && !world.draft) {
      const a = free[0], b = free[1];
      startDraft(world, a.id, a.pinchPoint, b.id, b.pinchPoint);
    } else if (allowAnchor && free.length === 1 && !world.draft) {
      const h = free[0];
      const origin = this.origins.get(h.id);
      if (origin && pitchOfSegment(origin.x, origin.y, h.pinchPoint.x, h.pinchPoint.y, world.aspect).lengthCm >= MIN_LEN_CM * 0.5) {
        startDraft(world, `${h.id}-anchor`, origin, h.id, h.pinchPoint);
      }
    }

    const ignore = new Set<number>([
      ...world.grabs.map((g) => g.stringId),
      ...world.bodyPinches.map((b) => b.stringId),
    ]);
    for (const h of hands) {
      if (isBusy(world, h.id)) {
        this.prevTips.set(h.id, h.tips.map((t) => ({ ...t })));
        this.prevPinch.set(h.id, { ...h.pinchPoint });
        continue;
      }
      const prev = this.prevTips.get(h.id);
      if (prev) {
        for (let i = 0; i < h.tips.length && i < prev.length; i++) {
          plucked.push(...tryPluckPath(world, prev[i], h.tips[i], ignore));
        }
      }
      const pp = this.prevPinch.get(h.id);
      if (pp && h.pinch < 0.5) plucked.push(...tryPluckPath(world, pp, h.pinchPoint, ignore));
      this.prevTips.set(h.id, h.tips.map((t) => ({ ...t })));
      this.prevPinch.set(h.id, { ...h.pinchPoint });
    }

    return { plucked, created };
  }
}
