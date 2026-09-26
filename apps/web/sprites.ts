export type Ctx = CanvasRenderingContext2D;
export type Draw = (c: Ctx) => void;
export type Layer = [color: string, draw: Draw];

export function ctx2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): Ctx {
  const c = canvas.getContext("2d", settings);
  if (!c) throw new Error("2D canvas context unavailable");
  return c;
}

const off = document.createElement("canvas");
const oc = ctx2d(off, { willReadFrequently: true });
export const rgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const css = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function paint(canvas: HTMLCanvasElement, w: number, h: number, layers: Layer[]): void {
  canvas.width = w;
  canvas.height = h;
  off.width = w;
  off.height = h;
  const out = new ImageData(w, h);
  const o = out.data;
  const lit = new Uint8Array(w * h);
  for (const [color, draw] of layers) {
    oc.clearRect(0, 0, w, h);
    oc.save();
    oc.strokeStyle = oc.fillStyle = "#fff";
    oc.lineWidth = 1;
    oc.lineCap = oc.lineJoin = "round";
    draw(oc);
    oc.restore();
    const d = oc.getImageData(0, 0, w, h).data;
    const [r, g, b] = rgb(color);
    for (let i = 0; i < w * h; i++) {
      if ((d[i * 4 + 3] ?? 0) > 70) {
        o.set([r, g, b, 255], i * 4);
        lit[i] = 1;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (lit[i]) continue;
    const x = i % w;
    const n = [x > 0 && i - 1, x < w - 1 && i + 1, i - w, i + w].find((j) => j !== false && lit[j]);
    if (n !== undefined && n !== false)
      o.set([o[n * 4] ?? 0, o[n * 4 + 1] ?? 0, o[n * 4 + 2] ?? 0, 70], i * 4);
  }
  ctx2d(canvas).putImageData(out, 0, 0);
}

const TAU = Math.PI * 2;
export const E = (c: Ctx, x: number, y: number, rx: number, ry: number): void => {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.stroke();
};
export const A = (c: Ctx, x: number, y: number, r: number, a0: number, a1: number): void => {
  c.beginPath();
  c.arc(x, y, r, a0 * Math.PI, a1 * Math.PI);
  c.stroke();
};
export const L = (c: Ctx, ...p: number[]): void => {
  c.beginPath();
  c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.stroke();
};
export const D = (c: Ctx, ...p: number[]): void => {
  for (let i = 0; i < p.length; i += 2) c.fillRect(p[i], p[i + 1], 1, 1);
};
const shoulders: Draw = (c) => A(c, 16, 37, 13, 1.12, 1.88);
const eyes: Draw = (c) => D(c, 14, 13, 18, 13);
const cap: Draw = (c) => A(c, 16, 11, 6, 1, 2);

export const PORTRAITS = {
  mask: (c: Ctx) => {
    E(c, 16, 14, 7, 9);
    L(c, 11, 11, 14, 11);
    L(c, 18, 11, 21, 11);
    D(c, 12, 16, 14, 17, 18, 17, 20, 16, 13, 19, 16, 19, 19, 19, 15, 21, 17, 21);
    shoulders(c);
  },
  hat: (c) => {
    E(c, 16, 16, 6, 8);
    L(c, 6, 10, 26, 10);
    L(c, 10, 10, 11, 4, 21, 4, 22, 10);
    L(c, 13, 14, 15, 19);
    L(c, 18, 15, 20, 20);
    L(c, 25, 31, 29, 23);
    L(c, 27, 32, 31, 25);
    shoulders(c);
  },
  blank: (c) => {
    E(c, 16, 15, 6, 8);
    A(c, 16, 12, 7, 1, 2);
    L(c, 9, 12, 9, 18);
    L(c, 23, 12, 23, 18);
    L(c, 13, 14, 14, 14);
    L(c, 18, 14, 19, 14);
    L(c, 15, 19, 17, 19);
    L(c, 27, 22, 27, 31);
    shoulders(c);
  },
  leather: (c) => {
    L(c, 10, 8, 13, 6, 16, 8, 19, 6, 22, 8, 23, 16, 21, 22, 16, 24, 11, 22, 9, 16, 10, 8);
    L(c, 11, 13, 21, 13);
    D(c, 12, 12, 14, 12, 16, 12, 18, 12, 20, 12);
    L(c, 13, 19, 19, 19);
    L(c, 22, 28, 31, 19);
    L(c, 24, 30, 31, 23);
    shoulders(c);
  },
  doll: (c) => {
    E(c, 16, 13, 5, 5);
    L(c, 11, 10, 9, 6);
    L(c, 14, 8, 13, 4);
    L(c, 18, 8, 19, 4);
    L(c, 21, 10, 23, 6);
    D(c, 14, 13, 18, 13);
    L(c, 17, 15, 20, 16);
    L(c, 11, 25, 11, 32);
    L(c, 21, 25, 21, 32);
    L(c, 11, 25, 21, 25);
    A(c, 16, 35, 10, 1.15, 1.85);
  },
  pins: (c) => {
    E(c, 16, 15, 6, 8);
    L(c, 10, 11, 22, 11);
    L(c, 10, 15, 22, 15);
    L(c, 10, 19, 22, 19);
    L(c, 13, 7, 13, 23);
    L(c, 16, 7, 16, 23);
    L(c, 19, 7, 19, 23);
    shoulders(c);
  },
  ghost: (c) => {
    c.beginPath();
    c.moveTo(16, 5);
    c.bezierCurveTo(25, 5, 23, 20, 16, 25);
    c.bezierCurveTo(9, 20, 7, 5, 16, 5);
    c.stroke();
    E(c, 13, 12, 1.6, 3);
    E(c, 19, 12, 1.6, 3);
    E(c, 16, 19, 1.4, 3);
    A(c, 16, 15, 11, 0.9, 2.1);
    shoulders(c);
  },
  clown: (c) => {
    E(c, 16, 14, 6, 7);
    L(c, 10, 10, 5, 8, 7, 12, 4, 14, 9, 15);
    L(c, 22, 10, 27, 8, 25, 12, 28, 14, 23, 15);
    D(c, 13, 12, 19, 12, 16, 15);
    A(c, 16, 15, 4, 0.15, 0.85);
    L(c, 14, 9, 16, 11, 18, 9);
    L(c, 4, 31, 7, 27, 10, 31, 13, 27, 16, 31, 19, 27, 22, 31, 25, 27, 28, 31);
  },
  hook: (c) => {
    E(c, 16, 13, 5, 7);
    eyes(c);
    L(c, 7, 32, 11, 20, 16, 27, 21, 20, 25, 32);
    L(c, 27, 32, 27, 25);
    A(c, 29, 25, 2, 1, 2);
  },
  girl: (c) => {
    E(c, 16, 14, 6, 8);
    for (const x of [9, 11, 13, 16, 19, 21, 23])
      L(c, x, x === 16 ? 6 : 8, x, 30 - Math.abs(16 - x) / 2);
    D(c, 17, 15);
  },
  hair: (c) => {
    E(c, 16, 13, 5, 7);
    cap(c);
    L(c, 10, 11, 9, 24, 12, 26);
    L(c, 22, 11, 23, 24, 20, 26);
    eyes(c);
    L(c, 15, 17, 17, 17);
    L(c, 27, 29, 29, 21);
    shoulders(c);
  },
  pony: (c) => {
    E(c, 16, 13, 5, 7);
    cap(c);
    L(c, 21, 8, 26, 6, 27, 15);
    eyes(c);
    L(c, 15, 17, 17, 17);
    shoulders(c);
  },
  short: (c) => {
    E(c, 16, 14, 5, 7);
    A(c, 16, 12, 6, 0.95, 2.05);
    L(c, 10, 12, 11, 16);
    L(c, 22, 12, 21, 16);
    eyes(c);
    L(c, 12, 26, 16, 30, 20, 26);
    shoulders(c);
  },
  chin: (c) => {
    L(c, 11, 8, 21, 8, 22, 16, 20, 22, 16, 24, 12, 22, 10, 16, 11, 8);
    L(c, 11, 8, 14, 5, 17, 7, 20, 5, 21, 8);
    D(c, 14, 14, 18, 14);
    L(c, 24, 32, 24, 24, 31, 20);
    L(c, 26, 32, 26, 27, 31, 24);
    shoulders(c);
  },
  straw: (c) => {
    L(c, 3, 12, 16, 3, 29, 12, 3, 12);
    E(c, 16, 17, 5, 5);
    D(c, 14, 17, 18, 17);
    L(c, 9, 32, 13, 23);
    L(c, 23, 32, 19, 23);
    L(c, 13, 23, 16, 26, 19, 23);
  },
  cross: (c) => {
    E(c, 16, 13, 5, 7);
    cap(c);
    eyes(c);
    L(c, 16, 24, 16, 31);
    L(c, 13, 27, 19, 27);
    shoulders(c);
  },
} satisfies Record<string, Draw>;

export type Kind = keyof typeof PORTRAITS;
export type PortraitOpts = { ring?: string; ring2?: boolean; dead?: boolean };

export function portrait(
  canvas: HTMLCanvasElement,
  kind: Kind,
  color: string,
  opts: PortraitOpts = {},
): void {
  const layers: Layer[] = [];
  const r = opts.ring2 ? 11.5 : 13.5;
  if (opts.ring)
    layers.push([
      opts.ring,
      (c) => {
        A(c, 16, 16, 15, 0, 2);
        if (opts.ring2) A(c, 16, 16, 12.8, 0, 2);
      },
    ]);
  layers.push([
    opts.dead ? css("--dim") : color,
    (c) => {
      if (opts.ring) {
        c.beginPath();
        c.arc(16, 16, r, 0, TAU);
        c.clip();
      }
      PORTRAITS[kind](c);
    },
  ]);
  if (opts.dead)
    layers.push([
      css("--blood"),
      (c) => {
        L(c, 7, 7, 25, 25);
        L(c, 25, 7, 7, 25);
      },
    ]);
  paint(canvas, 32, 32, layers);
}
