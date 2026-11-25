/**
 * Every input source becomes the same thing: up to two hands, each with a pinch point and pinch strength.
 *
 *  - Camera: MediaPipe through the kit (`createHands`, numHands: 2). Landmarks are already mirrored;
 *    they are mapped through the same object-fit:cover transform used to draw the video, so the skeleton
 *    sits on the real hands.
 *  - Mouse / touch: synthetic hands (kit `screenHandLandmarks`) are injected at each pointer; holding
 *    the button pinches. Two fingers on a touch screen give two hands, so you can stretch a string.
 *  - Bot (`?bot=1`): src/bot.ts sets `bot` every frame and it is injected the same way.
 *
 * Pointer and bot hands are real synthetic landmarks fed through the real gesture engine.
 */
import {
  createHands, screenHandLandmarks, type Hands, type HandInput, type Vec3,
} from './hand-gesture-kit';

export type Mode = 'none' | 'camera' | 'pointer' | 'bot';

export interface HandView {
  id: string;
  handedness: 'Left' | 'Right';
  /** Palm centre on screen, 0..1. */
  screen: { x: number; y: number };
  /** Midpoint of thumb tip and index tip — the point used to stretch and grab strings. */
  pinchPoint: { x: number; y: number };
  pinch: number;
  landmarks: Vec3[];
  /** Fingertips in screen 0..1 (thumb … pinky), for pluck detection. */
  tips: { x: number; y: number }[];
  /** All 21 landmarks mapped into screen 0..1 (same space as pinchPoint). */
  screenLandmarks: { x: number; y: number }[];
}

export interface BotHand {
  x: number;
  y: number;
  pinch: number;
  handedness: 'Left' | 'Right';
}

/** Seconds for a held mouse button / finger to close the pinch fully. */
const POINTER_PINCH_S = 0.08;
const TIP_IDX = [4, 8, 12, 16, 20];

export class Input {
  readonly hands: Hands;
  mode: Mode = 'none';
  /** Tracked hands this frame (0–2). */
  views: HandView[] = [];
  /** Set by the bot each frame. */
  bot: BotHand[] = [];
  /** Video element used by the tracker; hidden, drawn onto the overlay canvas. */
  readonly video: HTMLVideoElement;
  canvasW = 1;
  canvasH = 1;
  private ptrs = new Map<number, { x: number; y: number; down: boolean; pinch: number; touch: boolean }>();

  constructor(video: HTMLVideoElement, el: HTMLElement) {
    this.video = video;
    this.hands = createHands({
      video,
      config: { pose: { experimental: false } },
      numHands: 2,
      onFrame: (f) => {
        const map = this.mapper();
        this.views = f.hands.map((h, i) => this.viewFrom(String(h.id ?? i), h.handedness, h.pinch, h.landmarks, h.features.center, map));
      },
    });
    const pos = (e: PointerEvent) => ({ x: e.clientX / Math.max(1, innerWidth), y: e.clientY / Math.max(1, innerHeight) });
    const onChrome = (e: Event) => {
      const t = e.target;
      return t instanceof Element && !!t.closest('button, a, input, textarea, select, label, #title, [data-ui]');
    };
    el.addEventListener('pointermove', (e) => {
      if (onChrome(e)) return;
      const p = this.ensurePtr(e);
      const q = pos(e);
      p.x = q.x; p.y = q.y; p.touch = e.pointerType === 'touch';
    });
    el.addEventListener('pointerdown', (e) => {
      // Capturing the pointer on body would swallow the title-screen button click.
      if (onChrome(e)) return;
      const p = this.ensurePtr(e);
      const q = pos(e);
      p.x = q.x; p.y = q.y; p.down = true; p.touch = e.pointerType === 'touch';
      try { el.setPointerCapture(e.pointerId); } catch { /* not all elements allow capture */ }
    });
    const up = (e: PointerEvent) => {
      const p = this.ptrs.get(e.pointerId);
      if (p) p.down = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  setSize(w: number, h: number) { this.canvasW = Math.max(1, w); this.canvasH = Math.max(1, h); }

  async startCamera() { await this.hands.startCamera(); this.setMode('camera'); }

  setMode(m: Mode) {
    this.mode = m;
    this.hands.inject(m === 'camera' ? null : []);
    if (m !== 'pointer') this.views = [];
  }

  update(dt: number) {
    if (this.mode === 'camera') return;
    const aspect = this.canvasW / this.canvasH;
    const out: HandInput[] = [];
    if (this.mode === 'pointer') {
      const live: typeof this.ptrs extends Map<number, infer V> ? (V & { id: number })[] : never[] = [];
      for (const [id, p] of this.ptrs) {
        p.pinch = p.down ? Math.min(1, p.pinch + dt / POINTER_PINCH_S) : Math.max(0, p.pinch - dt / POINTER_PINCH_S);
        // Keep a mouse cursor even when the button is up, so a swipe across a string can pluck it.
        // Touch pointers only exist while they are down (or while the pinch is still decaying).
        if (p.down || p.pinch > 0.01 || !p.touch) live.push(Object.assign(p, { id }));
        else this.ptrs.delete(id);
      }
      live.sort((a, b) => a.id - b.id);
      live.slice(0, 2).forEach((p, i) => {
        const y = p.touch && !p.down ? p.y - 0.05 : p.y;
        out.push(this.synth(p.x, y, p.pinch, i === 0 ? 'Right' : 'Left', aspect));
      });
    } else if (this.mode === 'bot') {
      for (const h of this.bot) out.push(this.synth(h.x, h.y, h.pinch, h.handedness, aspect));
    }
    this.hands.inject(out);
  }

  /**
   * Maps a 0..1 video-space landmark onto screen 0..1, matching object-fit: cover
   * (and a mirrored draw of the camera). Identity when there is no video.
   */
  mapper(): (p: { x: number; y: number }) => { x: number; y: number } {
    if (this.mode !== 'camera') return (p) => ({ x: p.x, y: p.y });
    const v = this.video;
    const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
    const cw = this.canvasW, ch = this.canvasH;
    const scale = Math.max(cw / vw, ch / vh);
    const w = vw * scale, h = vh * scale;
    const ox = (cw - w) / 2, oy = (ch - h) / 2;
    return (p) => ({ x: (ox + p.x * w) / cw, y: (oy + p.y * h) / ch });
  }

  videoCover(): { ox: number; oy: number; w: number; h: number } | null {
    if (this.mode !== 'camera') return null;
    const v = this.video;
    const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
    const cw = this.canvasW, ch = this.canvasH;
    const scale = Math.max(cw / vw, ch / vh);
    return { ox: (cw - vw * scale) / 2, oy: (ch - vh * scale) / 2, w: vw * scale, h: vh * scale };
  }

  private ensurePtr(e: PointerEvent) {
    let p = this.ptrs.get(e.pointerId);
    if (!p) { p = { x: 0.5, y: 0.5, down: false, pinch: 0, touch: false }; this.ptrs.set(e.pointerId, p); }
    return p;
  }

  private synth(x: number, y: number, pinch: number, handedness: 'Left' | 'Right', aspect: number): HandInput {
    // Place the thumb/index midpoint on (x, y) so a pinch lands exactly where the pointer is.
    const pose = { curl: [0.1, 0.15 + pinch * 0.35, 0.2, 0.25, 0.3] as [number, number, number, number, number], pinch };
    const landmarks = screenHandLandmarks(x, y, pose, { handedness, aspect, scale: 0.17 });
    return { landmarks, handedness, aspect };
  }

  private viewFrom(
    id: string,
    handedness: 'Left' | 'Right',
    pinch: number,
    landmarks: Vec3[],
    center: { x: number; y: number },
    map: (p: { x: number; y: number }) => { x: number; y: number },
  ): HandView {
    const pt = (i: number) => map(landmarks[i]);
    const thumb = pt(4), index = pt(8);
    const screenLandmarks = landmarks.map((p) => map(p));
    return {
      id, handedness, pinch, landmarks,
      screen: map(center),
      pinchPoint: { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 },
      tips: TIP_IDX.map((i) => pt(i)),
      screenLandmarks,
    };
  }
}
