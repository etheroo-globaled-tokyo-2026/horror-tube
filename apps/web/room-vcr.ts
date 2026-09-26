import * as THREE from "three";
import { S, mmss, note, type Character } from "./game.ts";
import { fetchTapes } from "./round-client.ts";
import type { Tape } from "../server/src/types.ts";
import { blotch, ctx2d, scratches, seeded } from "./sprites.ts";
import { COL } from "./room-palette.ts";
import { box, lambert, lit, pixel } from "./room-materials.ts";
import { textTex } from "./room-render.ts";
import {
  plastic,
  shelf,
  SPINE,
  tapeCanvas,
  tapeTex,
  tinted,
  VH,
  VW,
  type InHand,
} from "./room-shelf.ts";
import { tv, video } from "./room-tv.ts";
import { boutNumber, fitFont, lines, LOW, num, reelById, VCR, wrap, type G } from "./room-state.ts";

let asked = 0;
export function refreshTapes(): void {
  const n = ++asked;
  fetchTapes()
    .then((tapes) => {
      if (n === asked) VCR.tapes = tapes;
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`GET /tapes failed: ${message}`);
      note(`THE TAPES DID NOT LOAD. ${message}`, "bad");
    });
}

const who = (label: string): Character | undefined => S.chars.find((c) => c.label === label);
const nameOf = (label: string): string => who(label)?.name ?? label;
const shortOf = (label: string): string => who(label)?.short ?? label.toUpperCase();
export const loserOf = (t: Tape): string =>
  t.fighters[0] === t.winner ? t.fighters[1] : t.fighters[0];
export const boutTitle = (t: Tape): string => `${shortOf(t.winner)} V ${shortOf(loserOf(t))}`;
const coverKey = (t: Tape): string =>
  [boutNumber(t), ...t.fighters.map((f) => `${nameOf(f)}${String(who(f)?.alive)}`)].join();

const DECK = { w: 0.42, h: 0.086, d: 0.3, px: [420, 86] };
const deckCanvas = document.createElement("canvas");
[deckCanvas.width, deckCanvas.height] = DECK.px;
const deckTex = textTex(new THREE.CanvasTexture(deckCanvas));
pixel(deckTex);
export const vcr = box(DECK.w, DECK.h, DECK.d, [
  plastic,
  plastic,
  plastic,
  plastic,
  lit(deckTex),
  plastic,
]);
vcr.position.set(-0.24, 0.405 + DECK.h / 2, 0.21);
tv.add(vcr);

let deckKey = "";
function drawDeck(now: number): void {
  const t = reelById(VCR.loaded);
  const display = t
    ? `PLAY ${mmss(Math.floor(video.currentTime))}`
    : ((now / 700) | 0) % 2
      ? "12:00"
      : "";
  const key = `${display}|${String(VCR.over)}`;
  if (key === deckKey) return;
  deckKey = key;
  const g = ctx2d(deckCanvas),
    [w, h] = DECK.px;
  g.fillStyle = COL.char;
  g.fillRect(0, 0, w, h);
  g.fillStyle = COL.grime;
  g.fillRect(0, 0, w, 2);
  g.fillStyle = COL.soot;
  g.fillRect(0, h - 2, w, 2);
  g.fillRect(34, 20, 200, 34);
  g.fillStyle = COL.grime;
  g.fillRect(34, 20, 200, 1);
  g.fillRect(34, 20, 1, 34);
  g.fillStyle = COL.char;
  g.fillRect(44, 34, 180, 3);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = COL.grime;
    g.fillRect(34 + i * 42, 62, 34, 10);
    g.fillStyle = COL.soot;
    g.fillRect(36 + i * 42, 64, 30, 6);
  }
  g.fillStyle = t ? COL.blood : COL.bloodDeep;
  g.beginPath();
  g.arc(250, 67, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COL.grime;
  g.font = "700 10px Silkscreen";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText("VIDEO CASSETTE RECORDER", 34, 14);
  g.fillStyle = COL.soot;
  g.fillRect(268, 20, 132, 40);
  g.fillStyle = COL.cold;
  g.font = "700 18px Silkscreen";
  g.textAlign = "center";
  g.fillText(display, 334, 47);
  if (VCR.over) {
    g.strokeStyle = COL.sulfur;
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  }
  deckTex.needsUpdate = true;
}

const PILES: [x: number, y: number, fits: number][] = [
  [-0.14, 0.97, 5],
  [0.14, 0.97, 5],
  [-0.14, 1.3, 5],
  [0.14, 1.3, 5],
  [-0.14, 0.5, 7],
  [0.14, 0.5, 7],
];
type Reel = {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  out: number;
  key: string;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
};
const jitter = seeded(41);
const piles: Reel[][] = PILES.map(([x, y, fits]) =>
  Array.from({ length: fits }, (_, level): Reel => {
    const canvas = document.createElement("canvas");
    [canvas.height, canvas.width] = SPINE.px;
    const t = textTex(new THREE.CanvasTexture(canvas));
    pixel(t);
    const mesh = box(SPINE.h, SPINE.w, SPINE.d, [
      plastic,
      plastic,
      plastic,
      plastic,
      lambert({ map: t, emissiveMap: t, emissive: COL.bone, emissiveIntensity: 0.15 }),
      plastic,
    ]);
    const home = new THREE.Vector3(
      x + (jitter() - 0.5) * 0.02,
      y + SPINE.w / 2 + level * (SPINE.w + 0.002),
      0.14 - SPINE.d / 2 - 0.015 + (jitter() - 0.5) * 0.02,
    );
    mesh.rotation.y = (jitter() - 0.5) * 0.08;
    mesh.position.copy(home);
    mesh.visible = false;
    shelf.add(mesh);
    return { mesh, home, out: 0, key: "", canvas, tex: t };
  }),
);
export const reels: Reel[] = piles.flat();
export const shownTapes = (): (Tape | undefined)[] => {
  const newest = VCR.tapes.slice(-reels.length).reverse();
  let taken = 0;
  return piles.flatMap((pile) => {
    const inPile = Math.max(0, Math.min(pile.length, newest.length - taken));
    const from = taken;
    taken += inPile;
    return pile.map((_, level) => (level < inPile ? newest[from + inPile - 1 - level] : undefined));
  });
};

const hash = (text: string): number =>
  [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function drawSpine(reel: Reel, t: Tape): void {
  const g = ctx2d(reel.canvas),
    [h, w] = SPINE.px,
    wr = seeded(hash(t.battleId));
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, w, h);
  scratches(g, wr, [0, 0, w, h], 12, COL.grime, 0.3);
  g.fillStyle = COL.char;
  g.fillRect(0, 0, 3, h);
  g.fillRect(w - 3, 0, 3, h);
  g.globalAlpha = 0.7;
  g.fillStyle = COL.sulfur;
  g.fillRect(5, 4, 27, h - 8);
  g.globalAlpha = 1;
  blotch(g, wr, 5 + wr() * 27, 4 + wr() * (h - 8), 8, COL.rustDeep, 0.3);
  g.fillStyle = COL.soot;
  g.font = "700 16px Silkscreen";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(num(boutNumber(t)), 19, h / 2 + 1);
  const lw = w - 44,
    lh = h - 8;
  g.save();
  g.translate(36 + lw / 2 + (wr() - 0.5) * 3, h / 2);
  g.rotate((wr() - 0.5) * 0.05);
  g.fillStyle = COL.bone;
  g.fillRect(-lw / 2, -lh / 2, lw, lh);
  g.globalAlpha = 0.55;
  g.fillStyle = COL.sulfur;
  g.fillRect(-lw / 2, -lh / 2, lw, lh);
  g.globalAlpha = 1;
  blotch(g, wr, (wr() - 0.5) * lw, (wr() - 0.5) * lh, 12 + wr() * 14, COL.rust, 0.18);
  g.globalAlpha = 0.45;
  g.strokeStyle = COL.rustDeep;
  g.lineWidth = 2;
  g.strokeRect(-lw / 2, -lh / 2, lw, lh);
  g.globalAlpha = 1;
  const line = (text: string, y: number, color: string): void => {
    let size = 18;
    do g.font = `${size--}px DotGothic16`;
    while (g.measureText(text).width > lw - 6 && size > 9);
    g.fillStyle = color;
    g.fillText(text, 0, y);
  };
  line(shortOf(t.winner), -7, COL.soot);
  line(`V ${shortOf(loserOf(t))}`, 9, COL.bloodDeep);
  scratches(g, wr, [-lw / 2, -lh / 2, lw, lh], 5, COL.grime, 0.35);
  g.restore();
  reel.tex.needsUpdate = true;
}

function face(g: G, label: string, x: number, won: boolean): void {
  const ch = who(label);
  g.fillStyle = COL.char;
  g.fillRect(x, 60, 120, 120);
  if (ch) g.drawImage(tinted(ch), x, 60, 120, 120);
  g.lineWidth = 4;
  g.strokeStyle = won ? COL.sulfur : COL.blood;
  if (won) g.strokeRect(x - 2, 58, 124, 124);
  else {
    g.beginPath();
    g.moveTo(x + 10, 70);
    g.lineTo(x + 110, 170);
    g.moveTo(x + 110, 70);
    g.lineTo(x + 10, 170);
    g.stroke();
  }
  g.fillStyle = won ? COL.sulfur : COL.grime;
  g.font = "700 16px Silkscreen";
  g.textAlign = "center";
  const short = shortOf(label);
  let size = 16;
  while (g.measureText(short).width > 130 && size > 8) g.font = `700 ${--size}px Silkscreen`;
  g.fillText(short, x + 60, 204);
}

function drawCover(t: Tape): void {
  const g = ctx2d(tapeCanvas),
    at = new Date(t.recordedAt);
  g.textBaseline = "alphabetic";
  g.imageSmoothingEnabled = false;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, VW, VH);
  g.strokeStyle = COL.blood;
  g.lineWidth = 8;
  g.strokeRect(4, 4, VW - 8, VH - 8);
  g.fillStyle = COL.blood;
  g.fillRect(0, 0, VW, 44);
  g.fillStyle = COL.soot;
  g.font = "700 16px Silkscreen";
  g.textAlign = "left";
  g.fillText("HORROR TUBE", 16, 29);
  g.textAlign = "right";
  g.fillText(`BOUT ${num(boutNumber(t))}`, VW - 16, 29);
  const [a, b] = t.fighters;
  face(g, a, 28, a === t.winner);
  face(g, b, 172, b === t.winner);
  g.fillStyle = COL.bone;
  g.font = "700 20px Silkscreen";
  g.textAlign = "center";
  g.fillText("V", VW / 2, 128);
  g.textAlign = "left";
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("WALKED OUT", 24, 238);
  g.fillStyle = COL.sulfur;
  g.font = "24px DotGothic16";
  wrap(g, nameOf(t.winner), 24, 266, VW - 48, 28);
  const injuries = t.injuries.join(", ") || "None recorded.",
    top = 312,
    bottom = VH - 40;
  const lh = fitFont(g, "DotGothic16", 18, 9, (lh) => {
    const n = lines(g, injuries, VW - 48).length + lines(g, t.rationale, VW - 48).length;
    return top + 26 + 34 + (n - 1) * lh <= bottom;
  });
  const body = g.font;
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("INJURIES", 24, top);
  g.fillStyle = COL.bone;
  g.font = body;
  let y = wrap(g, injuries, 24, top + 24, VW - 48, lh);
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("ON THE TAPE", 24, y + 10);
  g.fillStyle = COL.bone;
  g.font = body;
  y = wrap(g, t.rationale, 24, y + 34, VW - 48, lh);
  g.fillStyle = COL.grime;
  g.font = "700 12px Silkscreen";
  g.textAlign = "left";
  g.fillText(
    `REC ${num(at.getMonth() + 1)}.${num(at.getDate())} ${num(at.getHours())}:${num(at.getMinutes())}`,
    24,
    VH - 18,
  );
  g.textAlign = "right";
  g.fillText("SP", VW - 24, VH - 18);
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

export function updateVcr(now: number): InHand | null {
  const shown = shownTapes();
  reels.forEach((reel, i) => {
    const t = shown[i];
    reel.mesh.visible = t !== undefined && t.battleId !== VCR.held && t.battleId !== VCR.loaded;
    if (t === undefined) return;
    const key = coverKey(t);
    if (reel.key !== key) drawSpine(reel, t);
    reel.key = key;
    const out = VCR.hover === t.battleId ? 1 : 0;
    reel.out = LOW ? out : reel.out + (out - reel.out) * 0.25;
    reel.mesh.position.set(reel.home.x, reel.home.y, reel.home.z + reel.out * 0.07);
  });
  drawDeck(now);
  const held = reelById(VCR.held);
  if (held === undefined || S.phase === "gate") return null;
  return { key: `${held.battleId}|${coverKey(held)}`, draw: () => drawCover(held) };
}
