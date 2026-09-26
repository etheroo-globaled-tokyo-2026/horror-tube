import { COL } from "./room-palette.ts";
import type { Ctx } from "./sprites.ts";

type Line = [text: string, size: number, baseline: number];

const font = (size: number): string => `700 ${size}px Silkscreen`;

function measure(g: Ctx, t: string) {
  g.font = font(100);
  const m = g.measureText(t);
  return { width: m.width / 100, cap: m.actualBoundingBoxAscent / 100 };
}

function signal(
  g: Ctx,
  cx: number,
  width: number,
  lines: Line[],
  tear: [y: number, h: number],
  glow: boolean,
): void {
  const ghost = width * 0.012,
    shift = width * 0.028,
    far = 1e5;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const [color, dx] of [
    [COL.cold, -ghost],
    [COL.blood, 0],
  ] as const) {
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = glow && color === COL.blood ? width * 0.016 : 0;
    for (const torn of [false, true]) {
      g.save();
      g.beginPath();
      if (torn) g.rect(-far, tear[0], 2 * far, tear[1]);
      else {
        g.rect(-far, -far, 2 * far, far + tear[0]);
        g.rect(-far, tear[0] + tear[1], 2 * far, far);
      }
      g.clip();
      for (const [t, size, y] of lines) {
        g.font = font(size);
        g.fillText(t, cx + dx + (torn ? shift : 0), y);
      }
      g.restore();
    }
  }
  g.restore();
}

export function drawLogo(g: Ctx, cx: number, cy: number, width: number, glow = true): void {
  const a = measure(g, "HORROR"),
    b = measure(g, "TUBE"),
    s1 = width / a.width,
    s2 = width / b.width,
    c1 = s1 * a.cap,
    c2 = s2 * b.cap,
    gap = c1 / 3,
    y1 = cy - (c1 + gap + c2) / 2 + c1,
    y2 = y1 + gap + c2;
  signal(
    g,
    cx,
    width,
    [
      ["HORROR", s1, y1],
      ["TUBE", s2, y2],
    ],
    [y2 - c2 * 0.59, c2 * 0.19],
    glow,
  );
}

export function drawLogoLine(
  g: Ctx,
  x: number,
  baseline: number,
  width: number,
  glow = false,
): void {
  const m = measure(g, "HORROR TUBE"),
    size = width / m.width,
    cap = size * m.cap;
  signal(
    g,
    x + width / 2,
    width,
    [["HORROR TUBE", size, baseline]],
    [baseline - cap * 0.6, cap * 0.22],
    glow,
  );
}
