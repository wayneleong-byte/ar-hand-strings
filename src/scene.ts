/**
 * 2D AR overlay: mirrored webcam (or a solid backdrop when there is no camera), MediaPipe-style
 * skeletons, coloured floating strings with pearl endpoints, labels, and pluck particles.
 * No post-processing, no bloom — glow is painted as soft strokes.
 */
import { HAND_CONNECTIONS } from './hand-gesture-kit';
import { labelOf, grabbedEnds, type StringWire, type World, type Pt } from './rules';
import type { HandView } from './input';
import type { Pitch } from './pitch';
import { pitchOfSegment } from './pitch';

const BONE = '#2adf5a';
const JOINT = '#ff2a2a';
const SOLID_BG = '#15181f';

export class Scene {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  aspect = 16 / 9;
  w = 1;
  h = 1;

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize() {
    const cssW = innerWidth, cssH = innerHeight;
    if (cssW < 2 || cssH < 2) return;
    const dpr = Math.min(2.5, devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = cssW;
    this.h = cssH;
    this.aspect = cssW / cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  render(
    world: World,
    hands: HandView[],
    video: HTMLVideoElement | null,
    cover: { ox: number; oy: number; w: number; h: number } | null,
    grabbedHandIds: Set<string>,
  ) {
    if (this.w < 2 || this.h < 2) return;
    const ctx = this.ctx, dpr = this.dpr, W = this.w, H = this.h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (video && cover && video.readyState >= 2) this.drawVideo(video, cover);
    else this.drawSolid();

    if (world.draft) this.drawString(world, { ...world.draft, id: -1, vibr: 0, vibrPhase: 0, cooldown: 0, pull: 0, pullX: 0, pullY: 0 }, true, new Set());
    for (const s of world.strings) this.drawString(world, s, false, grabbedEnds(world, s));

    for (const p of world.particles) this.drawParticle(p, W, H);

    for (const h of hands) this.drawSkeleton(h, grabbedHandIds.has(h.id));
  }

  private drawVideo(video: HTMLVideoElement, cover: { ox: number; oy: number; w: number; h: number }) {
    const ctx = this.ctx;
    ctx.save();
    // Landmarks are already in selfie space; flip the raw camera so they line up.
    ctx.translate(cover.ox + cover.w, cover.oy);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, cover.w, cover.h);
    ctx.restore();
  }

  /** Flat backdrop used before the camera starts, and in mouse / bot mode. */
  private drawSolid() {
    this.ctx.fillStyle = SOLID_BG;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawString(world: World, s: StringWire, draft: boolean, grabbed: Set<'a' | 'b'>) {
    const ctx = this.ctx, W = this.w, H = this.h;
    const a = { x: s.a.x * W, y: s.a.y * H };
    const b = { x: s.b.x * W, y: s.b.y * H };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const vib = s.vibr * H * Math.sin(s.vibrPhase);
    const mid = {
      x: (a.x + b.x) / 2 + nx * vib + s.pullX * W * s.pull * 0.85,
      y: (a.y + b.y) / 2 + ny * vib + s.pullY * H * s.pull * 0.85,
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // soft halo
    ctx.strokeStyle = this.hexAlpha(s.color, draft ? 0.18 : 0.28);
    ctx.lineWidth = 14;
    this.strokeCurve(a, mid, b);

    // body
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = draft ? 0.75 : 1;
    ctx.lineWidth = 3.2;
    this.strokeCurve(a, mid, b);
    ctx.globalAlpha = 1;

    // ruler ticks along the longer strings
    if (len > 80) {
      const ticks = Math.max(6, Math.round(len / 36));
      ctx.strokeStyle = this.hexAlpha(s.color, 0.7);
      ctx.lineWidth = 1.2;
      for (let i = 1; i < ticks; i++) {
        const t = i / ticks;
        const px = a.x * (1 - t) * (1 - t) + mid.x * 2 * (1 - t) * t + b.x * t * t;
        const py = a.y * (1 - t) * (1 - t) + mid.y * 2 * (1 - t) * t + b.y * t * t;
        const tick = i % 2 === 0 ? 6 : 3.5;
        ctx.beginPath();
        ctx.moveTo(px + nx * tick, py + ny * tick);
        ctx.lineTo(px - nx * tick, py - ny * tick);
        ctx.stroke();
      }
    }

    this.drawPearl(a, s.color, grabbed.has('a'));
    this.drawPearl(b, s.color, grabbed.has('b'));

    const pitch: Pitch = pitchOfSegment(s.a.x, s.a.y, s.b.x, s.b.y, world.aspect);
    const text = labelOf(world, s);
    this.drawLabel(mid.x, mid.y + 22 + Math.abs(ny) * 6, text, s.color, pitch);

    ctx.restore();
  }

  private strokeCurve(a: Pt, mid: Pt, b: Pt) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    ctx.stroke();
  }

  private drawPearl(p: Pt, color: string, grabbed: boolean) {
    const ctx = this.ctx;
    if (grabbed) {
      const halo = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 28);
      halo.addColorStop(0, 'rgba(255,220,120,0.7)');
      halo.addColorStop(0.4, 'rgba(255,200,80,0.25)');
      halo.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, grabbed ? 8 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f7f4ee';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = grabbed ? '#f0c14a' : color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x - 1.6, p.y - 1.8, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }

  private drawLabel(x: number, y: number, text: string, color: string, _pitch: Pitch) {
    const ctx = this.ctx;
    ctx.font = '500 13px "Noto Sans TC", system-ui, sans-serif';
    const padX = 12;
    const tw = ctx.measureText(text).width;
    const w = tw + padX * 2 + 12;
    const h = 24;
    const rx = x - w / 2, ry = y - h / 2;
    ctx.beginPath();
    ctx.roundRect(rx, ry, w, h, 8);
    ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx + 11, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, rx + 20, y + 0.5);
  }

  private drawParticle(p: { x: number; y: number; life: number; maxLife: number; r: number; color: string }, W: number, H: number) {
    const ctx = this.ctx;
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, p.r * H * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawSkeleton(hand: HandView, grabbing: boolean) {
    const ctx = this.ctx, W = this.w, H = this.h;
    const screen = hand.screenLandmarks.length
      ? hand.screenLandmarks.map((p) => ({ x: p.x * W, y: p.y * H }))
      : hand.landmarks.map((p) => ({ x: p.x * W, y: p.y * H }));
    const px = (i: number) => screen[i];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = px(a), pb = px(b);
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    for (let i = 0; i < 21; i++) {
      const p = px(i);
      if (!p) continue;
      const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(p.x, p.y, tip ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = JOINT;
      ctx.fill();
    }

    const pinching = hand.pinch > 0.55;
    if (pinching || grabbing) {
      const p = { x: hand.pinchPoint.x * W, y: hand.pinchPoint.y * H };
      ctx.beginPath();
      ctx.arc(p.x, p.y, grabbing ? 11 : 9, 0, Math.PI * 2);
      ctx.strokeStyle = grabbing ? '#ffd36a' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      if (grabbing) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd36a';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private hexAlpha(hex: string, a: number): string {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }
}
