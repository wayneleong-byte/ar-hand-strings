/**
 * String length → pitch. Frequency is inversely proportional to length (f ∝ 1/L),
 * calibrated so a 49 cm string is E4 (330 Hz), then snapped to the nearest equal-tempered note
 * so labels and playback stay musical and stable.
 */
export const A4 = 440;
export const REF_LEN_CM = 49;
export const REF_FREQ = 330; // E4, as in the reference UI
/** Visible camera width is treated as this many centimetres (seated laptop distance). */
export const VIEW_WIDTH_CM = 80;
export const MIN_LEN_CM = 6;
export const MAX_LEN_CM = 120;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface Pitch {
  /** Measured length in centimetres. */
  lengthCm: number;
  /** Continuous frequency from f ∝ 1/L, before snapping. */
  rawHz: number;
  /** Nearest equal-tempered frequency, used for labels and audio. */
  hz: number;
  midi: number;
  note: string;
}

export function lengthCm(ax: number, ay: number, bx: number, by: number, aspect: number): number {
  // (x, y) are screen 0..1; convert to a width-normalised length so circles are round.
  const norm = Math.hypot(bx - ax, (by - ay) / Math.max(aspect, 1e-6));
  return Math.min(MAX_LEN_CM, Math.max(MIN_LEN_CM * 0.25, norm * VIEW_WIDTH_CM));
}

export function rawHzFromLength(cm: number): number {
  const L = Math.max(MIN_LEN_CM * 0.25, cm);
  return REF_FREQ * REF_LEN_CM / L;
}

export function midiFromHz(hz: number): number {
  return Math.round(12 * Math.log2(Math.max(hz, 8) / A4) + 69);
}

export function hzFromMidi(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi: number): string {
  const m = Math.max(0, Math.min(127, Math.round(midi)));
  return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

export function pitchFromLength(cm: number): Pitch {
  const lengthCm = Math.min(MAX_LEN_CM, Math.max(MIN_LEN_CM * 0.25, cm));
  const rawHz = rawHzFromLength(lengthCm);
  const midi = Math.max(24, Math.min(108, midiFromHz(rawHz))); // C1..C8
  return { lengthCm, rawHz, hz: hzFromMidi(midi), midi, note: noteName(midi) };
}

export function pitchOfSegment(ax: number, ay: number, bx: number, by: number, aspect: number): Pitch {
  return pitchFromLength(lengthCm(ax, ay, bx, by, aspect));
}

/** Format like the reference UI: "E4 · 330Hz · 49cm". */
export function formatLabel(p: Pitch): string {
  return `${p.note} · ${Math.round(p.hz)}Hz · ${Math.round(p.lengthCm)}cm`;
}
