interface GameHookString {
  id: number;
  note: string;
  freq: number;
  rawHz: number;
  lengthCm: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
  color: string;
}

interface GameHook {
  phase: 'title' | 'play';
  mode: 'none' | 'camera' | 'pointer' | 'bot';
  strings: GameHookString[];
  stringCount: number;
  created: number;
  plucks: number;
  lastPluck: { id: number; note: string; hz: number; lengthCm: number; t: number; x: number; y: number } | null;
  notes: number;
  lastHz: number;
  hands: { id: string; x: number; y: number; pinch: number; handedness: string }[];
  fps: number;
  dpr: number;
  draft: boolean;
}

interface GameApp {
  clear: () => void;
  begin: () => void;
  createString: (x1: number, y1: number, x2: number, y2: number) => unknown;
  pluck: (id?: number) => { id: number; note: string; hz: number } | null;
}

interface Window {
  __game: GameHook;
  __app: GameApp;
  __loud?: { rms: number[]; peak: number };
}
