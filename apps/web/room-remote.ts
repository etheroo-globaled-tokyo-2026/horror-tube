import * as THREE from "three";
import { COL } from "./room-palette.ts";
import { basic, box, label, lambert, metalTex } from "./room-materials.ts";
import { camera, textTex } from "./room-render.ts";

export const remote = new THREE.Group();
remote.position.set(0.31, -0.17, -0.62);
remote.rotation.set(-0.3, -0.22, -0.1);
remote.scale.setScalar(0.82);
camera.add(remote);
export const shell = box(0.13, 0.36, 0.035, lambert({ map: metalTex(COL.char) }));
remote.add(shell);
export const faceLight = new THREE.PointLight(0xffd6a0, 0.25, 0.8, 2);
faceLight.position.set(0.05, 0.05, 0.3);
remote.add(faceLight);
export const led = new THREE.Mesh(
  new THREE.SphereGeometry(0.006, 6, 4),
  basic({ color: COL.bloodDeep }),
);
led.position.set(0, 0.165, 0.019);
remote.add(led);
export const keyById = new Map<string, THREE.Mesh>();
const key = (
  id: string,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: string,
  fg: string,
  font: number,
): THREE.Mesh => {
  const side = lambert({ color: bg });
  const m = box(w, h, 0.012, [
    side,
    side,
    side,
    side,
    basic({
      map: textTex(label(text, bg, fg, Math.round(w * 3000), Math.round(h * 3000), font * 3)),
    }),
    side,
  ]);
  m.position.set(x, y, 0.022);
  m.userData.keyId = id;
  remote.add(m);
  keyById.set(id, m);
  return m;
};
key("A", "A", -0.03, 0.125, 0.05, 0.036, COL.bone, COL.soot, 22);
key("B", "B", 0.03, 0.125, 0.05, 0.036, COL.sulfur, COL.soot, 22);
key("-", "VOL−", -0.03, 0.08, 0.05, 0.026, COL.grime, COL.bone, 11);
key("+", "VOL+", 0.03, 0.08, 0.05, 0.026, COL.grime, COL.bone, 11);
export const pad = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clr", "0", "ok"],
];
pad.forEach((row, ri) =>
  row.forEach((k, ci) => {
    const special = k === "ok" || k === "clr";
    key(
      k,
      k.toUpperCase(),
      -0.04 + ci * 0.04,
      0.035 - ri * 0.036,
      0.034,
      0.03,
      k === "ok" ? COL.rust : COL.grime,
      special ? COL.soot : COL.bone,
      special ? 11 : 20,
    );
  }),
);
