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

export type Rand = () => number;
export const seeded = (seed: number): Rand => {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
};
const TAU2 = Math.PI * 2;

export function blotch(
  c: Ctx,
  rand: Rand,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
): void {
  c.fillStyle = color;
  c.globalAlpha = alpha;
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    c.arc(
      x + (rand() - 0.5) * size,
      y + (rand() - 0.5) * size,
      size * (0.15 + rand() * 0.35),
      0,
      TAU2,
    );
    c.fill();
  }
  c.globalAlpha = 1;
}

export function drip(
  c: Ctx,
  rand: Rand,
  x: number,
  y: number,
  len: number,
  width: number,
  color: string,
  alpha: number,
): void {
  c.fillStyle = color;
  const wobble = rand() * 6;
  for (let i = 0; i < len; i++) {
    c.globalAlpha = alpha * (1 - (i / len) * 0.7);
    c.fillRect(x + Math.sin(i * 0.12 + wobble) * 1.5, y + i, Math.max(1, width * (1 - i / len)), 1);
  }
  c.globalAlpha = 1;
}

export function crack(
  c: Ctx,
  rand: Rand,
  x: number,
  y: number,
  len: number,
  angle: number,
  color: string,
): void {
  const branches: [number, number, number][] = [];
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, y);
  let px = x,
    py = y,
    a = angle;
  for (let i = 0; i < len; i += 3) {
    a += (rand() - 0.5) * 0.9;
    px += Math.cos(a) * 3;
    py += Math.sin(a) * 3;
    c.lineTo(px, py);
    if (rand() < 0.1) branches.push([px, py, a + (rand() - 0.5) * 2]);
  }
  c.stroke();
  for (const [bx, by, ba] of branches) {
    c.beginPath();
    c.moveTo(bx, by);
    let qx = bx,
      qy = by,
      q = ba;
    for (let i = 0; i < len * 0.3; i += 3) {
      q += (rand() - 0.5) * 0.9;
      qx += Math.cos(q) * 3;
      qy += Math.sin(q) * 3;
      c.lineTo(qx, qy);
    }
    c.stroke();
  }
}

export function scratches(
  c: Ctx,
  rand: Rand,
  rect: [number, number, number, number],
  n: number,
  color: string,
  alpha: number,
): void {
  const [x, y, w, h] = rect;
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const sx = x + rand() * w,
      sy = y + rand() * h,
      a = rand() * TAU2,
      l = 3 + rand() * 18;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    c.stroke();
  }
  c.globalAlpha = 1;
}

export function screw(
  c: Ctx,
  rand: Rand,
  x: number,
  y: number,
  r: number,
  head: string,
  rust: string,
): void {
  blotch(c, rand, x, y, r * 3, rust, 0.25);
  drip(c, rand, x - 1, y + r, r * 6 + rand() * r * 8, 2, rust, 0.5);
  c.fillStyle = head;
  c.beginPath();
  c.arc(x, y, r, 0, TAU2);
  c.fill();
  c.strokeStyle = rust;
  c.lineWidth = 1;
  const a = rand() * Math.PI;
  c.beginPath();
  c.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
  c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  c.stroke();
}

export function burn(c: Ctx, x: number, y: number, r: number, dark: string, edge: string): void {
  c.fillStyle = edge;
  c.globalAlpha = 0.5;
  c.beginPath();
  c.ellipse(x, y, r * 1.6, r, 0, 0, TAU2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = dark;
  c.beginPath();
  c.ellipse(x, y, r, r * 0.6, 0, 0, TAU2);
  c.fill();
}
