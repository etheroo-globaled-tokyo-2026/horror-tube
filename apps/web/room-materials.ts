import * as THREE from "three";
import { ctx2d } from "./sprites.ts";
import { COL } from "./room-palette.ts";
import { renderer, scene } from "./room-render.ts";
import type { G } from "./room-state.ts";

export const seed = { t: 7 };
export const r = () => (seed.t = (seed.t * 1664525 + 1013904223) >>> 0) / 2 ** 32;
export const speckle = (g: G, w: number, h: number, cols: string[], n: number): void => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0] ?? "";
    g.fillRect((r() * w) | 0, (r() * h) | 0, 1 + ((r() * 2) | 0), 1);
  }
};
export const pixel = (t: THREE.Texture): void => {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
};
export const tex = (
  w: number,
  h: number,
  draw: (g: G, w: number, h: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  const paint = (): void => {
    const g = ctx2d(c);
    g.save();
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    g.restore();
    t.needsUpdate = true;
  };
  paint();
  void document.fonts.ready.then(paint);
  pixel(t);
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
};
export const grain = (g: G, w: number, y0: number, y1: number, cols: string[], n: number): void => {
  const k = 1 + ((r() * 2) | 0),
    ph = r() * 7;
  for (let i = 0; i < n; i++) {
    const y = y0 + ((i + r() * 0.7) / n) * (y1 - y0),
      a = 1 + r() * 2;
    g.fillStyle = cols[i % cols.length] ?? "";
    for (let x = 0; x < w; x++)
      g.fillRect(x, (y + Math.sin((x / w) * Math.PI * 2 * k + ph + i * 0.35) * a) | 0, 1, 1);
  }
};
export const veneer =
  (base: string, lines: string[]) =>
  (g: G, w: number, h: number): void => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    grain(g, w, 0, h, lines, h / 6);
  };
export const TEAK = veneer(COL.rustDeep, [COL.grime, COL.grime, COL.rust]);
export const planks = (g: G, w: number, h: number, size: number, base: string, lines: string[]): void => {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += size) {
    grain(g, w, y + 2, y + size - 1, lines, size / 6);
    g.fillStyle = COL.soot;
    g.fillRect(0, y, w, 1);
    g.fillRect((r() * w) | 0, y, 1, size);
  }
};
export const bevel = (g: G, x: number, y: number, w: number, h: number, light: string): void => {
  g.fillStyle = light;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = COL.soot;
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
};
export const wallTex = tex(
  128,
  256,
  (g, w, h) => {
    const rail = 172;
    g.fillStyle = COL.char;
    g.fillRect(0, 0, w, rail);
    g.globalAlpha = 0.18;
    g.fillStyle = COL.sulfur;
    for (let x = 0; x < w; x += 32) {
      g.fillRect(x, 0, 2, rail);
      for (let y = x % 64 ? 16 : 0; y < rail; y += 32) {
        g.fillRect(x + 16, y - 3, 1, 7);
        g.fillRect(x + 13, y, 7, 1);
        g.fillRect(x + 15, y - 1, 3, 3);
      }
    }
    g.fillStyle = COL.soot;
    for (let y = 0; y < 70; y++) {
      g.globalAlpha = 0.8 * (1 - y / 70);
      g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 2; i++) {
      const sx = 24 + r() * 80,
        sy = 30 + r() * 70,
        rx = 7 + r() * 8,
        ry = 9 + r() * 10;
      g.fillStyle = COL.rustDeep;
      g.globalAlpha = 0.14;
      for (let b = 0; b < 7; b++) {
        g.beginPath();
        g.arc(sx + (r() - 0.5) * rx * 2, sy + (r() - 0.5) * ry * 2, 3 + r() * rx, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.4;
      for (let d = 0; d < 2; d++) g.fillRect((sx - rx / 2 + r() * rx) | 0, sy, 1, 30 + r() * 90);
    }
    g.globalAlpha = 1;
    g.fillStyle = COL.rust;
    g.fillRect(0, rail, w, 2);
    g.fillStyle = COL.rustDeep;
    g.fillRect(0, rail + 2, w, 6);
    g.fillStyle = COL.soot;
    g.fillRect(0, rail + 8, w, h - rail - 8);
    for (const x of [0, 64]) {
      g.fillStyle = COL.char;
      g.fillRect(x + 6, rail + 16, 52, h - rail - 36);
      bevel(g, x + 6, rail + 16, 52, h - rail - 36, COL.grime);
    }
    g.fillStyle = COL.rustDeep;
    g.fillRect(0, h - 12, w, 1);
  },
  [4, 1],
);
export const floorTex = tex(128, 128, (g, w, h) => planks(g, w, h, 16, COL.char, [COL.soot]), [3, 3]);
export const label = (
  text: string,
  bg: string,
  fg: string,
  w = 64,
  h = 48,
  font = 26,
): THREE.CanvasTexture =>
  tex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `700 ${font}px Silkscreen`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
  });
export const metalTex = (base: string): THREE.CanvasTexture =>
  tex(32, 32, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, [COL.soot, COL.grime], 12);
  });

export const lambert = (o: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial(o);
export const basic = (o: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial(o);
export const rough = (map: THREE.Texture, bumpScale = 0.35): THREE.MeshLambertMaterial =>
  lambert({ map, bumpMap: map, bumpScale });
export const shade = (root: THREE.Object3D): void =>
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial))
      o.castShadow = o.receiveShadow = true;
  });
export const lit = (map: THREE.Texture): THREE.MeshLambertMaterial =>
  lambert({ map, emissiveMap: map, emissive: COL.bone, emissiveIntensity: 0.4 });
export const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
export const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 16): THREE.Mesh =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

export const strut = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  r0: number,
  r1: number,
  m: THREE.Material,
): THREE.Mesh => {
  const s = cyl(r1, r0, a.distanceTo(b), m, 8);
  s.position.copy(a).add(b).multiplyScalar(0.5);
  s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return s;
};
export const TV_Y = 1;
export const legM = lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.45) });
export const brassM = lambert({
  color: new THREE.Color(COL.sulfur).lerp(new THREE.Color(COL.rustDeep), 0.45),
});
export const leg = (
  top: THREE.Vector3,
  foot: THREE.Vector3,
  r: number,
  parent: THREE.Object3D = scene,
): void => {
  const tip = foot.clone().lerp(top, 0.08);
  parent.add(strut(top, tip, r, r * 0.55, legM), strut(tip, foot, r * 0.55, r * 0.45, brassM));
};

