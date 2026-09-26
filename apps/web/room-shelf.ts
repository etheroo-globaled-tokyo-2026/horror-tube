import * as THREE from "three";
import { S, type Character } from "./game.ts";
import { ctx2d, rgb } from "./sprites.ts";
import { COL, RAMP } from "./room-palette.ts";
import {
  basic, box, lambert, lit, metalTex, pixel, r, rough, tex, veneer,
} from "./room-materials.ts";
import { camera, renderer, scene, textTex } from "./room-render.ts";
import { LOW, num, T, W8, wrap, Z, walkRef, type G } from "./room-state.ts";

export const VW = 320,
  VH = 544;
export const tapeCanvas = document.createElement("canvas");
tapeCanvas.width = VW;
tapeCanvas.height = VH;
export const tapeTex = textTex(new THREE.CanvasTexture(tapeCanvas));
tapeTex.colorSpace = THREE.SRGBColorSpace;
tapeTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
export const plastic = lambert({ map: metalTex(COL.soot) });
export const tapeFaces: THREE.Material[] = [
  plastic,
  plastic,
  plastic,
  plastic,
  basic({ map: tapeTex }),
  plastic,
];
export const tape = box(0.2, 0.34, 0.04, tapeFaces);
tape.rotation.set(-0.12, 0.26, 0.06);
camera.add(tape);
export const TAPE = { key: "", id: -1, at: 0, up: 0 };
export function drawTape(ch: Character): void {
  const g = ctx2d(tapeCanvas),
    hue = ch.alive ? COL.rust : COL.grime,
    seen = ch.fights > 0;
  g.textBaseline = "alphabetic";
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, VW, VH);
  const inset = (VW - 24) / VW;
  g.save();
  g.translate(12, (VH - VH * inset) / 2);
  g.scale(inset, inset);
  g.fillRect(0, 0, VW, VH);
  g.strokeStyle = hue;
  g.lineWidth = 8;
  g.strokeRect(4, 4, VW - 8, VH - 8);
  g.fillStyle = hue;
  g.fillRect(0, 0, VW, 44);
  g.fillStyle = COL.soot;
  g.textAlign = "left";
  g.font = "700 20px Silkscreen";
  g.fillText("HORROR TUBE", 16, 30);
  g.textAlign = "right";
  g.fillText(num(ch.id + 1), VW - 16, 30);
  g.imageSmoothingEnabled = false;
  g.drawImage(tinted(ch), VW / 2 - 70, 56, 140, 140);
  g.textAlign = "center";
  g.fillStyle = COL.bone;
  g.font = "28px DotGothic16";
  g.fillText(ch.name, VW / 2, 232);
  g.fillStyle = COL.sulfur;
  g.font = "700 16px Silkscreen";
  g.fillText(
    seen ? `KILLS ${ch.kills} · DAMAGE ${ch.damage}` : "KILLS ?? · DAMAGE ??",
    VW / 2,
    262,
  );
  g.textAlign = "left";
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("CASE FILE", 24, 298);
  g.fillStyle = COL.bone;
  g.font = "18px DotGothic16";
  const y = wrap(g, ch.brief, 24, 324, VW - 48, 23);
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("INJURIES", 24, y + 8);
  g.fillStyle = ch.injuries ? COL.bone : COL.grime;
  g.font = "18px DotGothic16";
  wrap(g, ch.injuries || "None.", 24, y + 34, VW - 48, 23);
  g.textAlign = "center";
  g.fillStyle = COL.grime;
  g.font = "700 12px Silkscreen";
  g.fillText("BE KIND · REWIND", VW / 2, VH - 18);
  if (!ch.alive) {
    g.save();
    g.translate(VW / 2, 150);
    g.rotate(-0.2);
    g.strokeStyle = g.fillStyle = COL.blood;
    g.lineWidth = 4;
    g.strokeRect(-110, -28, 220, 48);
    g.font = "700 28px Silkscreen";
    g.fillText("DECEASED", 0, 8);
    g.restore();
  }
  g.restore();
  g.strokeStyle = COL.grime;
  g.lineWidth = 1;
  g.strokeRect(3.5, 3.5, VW - 7, VH - 7);
  g.globalAlpha = 0.06;
  g.fillStyle = COL.bone;
  g.beginPath();
  g.moveTo(0, VH * 0.38);
  g.lineTo(VW, VH * 0.1);
  g.lineTo(VW, VH * 0.22);
  g.lineTo(0, VH * 0.5);
  g.fill();
  g.globalAlpha = 1;
  tapeTex.needsUpdate = true;
}
export function tapeResident(): Character | null {
  if (S.phase === "gate") return null;
  if ((S.phase === "vote" || S.phase === "countdown") && !S.cast) {
    if (T.reveal >= 0 && performance.now() < T.revealUntil) return S.chars[T.reveal] ?? null;
    if (T.buf.length === 2) return S.chars[+T.buf - 1] ?? null;
  }
  return S.chars[T.held] ?? null;
}

export const SHELF = { x: 0.88, z: -1.14, w: 0.8, h: 1.66, d: 0.28, rows: [1.3, 0.97] };
export const shelf = new THREE.Group();
shelf.position.set(SHELF.x, 0, SHELF.z);
shelf.rotation.y = -0.38;
scene.add(shelf);
export const shelfWood = rough(tex(128, 64, veneer(COL.rustDeep, [COL.grime])));
export const plank = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material = shelfWood,
): void => {
  const p = box(w, h, d, m);
  p.position.set(x, y, z);
  shelf.add(p);
};
for (const side of [-1, 1])
  plank(0.03, SHELF.h, SHELF.d, (side * (SHELF.w - 0.03)) / 2, SHELF.h / 2, 0);
plank(SHELF.w, 0.02, SHELF.d, 0, SHELF.h, 0);
plank(SHELF.w, SHELF.h, 0.01, 0, SHELF.h / 2, -SHELF.d / 2, lambert({ color: COL.soot }));
for (const y of [0.05, 0.5, ...SHELF.rows]) plank(SHELF.w - 0.06, 0.02, SHELF.d, 0, y - 0.01, 0);
export const SPINE = { w: 0.06, h: 0.25, d: 0.17, px: [40, 168] };
export const fillerTex = [0, 1, 2, 3].map((kind) =>
  tex(SPINE.px[0], SPINE.px[1], (g, w, h) => {
    g.fillStyle = kind === 2 ? COL.char : COL.soot;
    g.fillRect(0, 0, w, h);
    g.fillStyle = COL.char;
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, h - 3, w, 3);
    if (kind === 0) {
      g.fillRect(8, 20, w - 16, h - 40);
      g.fillStyle = COL.grime;
      g.fillRect(w / 2, 40, 2, 70);
    } else if (kind === 1) {
      g.fillStyle = COL.grime;
      g.fillRect(6, 10, w - 12, 20);
    } else if (kind === 2) {
      g.fillStyle = COL.rustDeep;
      g.fillRect(10, 30, w - 20, 90);
    } else {
      g.globalAlpha = 0.3;
      g.fillStyle = COL.bone;
      g.fillRect(7, 40, w - 14, 80);
      g.globalAlpha = 1;
      g.fillStyle = COL.soot;
      g.fillRect(w / 2 - 1, 50, 2, 56);
    }
  }),
);
export type Slot = {
  mesh: THREE.Mesh;
  id: number;
  home: THREE.Vector3;
  out: number;
  key: string;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  face: THREE.Material;
};
export const slots: Slot[] = [];
SHELF.rows.forEach((y, row) => {
  const end = (SHELF.w - 0.06) / 2;
  let x = -end + 0.004;
  let id = row * 5;
  const place = (w: number, h: number, face: THREE.Material): THREE.Mesh => {
    const m = box(w, h, SPINE.d, [plastic, plastic, plastic, plastic, face, plastic]);
    m.position.set(x + w / 2, y + h / 2, SHELF.d / 2 - SPINE.d / 2 - 0.015);
    shelf.add(m);
    x += w + 0.003;
    return m;
  };
  const filler = (): void => {
    place(
      Math.min(0.035 + r() * 0.025, end - x),
      SPINE.h - r() * 0.02,
      lit(fillerTex[(r() * 4) | 0]),
    );
  };
  for (const c of row ? "cfccfccf" : "fccfcfccf") {
    if (c === "f") {
      filler();
      continue;
    }
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = SPINE.px;
    const t = textTex(new THREE.CanvasTexture(canvas));
    pixel(t);
    const face = lit(t);
    const mesh = place(SPINE.w, SPINE.h, face);
    slots.push({
      mesh,
      id: id++,
      home: mesh.position.clone(),
      out: 0,
      key: "",
      canvas,
      tex: t,
      face,
    });
  }
  while (end - x > 0.03) filler();
});
export const tints = new Map<string, HTMLCanvasElement>();
export const tinted = (ch: Character): HTMLCanvasElement => {
  const key = ch.ens + ch.alive;
  const hit = tints.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = ctx2d(cv, { willReadFrequently: true });
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, 64, 64);
  g.drawImage(ch.icon, 0, 0, 64, 64);
  const img = g.getImageData(0, 0, 64, 64),
    d = img.data,
    ramp = ch.alive ? RAMP : [COL.soot, COL.char, COL.grime].map(rgb);
  for (let i = 0; i < d.length; i += 4) {
    const p = ((0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255) * (ramp.length - 1),
      k = Math.min(ramp.length - 2, p | 0),
      f = p - k;
    for (let c = 0; c < 3; c++) d[i + c] = ramp[k][c] + (ramp[k + 1][c] - ramp[k][c]) * f;
  }
  g.putImageData(img, 0, 0);
  tints.set(key, cv);
  return cv;
};
export const paperLabel = (g: G, x: number, y: number, w: number, h: number, alive: boolean): void => {
  g.fillStyle = alive ? COL.bone : COL.grime;
  g.fillRect(x, y, w, h);
  if (!alive) return;
  g.globalAlpha = 0.3;
  g.fillStyle = COL.sulfur;
  g.fillRect(x, y, w, h);
  g.globalAlpha = 0.12;
  g.fillStyle = COL.rust;
  g.fillRect(x, y + h - 6, w, 6);
  g.globalAlpha = 1;
};
export function drawSpine(slot: Slot, ch: Character): void {
  const g = ctx2d(slot.canvas),
    [w, h] = SPINE.px;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, w, h);
  g.fillStyle = COL.char;
  g.fillRect(0, 0, w, 3);
  g.fillRect(0, h - 3, w, 3);
  g.fillStyle = ch.alive ? COL.sulfur : COL.grime;
  g.fillRect(5, 8, w - 10, 24);
  g.fillStyle = COL.soot;
  g.font = "700 18px Silkscreen";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(num(ch.id + 1), w / 2, 21);
  paperLabel(g, 6, 38, w - 12, 90, ch.alive);
  g.save();
  g.translate(w / 2, 83);
  g.rotate(-Math.PI / 2);
  g.fillStyle = COL.soot;
  let size = 18;
  do g.font = `700 ${size--}px Silkscreen`;
  while (g.measureText(ch.short).width > 88 && size > 9);
  g.fillText(ch.short, 0, 1);
  if (!ch.alive)
    g.fillRect(-g.measureText(ch.short).width / 2 - 2, 0, g.measureText(ch.short).width + 4, 2);
  g.restore();
  g.drawImage(tinted(ch), 4, h - 38, 32, 32);
  slot.tex.needsUpdate = true;
}
export function updateShelf(shown: Character | null): void {
  shelf.visible = S.phase !== "gate" || W8.step === "done";
  for (const slot of slots) {
    const ch = S.chars[slot.id];
    slot.mesh.visible =
      shelf.visible &&
      !!ch &&
      shown !== ch &&
      !(
        (S.phase === "vote" || S.phase === "countdown") &&
        S.champion !== null &&
        ch.id === S.champion
      );
    if (!ch) continue;
    const key = ch.ens + ch.alive;
    if (slot.key !== key) drawSpine(slot, ch);
    slot.key = key;
    const out = T.hover === slot.id ? 1 : 0;
    slot.out = LOW ? out : slot.out + (out - slot.out) * 0.25;
    slot.mesh.position.set(
      slot.home.x,
      slot.home.y + slot.out * 0.01,
      slot.home.z + slot.out * 0.08,
    );
  }
}
export function updateTape(now: number): void {
  const ch = tapeResident();
  updateShelf(ch);
  if (ch) {
    const key = [ch.ens, ch.alive, ch.fights, ch.kills, ch.damage].join();
    if (ch.id !== TAPE.id) {
      TAPE.at = now;
      tapeFaces[0] = slots.find((s) => s.id === ch.id)?.face ?? plastic;
    }
    if (key !== TAPE.key) drawTape(ch);
    TAPE.key = key;
    TAPE.id = ch.id;
  }
  const up = ch ? 1 : 0;
  TAPE.up = LOW ? up : TAPE.up + (up - TAPE.up) * 0.12;
  const flip = LOW ? 1 : Math.min(1, (now - TAPE.at) / 380);
  tape.visible = TAPE.up > 0.01 && Z.at === null && walkRef.n < 0;
  tape.position.set(-0.34, -0.48 + TAPE.up * 0.48, -0.62);
  tape.rotation.y = 0.26 + Math.PI * (1 - flip) * (1 - flip);
}

