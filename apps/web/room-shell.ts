import * as THREE from "three";
import { blotch, crack, scratches, seeded } from "./sprites.ts";
import { COL } from "./room-palette.ts";
import {
  basic,
  box,
  cyl,
  floorTex,
  lambert,
  leg,
  legM,
  metalTex,
  rough,
  r,
  strut,
  tex,
  TV_Y,
  wallTex,
} from "./room-materials.ts";
import { scene } from "./room-render.ts";

export const wallM = rough(wallTex);
export const back = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.8), wallM);
back.position.set(0, 1.4, -1.8);
scene.add(back);
for (const side of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.8), wallM);
  w.position.set(side * 2.2, 1.4, 0.2);
  w.rotation.y = (-side * Math.PI) / 2;
  scene.add(w);
}
export const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), rough(floorTex));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, 0.2);
scene.add(floor);
export const ceil = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), lambert({ color: COL.soot }));
ceil.rotation.x = Math.PI / 2;
ceil.position.set(0, 2.8, 0.2);
scene.add(ceil);
export const pipe = cyl(0.05, 0.05, 4.4, lambert({ map: metalTex(COL.rustDeep) }), 8);
pipe.rotation.z = Math.PI / 2;
pipe.position.set(0, 2.55, -1.7);
scene.add(pipe);
export const ambient = new THREE.AmbientLight(COL.coldDeep, 0.9);
scene.add(ambient);
export const bulbLight = new THREE.PointLight(0xffd6a0, 4, 0, 2);
bulbLight.position.set(-0.3, 1.8, -0.75);
bulbLight.castShadow = true;
bulbLight.shadow.mapSize.set(512, 512);
bulbLight.shadow.bias = -0.004;
bulbLight.shadow.camera.near = 0.05;
bulbLight.shadow.camera.far = 8;
scene.add(bulbLight);
export const bulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  basic({ color: COL.sulfur }),
);
bulb.position.copy(bulbLight.position);
scene.add(bulb);
export const halo = new THREE.Points(
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(bulbLight.position.toArray(), 3),
  ),
  new THREE.PointsMaterial({
    size: 0.45,
    map: tex(32, 32, (g, w, h) => {
      const glow = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      glow.addColorStop(0, COL.sulfur);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
    }),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  }),
);
scene.add(halo);
export const bulbCord = box(0.008, 1, 0.008, basic({ color: COL.soot }));
bulbCord.position.set(bulb.position.x, 2.3, bulb.position.z);
scene.add(bulbCord);
export const rails = [-1, 1].map((sx) => {
  const ends = [1, -1].map((sz): [THREE.Vector3, THREE.Vector3] => [
    new THREE.Vector3(sx * 0.4, TV_Y - 0.4, -1.4 + sz * 0.24),
    new THREE.Vector3(sx * 0.53, 0, -1.4 + sz * 0.37),
  ]);
  for (const [top, foot] of ends) leg(top, foot, 0.028);
  const [[f0, f1], [b0, b1]] = ends;
  const [front, back] = [f0.clone().lerp(f1, 0.6), b0.clone().lerp(b1, 0.6)];
  scene.add(strut(front, back, 0.009, 0.009, legM));
  return front.clone().lerp(back, 0.5);
});
scene.add(strut(rails[0], rails[1], 0.009, 0.009, legM));
export const STOOL = { x: 0, z: -0.75, top: 0.45 };
export const stool = new THREE.Group();
scene.add(stool);
export const cushion = cyl(
  0.18,
  0.17,
  0.06,
  rough(
    tex(128, 128, (g, w, h) => {
      const vr = seeded(51);
      g.fillStyle = COL.rustDeep;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) blotch(g, vr, vr() * w, vr() * h, 20 + vr() * 30, COL.grime, 0.3);
      for (let i = 0; i < 6; i++)
        crack(g, vr, vr() * w, vr() * h, 30 + vr() * 40, vr() * 6, COL.soot);
      blotch(g, vr, w * 0.72, h * 0.3, 16, COL.sulfur, 0.55);
      scratches(g, vr, [0, 0, w, h], 30, COL.grime, 0.5);
      g.strokeStyle = COL.soot;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
      g.stroke();
    }),
  ),
  16,
);
cushion.position.set(STOOL.x, STOOL.top - 0.03, STOOL.z);
stool.add(cushion);
for (let i = 0; i < 4; i++) {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  leg(
    new THREE.Vector3(STOOL.x + Math.cos(a) * 0.11, STOOL.top - 0.06, STOOL.z + Math.sin(a) * 0.11),
    new THREE.Vector3(STOOL.x + Math.cos(a) * 0.21, 0, STOOL.z + Math.sin(a) * 0.21),
    0.013,
    stool,
  );
}
export const motes = new THREE.Points(
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(
      Float32Array.from({ length: 660 }, (_, i) =>
        i % 3 === 0 ? -1.1 + r() * 2.4 : i % 3 === 1 ? 0.7 + r() * 1.6 : -1.7 + r() * 1.9,
      ),
      3,
    ),
  ),
  new THREE.PointsMaterial({
    color: COL.sulfur,
    size: 0.005,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  }),
);
scene.add(motes);
export const drift = (t: number): void => {
  const p = motes.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) - 0.0004;
    p.setXYZ(i, p.getX(i) + Math.sin(t * 0.7 + i) * 0.0003, y < 0.7 ? 2.3 : y, p.getZ(i));
  }
  p.needsUpdate = true;
};
