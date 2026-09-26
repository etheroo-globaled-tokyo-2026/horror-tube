import * as THREE from "three";
import { $ } from "./game.ts";
import { COL } from "./room-palette.ts";
import { basic, box, lambert, tex, TV_Y } from "./room-materials.ts";
import { camera, renderer, scene } from "./room-render.ts";
import { LOW } from "./room-state.ts";
import { blotch, crack, ctx2d, drip, seeded } from "./sprites.ts";
import { preload, sample, sfx } from "./sfx.ts";

const OFF = 2800,
  GONE = 6000,
  FEED = 6600,
  TURN = 7500,
  LOOK = 8600,
  FACE = 9500,
  END = 11000;
const SOUND = {
  breath: new URL("./assets/scare/breath.mp3", import.meta.url).href,
  glitch: new URL("./assets/scare/glitch.mp3", import.meta.url).href,
  riser: new URL("./assets/scare/riser.mp3", import.meta.url).href,
  whisper: new URL("./assets/scare/whisper.mp3", import.meta.url).href,
  scream: new URL("./assets/scare/scream.mp3", import.meta.url).href,
};
preload(Object.values(SOUND));
const faceImg = new Image();
faceImg.src = new URL("./assets/scare/face.jpg", import.meta.url).href;
faceImg.onerror = () => console.error(`Scare face ${faceImg.src} failed to load`);
const scareEl = ((el: HTMLElement): HTMLCanvasElement => {
  if (!(el instanceof HTMLCanvasElement)) throw new Error("#scare is not a canvas");
  return el;
})($("#scare"));
const SW = 320,
  SH = 180;
scareEl.width = SW;
scareEl.height = SH;
const sg = ctx2d(scareEl);
export type PowerStage = "" | "off" | "feed" | "turn" | "look" | "face" | "black";
let at = -1;
let cue = 0;
let onEnd = (): void => {};

const shadow = lambert({ color: COL.soot });
const skin = lambert({
  color: new THREE.Color().setScalar(0.6),
  map: tex(256, 128, (g, w, h) => {
    const vr = seeded(66);
    g.fillStyle = COL.bone;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) blotch(g, vr, vr() * w, vr() * h, 10 + vr() * 24, COL.grime, 0.35);
    for (let i = 0; i < 8; i++)
      crack(g, vr, vr() * w, vr() * h, 20 + vr() * 30, vr() * 6, COL.soot);
    for (const x of [47, 81]) drip(g, vr, x, 58, 34 + vr() * 20, 4, COL.bloodDeep, 0.9);
    drip(g, vr, 64, 80, 40, 6, COL.bloodDeep, 0.9);
  }),
});
const hollow = basic({ color: COL.soot });

const viewer = new THREE.Group();
const vHead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lambert({ color: COL.grime }));
vHead.position.set(0.1, 1.16, 0.34);
const vBody = box(0.44, 0.6, 0.25, lambert({ color: COL.grime }));
vBody.position.set(0.1, 0.8, 0.42);
viewer.add(vHead, vBody);
viewer.visible = false;
scene.add(viewer);

const it = new THREE.Group();
const hips = new THREE.Group();
hips.position.set(0.18, 0.9, 1.2);
const torso = box(0.26, 0.78, 0.14, shadow);
torso.position.y = 0.39;
hips.add(torso);
const arms = [-1, 1].map((side) => {
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.16, 0.74, 0);
  const arm = box(0.045, 0.95, 0.045, shadow);
  arm.position.y = -0.47;
  shoulder.add(arm);
  hips.add(shoulder);
  return shoulder;
});
for (const side of [-1, 1]) {
  const leg = box(0.07, 0.9, 0.07, shadow);
  leg.position.set(0.18 + side * 0.07, 0.45, 1.2);
  it.add(leg);
}
it.add(hips);
const head = new THREE.Group();
const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), skin);
skull.scale.set(0.85, 1.25, 0.9);
head.add(skull);
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), hollow);
  eye.position.set(side * 0.042, 0.035, 0.092);
  head.add(eye);
}
const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), hollow);
mouth.scale.set(0.9, 2.2, 0.5);
mouth.position.set(0, -0.075, 0.09);
head.add(mouth);
it.add(head);
it.visible = false;
scene.add(it);
const rim = new THREE.PointLight(COL.cold, 0, 3.5, 2);
rim.position.set(0.3, 2.2, 2.0);
scene.add(rim);

const FW = 160,
  FH = 120;
const feedCam = new THREE.PerspectiveCamera(50, FW / FH, 0.05, 8);
feedCam.position.set(0, TV_Y + 0.05, -1.05);
feedCam.lookAt(0.12, 1.45, 0.5);
const feedRT = new THREE.WebGLRenderTarget(FW, FH);
const px = new Uint8Array(FW * FH * 4);
const feed = document.createElement("canvas");
feed.width = FW;
feed.height = FH;
const fg = ctx2d(feed);
const img = fg.createImageData(FW, FH);
const LIFT_LINEAR_TO_SRGB = Uint8Array.from({ length: 256 }, (_, i) =>
  Math.round(255 * Math.min(1, (i / 255) * 4) ** (1 / 2.2)),
);
function renderFeed(): void {
  viewer.visible = true;
  renderer.setRenderTarget(feedRT);
  renderer.render(scene, feedCam);
  renderer.setRenderTarget(null);
  viewer.visible = false;
  renderer.readRenderTargetPixels(feedRT, 0, 0, FW, FH, px);
  const d = img.data;
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const s = ((FH - 1 - y) * FW + x) * 4,
        o = (y * FW + x) * 4,
        v = LIFT_LINEAR_TO_SRGB[(px[s] * 0.3 + px[s + 1] * 0.59 + px[s + 2] * 0.11) | 0];
      d[o] = v * 0.78;
      d[o + 1] = v;
      d[o + 2] = v * 0.8;
      d[o + 3] = 255;
    }
  fg.putImageData(img, 0, 0);
}

const cut = (hidden: boolean): void => void ($("#cut").hidden = hidden);
const CUES: [number, () => void][] = [
  [0, sfx.tvOff],
  [300, sfx.dark],
  [1200, () => sample(SOUND.breath, 1.4)],
  [OFF, sfx.tvOn],
  [OFF + 60, sfx.static],
  [GONE, () => sample(SOUND.glitch)],
  [FEED, () => sample(SOUND.riser, 0.7)],
  [TURN + 200, () => sample(SOUND.whisper, 1.6)],
  [LOOK, () => sample(SOUND.scream)],
  [FACE, () => cut(false)],
];

export const powerStage = (now: number): PowerStage => {
  if (at < 0) return "";
  const ms = now - at;
  return ms < OFF
    ? "off"
    : ms < FEED
      ? "feed"
      : ms < TURN
        ? "turn"
        : ms < LOOK
          ? "look"
          : ms < FACE
            ? "face"
            : ms < END
              ? "black"
              : "";
};

export function powerOff(done: () => void): void {
  if (at >= 0) return;
  at = performance.now();
  cue = 0;
  onEnd = done;
}

export function drawPower(g: CanvasRenderingContext2D, W: number, H: number, now: number): number {
  const stage = powerStage(now),
    ms = now - at;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, W, H);
  if (stage === "off") {
    collapse(g, W, H, LOW ? 1 : ms / 320);
    return 0;
  }
  if (stage === "black" || stage === "") return 0;
  renderFeed();
  g.drawImage(feed, 0, 0, W, H);
  g.textAlign = "left";
  g.font = "700 22px Silkscreen";
  g.fillStyle = COL.blood;
  if (((now / 500) | 0) % 2) g.fillText("● REC", 28, 44);
  g.fillStyle = COL.bone;
  g.textAlign = "right";
  g.fillText("UNATTENDED SET", W - 28, 44);
  g.textAlign = "center";
  if (ms > OFF + 1500) {
    g.font = "400 26px DotGothic16";
    g.fillText("Please remain in view.", W / 2, H - 42);
  }
  if (Math.abs(ms - GONE) < 160) return 0.9;
  if (stage === "look") return 0.02;
  return 0.22 + 0.3 * Math.min(1, (ms - OFF) / (FEED - OFF));
}

export function collapse(g: CanvasRenderingContext2D, W: number, H: number, k: number): void {
  if (k >= 1) return;
  const h = Math.max(2, H * (1 - k * 2)),
    w = k < 0.5 ? W : W * (1 - (k - 0.5) * 2);
  g.fillStyle = COL.bone;
  g.fillRect((W - w) / 2, (H - h) / 2, Math.max(4, w), h);
}

const ease = (k: number): number => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const v = new THREE.Vector3(),
  from = new THREE.Vector3();
let turned = false;
const yaw = (d: THREE.Vector3): number => Math.atan2(d.x, -d.z);
const pitch = (d: THREE.Vector3): number => Math.asin(d.y / d.length());
function drawScare(k: number): void {
  sg.fillStyle = COL.soot;
  sg.fillRect(0, 0, SW, SH);
  if (!LOW && Math.random() < 0.15) return;
  const z = 1 + 0.6 * (1 - (1 - k) ** 3),
    j = LOW ? 0 : (Math.random() - 0.5) * 40,
    w = faceImg.naturalWidth / z,
    h = faceImg.naturalHeight / z;
  sg.drawImage(
    faceImg,
    faceImg.naturalWidth * 0.53 - w / 2 + j,
    faceImg.naturalHeight * 0.55 - h / 2 + j * 0.6,
    w,
    h,
    0,
    0,
    SW,
    SH,
  );
  if (LOW) return;
  for (let i = 0; i < 5; i++) {
    const y = (Math.random() * SH) | 0,
      t = (2 + Math.random() * 12) | 0;
    sg.drawImage(scareEl, 0, y, SW, t, (Math.random() - 0.5) * 40, y, SW, t);
  }
  if (Math.random() < 0.3) {
    sg.globalCompositeOperation = "multiply";
    sg.fillStyle = COL.blood;
    sg.fillRect(0, 0, SW, SH);
    sg.globalCompositeOperation = "source-over";
  }
}
export function tickPower(now: number): PowerStage {
  if (at < 0) return "";
  const ms = now - at;
  while (cue < CUES.length && ms >= CUES[cue][0]) CUES[cue++][1]();
  const stage = powerStage(now);
  scareEl.hidden = stage !== "face";
  if (stage === "") {
    at = -1;
    turned = false;
    it.visible = false;
    rim.intensity = 0;
    cut(true);
    onEnd();
    return "";
  }
  it.visible = ms < GONE;
  rim.intensity = stage === "off" || stage === "black" ? 0 : 2.5;
  const lean = 0.3 * ease((ms - OFF) / (FEED - OFF));
  hips.rotation.x = -lean;
  for (const a of arms) a.rotation.x = -lean * 1.8;
  hips.updateWorldMatrix(true, false);
  hips.localToWorld(head.position.set(0, 0.98, 0));
  head.lookAt(ms < OFF + (FEED - OFF) * 0.65 ? vHead.position : feedCam.position);
  head.rotateZ(0.4);
  if (stage === "face") drawScare((ms - LOOK) / (FACE - LOOK));
  if (stage !== "turn" && stage !== "look" && stage !== "face") return stage;
  if (!turned) {
    camera.getWorldDirection(from);
    turned = true;
  }
  v.subVectors(head.position, camera.position);
  const k = LOW ? 1 : ease((ms - FEED) / (TURN - FEED)),
    y0 = yaw(from),
    y1 = yaw(v) < y0 ? yaw(v) + Math.PI * 2 : yaw(v),
    a = y0 + (y1 - y0) * k,
    b = pitch(from) + (pitch(v) - pitch(from)) * k;
  v.set(Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b));
  camera.lookAt(v.add(camera.position));
  return stage;
}
