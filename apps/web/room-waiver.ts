import * as THREE from "three";
import { $, newSeason } from "./game.ts";
import { ctx2d } from "./sprites.ts";
import { drawLogoLine } from "./logo.ts";
import { fetchEnterRoomRequest, startEnterRoomProof, verifyEnterRoomProof } from "./world-id.ts";
import { openGameWallet } from "./wallet.ts";
import { sfx } from "./sfx.ts";
import { COL } from "./room-palette.ts";
import { lambert, seed, speckle } from "./room-materials.ts";
import { renderer, scene, textTex } from "./room-render.ts";
import { LOW, W8, type Step } from "./room-state.ts";
import { STOOL, stool } from "./room-shell.ts";

export const PW = 384,
  PH = 512;
export const paperCanvas = document.createElement("canvas");
paperCanvas.width = PW;
paperCanvas.height = PH;
export const pg = ctx2d(paperCanvas);
export const paperTex = textTex(new THREE.CanvasTexture(paperCanvas));
paperTex.colorSpace = THREE.SRGBColorSpace;
paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
export const paper = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.4),
  lambert({ map: paperTex, transparent: true, alphaTest: 0.5 }),
);
paper.position.set(STOOL.x, STOOL.top + 0.013, STOOL.z);
paper.rotation.x = -1.5;
scene.add(paper);
export const burnLight = new THREE.PointLight(COL.sulfur, 0, 1.2, 2);
burnLight.position.set(STOOL.x, STOOL.top + 0.11, STOOL.z + 0.05);
scene.add(burnLight);
export const SCRIBBLE = Array.from({ length: 28 }, (_, i): [number, number] => [
  70 + i * 9,
  388 + Math.sin(i * 1.7) * 14 + Math.sin(i * 0.5) * 6,
]);
paper.renderOrder = 1;
export const paperFlag = { drawn: false };
export function drawPaper(now: number): void {
  const g = pg;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, PW, PH);
  g.fillStyle = COL.bone;
  g.fillRect(0, 0, PW, PH);
  seed.t = 11;
  speckle(g, PW, PH, [COL.grime, COL.rust], 260);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  drawLogoLine(g, 28, 62, PW - 56);
  g.fillStyle = COL.rustDeep;
  g.font = "700 20px Silkscreen";
  g.fillText("READ BEFORE YOU WATCH", 28, 92);
  g.fillStyle = COL.soot;
  g.font = "27px DotGothic16";
  g.strokeStyle = COL.soot;
  g.lineWidth = 1.5;
  [
    "I am 18 or older.",
    "I am one person,",
    "with one vote.",
    "I will watch people die,",
    "and I will bet on it.",
    "I watch at my own risk.",
  ].forEach((l, i) => {
    g.fillText(l, 28, 138 + i * 38);
    g.strokeText(l, 28, 138 + i * 38);
  });
  g.fillStyle = COL.soot;
  g.fillRect(28, 402, PW - 56, 3);
  g.font = "700 26px Silkscreen";
  g.fillText("X", 30, 394);
  g.fillStyle = COL.rustDeep;
  g.font = "700 15px Silkscreen";
  g.fillText("SIGN WITH WORLD ID · ORB ONLY", 28, 430);
  if (W8.ink > 0) {
    g.strokeStyle = COL.soot;
    g.lineWidth = 3;
    g.beginPath();
    SCRIBBLE.slice(0, Math.ceil(W8.ink * SCRIBBLE.length)).forEach(([x, y], i) =>
      i ? g.lineTo(x, y) : g.moveTo(x, y),
    );
    g.stroke();
  }
  if (W8.step === "signed") {
    g.save();
    g.translate(270, 470);
    g.rotate(-0.18);
    g.strokeStyle = g.fillStyle = COL.blood;
    g.lineWidth = 4;
    g.strokeRect(-92, -28, 184, 48);
    g.font = "700 26px Silkscreen";
    g.textAlign = "center";
    g.fillText("VERIFIED", 0, 6);
    g.restore();
  }
  if (W8.step === "burn") {
    const k = LOW ? 1 : Math.min(1, (now - W8.at) / 2400),
      line = PH * (1 - k * 1.15);
    for (let x = 0; x < PW; x += 4) {
      const y = line + Math.sin(x * 0.07 + now * 0.004) * 14 + Math.sin(x * 0.23) * 8;
      g.clearRect(x, y, 4, PH - y);
      g.fillStyle = COL.soot;
      g.fillRect(x, y - 14, 4, 10);
      g.fillStyle = Math.random() < 0.5 ? COL.sulfur : COL.blood;
      g.fillRect(x, y - 4, 4, 4);
    }
    burnLight.intensity = k < 1 ? 0.35 + Math.random() * 0.35 : 0;
  }
  paperTex.needsUpdate = true;
}

type WaiverHooks = {
  hintText: () => void;
  walkTo: (n: number) => void;
  mountCoinBox: () => Promise<void>;
};
export const waiverHooks: WaiverHooks = {
  hintText: () => {
    throw new Error("waiverHooks.hintText not set");
  },
  walkTo: () => {
    throw new Error("waiverHooks.walkTo not set");
  },
  mountCoinBox: async () => {
    throw new Error("waiverHooks.mountCoinBox not set");
  },
};

export const store = <T>(fn: (s: Storage) => T): T | null => {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
};
export function cut(fn: () => void): void {
  sfx.static();
  $("#cut").hidden = false;
  fn();
  setTimeout(() => ($("#cut").hidden = true), LOW ? 0 : 160);
}
const STEP_SOUND = new Map<Step, () => void>([
  ["ink", () => sfx.pen(0.7)],
  ["scan", sfx.static],
  ["signed", sfx.stamp],
  ["off", sfx.tvOff],
  ["burn", () => sfx.burn(2.4)],
  ["dark", sfx.dark],
  ["done", sfx.tvOn],
]);
export function step(name: Step): void {
  W8.step = name;
  W8.at = performance.now();
  STEP_SOUND.get(name)?.();
  waiverHooks.hintText();
}
let scanAbort: AbortController | null = null;
export function sign(): void {
  if (W8.step !== "read") return;
  step("ink");
  const t0 = performance.now();
  const inkTimer = setInterval(() => {
    W8.ink = Math.min(1, (performance.now() - t0) / 700);
    if (W8.ink < 1) return;
    clearInterval(inkTimer);
    void beginWorldIdScan();
  }, 30);
}
export async function beginWorldIdScan(): Promise<void> {
  if (W8.step !== "ink" && W8.step !== "scan") return;
  scanAbort?.abort();
  scanAbort = new AbortController();
  const { signal } = scanAbort;
  W8.qrUri = "";
  step("scan");
  try {
    const context = await fetchEnterRoomRequest();
    if (signal.aborted) return;
    const proof = await startEnterRoomProof(context);
    if (signal.aborted) return;
    W8.qrUri = proof.connectorURI;
    waiverHooks.hintText();
    const idkitResult = await proof.wait();
    if (signal.aborted) return;
    await verifyEnterRoomProof(idkitResult);
    if (signal.aborted) return;
    await openGameWallet(JSON.stringify(idkitResult));
    if (signal.aborted) return;
    await waiverHooks.mountCoinBox();
    if (signal.aborted) return;
    verified();
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`World ID enter-room failed: ${message}`);
    scanFailed(message);
  }
}
function failLine(message: string): string {
  if (/nullifier_replayed|max_verifications_reached|already used/iu.test(message))
    return "This World ID already used its one entry.";
  if (/user_rejected|cancelled/iu.test(message)) return "The scan was cancelled.";
  if (/credential_unavailable/iu.test(message)) return "World App has no Orb credential.";
  return "The unique human scan failed.";
}
export function scanFailed(message: string): void {
  scanAbort?.abort();
  scanAbort = null;
  W8.qrUri = "";
  W8.fail = failLine(message);
  step("off");
}
export function verified(): void {
  step("signed");
  store((s) => s.setItem("ht.verified", "1"));
  window.setTimeout(() => {
    if (W8.step !== "signed") return;
    nextGateStep();
  }, 1400);
}
export function nextGateStep(): void {
  if (W8.fail !== "") return retry();
  if (W8.step === "signed")
    cut(() => {
      enterRoom();
      waiverHooks.walkTo(0);
    });
  else if (W8.step === "off") step("burn");
  else if (W8.step === "burn") step("dark");
  else if (W8.step === "dark") retry();
}
export function enterRoom(): void {
  step("done");
  paper.visible = false;
  stool.visible = false;
  $("#gate").hidden = true;
  void newSeason();
}
export function noOrb(): void {
  if (W8.step !== "read" && W8.step !== "scan") return;
  scanAbort?.abort();
  scanAbort = null;
  W8.qrUri = "";
  step("off");
}
export function retry(): void {
  cut(() => {
    W8.ink = 0;
    W8.qrUri = "";
    W8.fail = "";
    burnLight.intensity = 0;
    paperFlag.drawn = false;
    step("read");
  });
}
