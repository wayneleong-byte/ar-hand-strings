/**
 * ?bot=1: a synthetic two-hand player. It steers a pair of synthetic hands through the real gesture
 * engine (see Input.bot), so captures and tests show the instrument actually being played: stretch
 * a few strings of different lengths, pluck them, then grab an endpoint and retune.
 */
export type BotHandOut = { x: number; y: number; pinch: number; handedness: 'Left' | 'Right' };

interface Step {
  /** Seconds to spend in this pose, after arriving. */
  hold: number;
  left?: { x: number; y: number; pinch: number };
  right?: { x: number; y: number; pinch: number };
}

export class Bot {
  left: BotHandOut = { x: 0.28, y: 0.62, pinch: 0, handedness: 'Left' };
  right: BotHandOut = { x: 0.72, y: 0.62, pinch: 0, handedness: 'Right' };
  private i = 0;
  private hold = 0;
  private started = false;

  /** A short recital that leaves three strings on screen and plucks each of them. */
  private script: Step[] = [
    // enter, hands open
    { hold: 0.4, left: { x: 0.22, y: 0.55, pinch: 0 }, right: { x: 0.78, y: 0.55, pinch: 0 } },
    // stretch a long low string (around E4 / 49 cm)
    { hold: 0.85, left: { x: 0.18, y: 0.30, pinch: 1 }, right: { x: 0.80, y: 0.31, pinch: 1 } },
    { hold: 0.35, left: { x: 0.18, y: 0.30, pinch: 0 }, right: { x: 0.80, y: 0.31, pinch: 0 } },
    // a mid gold string
    { hold: 0.25, left: { x: 0.24, y: 0.48, pinch: 0 }, right: { x: 0.72, y: 0.50, pinch: 0 } },
    { hold: 0.7, left: { x: 0.24, y: 0.48, pinch: 1 }, right: { x: 0.72, y: 0.50, pinch: 1 } },
    { hold: 0.3, left: { x: 0.24, y: 0.48, pinch: 0 }, right: { x: 0.72, y: 0.50, pinch: 0 } },
    // a short high string
    { hold: 0.2, left: { x: 0.40, y: 0.64, pinch: 0 }, right: { x: 0.58, y: 0.66, pinch: 0 } },
    { hold: 0.65, left: { x: 0.40, y: 0.64, pinch: 1 }, right: { x: 0.58, y: 0.66, pinch: 1 } },
    { hold: 0.35, left: { x: 0.40, y: 0.64, pinch: 0 }, right: { x: 0.58, y: 0.66, pinch: 0 } },
    // pluck the long string: swipe a pointing right hand down across y=0.30
    { hold: 0.15, right: { x: 0.50, y: 0.18, pinch: 0 } },
    { hold: 0.28, right: { x: 0.50, y: 0.42, pinch: 0 } },
    // pluck the mid string
    { hold: 0.12, right: { x: 0.48, y: 0.38, pinch: 0 } },
    { hold: 0.28, right: { x: 0.48, y: 0.60, pinch: 0 } },
    // pluck the short string
    { hold: 0.12, right: { x: 0.49, y: 0.54, pinch: 0 } },
    { hold: 0.28, right: { x: 0.49, y: 0.76, pinch: 0 } },
    // grab the right end of the long string and shorten it
    { hold: 0.2, right: { x: 0.80, y: 0.31, pinch: 0 } },
    { hold: 0.7, right: { x: 0.80, y: 0.31, pinch: 1 } },
    { hold: 0.6, right: { x: 0.58, y: 0.28, pinch: 1 } },
    { hold: 0.3, right: { x: 0.58, y: 0.28, pinch: 0 } },
    // pluck the retuned string
    { hold: 0.12, right: { x: 0.38, y: 0.16, pinch: 0 } },
    { hold: 0.3, right: { x: 0.38, y: 0.42, pinch: 0 } },
    // rest, then loop a gentle extra pluck so loudness samples stay audible
    { hold: 0.4, left: { x: 0.22, y: 0.72, pinch: 0 }, right: { x: 0.72, y: 0.72, pinch: 0 } },
    { hold: 0.12, right: { x: 0.48, y: 0.38, pinch: 0 } },
    { hold: 0.28, right: { x: 0.48, y: 0.60, pinch: 0 } },
    { hold: 1.2, left: { x: 0.24, y: 0.70, pinch: 0 }, right: { x: 0.76, y: 0.70, pinch: 0 } },
  ];

  update(dt: number): BotHandOut[] {
    if (!this.started) { this.started = true; this.hold = this.script[0]?.hold ?? 0; }
    const step = this.script[this.i];
    if (step) {
      const speed = 1.6; // screen heights / s
      if (step.left) this.approach(this.left, step.left, dt, speed);
      if (step.right) this.approach(this.right, step.right, dt, speed);
      const arrived = (!step.left || this.close(this.left, step.left)) && (!step.right || this.close(this.right, step.right));
      if (arrived) {
        this.hold -= dt;
        if (this.hold <= 0) {
          this.i = (this.i + 1) % this.script.length;
          // after a full recital, skip the construction and just pluck so later loops stay interesting
          if (this.i === 0) this.i = 9;
          this.hold = this.script[this.i].hold;
        }
      }
    }
    return [this.left, this.right];
  }

  private approach(h: BotHandOut, t: { x: number; y: number; pinch: number }, dt: number, speed: number) {
    const dx = t.x - h.x, dy = t.y - h.y, d = Math.hypot(dx, dy);
    const s = Math.min(d, speed * dt);
    if (d > 1e-4) { h.x += (dx / d) * s; h.y += (dy / d) * s; }
    // pinch is not a position: snap toward the target quickly once we're near, else follow
    const k = Math.min(1, dt / 0.08);
    h.pinch = h.pinch + (t.pinch - h.pinch) * (d < 0.04 ? 1 : k);
  }

  private close(h: BotHandOut, t: { x: number; y: number; pinch: number }) {
    return Math.hypot(h.x - t.x, h.y - t.y) < 0.02 && Math.abs(h.pinch - t.pinch) < 0.15;
  }
}
