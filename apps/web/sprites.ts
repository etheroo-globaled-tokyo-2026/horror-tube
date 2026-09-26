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
