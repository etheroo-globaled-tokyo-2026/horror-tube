import { drawLogo } from "./logo.ts";
import { BARS, COL } from "./room-palette.ts";
import { ctx2d } from "./sprites.ts";

function art(name: string, w: number, h: number, logoWidth: number): void {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = ctx2d(canvas);
  const glow = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
  glow.addColorStop(0, COL.char);
  glow.addColorStop(1, COL.soot);
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  const bar = Math.round(h * 0.06);
  BARS.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect((i * w) / BARS.length, 0, w / BARS.length + 1, bar);
  });
  drawLogo(g, w / 2, (h + bar) / 2, logoWidth);
  const line = Math.max(2, Math.round(h / 240));
  g.globalAlpha = 0.5;
  g.fillStyle = COL.soot;
  for (let y = 0; y < h; y += line * 2) g.fillRect(0, y, w, line);
  g.globalAlpha = 1;
  const link = document.createElement("a");
  link.download = `horror-tube-${name}.png`;
  link.href = canvas.toDataURL("image/png");
  link.append(canvas);
  document.body.append(link);
}

void document.fonts.load("700 100px Silkscreen").then(() => {
  art("logo-512", 512, 512, 416);
  art("cover-1280x720", 1280, 720, 760);
});
