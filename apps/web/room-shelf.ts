import * as THREE from "three";
import { S, type Character } from "./game.ts";
import { ctx2d, rgb } from "./sprites.ts";
import { COL, RAMP } from "./room-palette.ts";
import { basic, box, lambert, metalTex, rough, tex, veneer } from "./room-materials.ts";
import { camera, renderer, scene, textTex } from "./room-render.ts";
import { LOW, W8, Z, walkRef } from "./room-state.ts";

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
  const trim = ch.icon.naturalWidth * 0.06,
    side = ch.icon.naturalWidth - trim * 2;
  g.drawImage(ch.icon, trim, trim, side, side, 0, 0, 64, 64);
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
export const TAPE = {
  key: "",
  at: 0,
  up: 0,
  flat: 0,
  dragging: false,
  pointer: new THREE.Vector2(),
};
const HAND_Z = 0.62;
const lerp = THREE.MathUtils.lerp;
const handTurn = new THREE.Quaternion(),
  slotTurn = new THREE.Quaternion(),
  camTurn = new THREE.Quaternion(),
  intoSlot = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ),
  ),
  handEuler = new THREE.Euler();
export type InHand = { key: string; draw: () => void };
export function updateTape(now: number, held: InHand | null, deck: THREE.Object3D): void {
  shelf.visible = S.phase !== "gate" || W8.step === "done";
  if (held) {
    if (TAPE.key === "") TAPE.at = now;
    if (held.key !== TAPE.key) held.draw();
  }
  TAPE.key = held?.key ?? "";
  const up = held ? 1 : 0,
    flat = TAPE.dragging ? 1 : 0;
  TAPE.up = LOW ? up : TAPE.up + (up - TAPE.up) * 0.12;
  TAPE.flat = LOW ? flat : TAPE.flat + (flat - TAPE.flat) * 0.22;
  const flip = LOW ? 1 : Math.min(1, (now - TAPE.at) / 380),
    f = TAPE.flat * TAPE.flat * (3 - 2 * TAPE.flat),
    half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * HAND_Z;
  tape.visible = TAPE.up > 0.01 && Z.at === null && walkRef.n < 0;
  tape.position.set(
    lerp(-0.34, TAPE.pointer.x * half * camera.aspect, f),
    lerp(-0.48 + TAPE.up * 0.48, TAPE.pointer.y * half - 0.07, f),
    -HAND_Z,
  );
  handTurn.setFromEuler(handEuler.set(-0.12, 0.26 + Math.PI * (1 - flip) * (1 - flip), 0.06));
  deck.getWorldQuaternion(slotTurn).multiply(intoSlot);
  slotTurn.premultiply(camera.getWorldQuaternion(camTurn).invert());
  tape.quaternion.slerpQuaternions(handTurn, slotTurn, f);
}
