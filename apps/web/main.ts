import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import {
  $,
  S,
  char,
  face,
  usd,
  film,
  hooks,
  living,
  mmss,
  newSeason,
  odds,
  pick,
  replaying,
  type Character,
} from "./game.ts";
import { css, ctx2d, rgb } from "./sprites.ts";
import { type CoinBox, type CoinBoxPart, createCoinBox } from "./coinbox.ts";
import { getGameWallet } from "./wallet.ts";

const COIN_KEYS = new Map<string, CoinBoxPart>([
  ["d", "slot"],
  ["p", "sticker"],
  ["w", "lever"],
]);

const V = (n: string): string => css("--" + n);
const COL = {
  soot: V("soot"),
  char: V("char"),
  grime: V("grime"),
  rust: V("rust"),
  rustDeep: V("rust-deep"),
  blood: V("blood"),
  bloodDeep: V("blood-deep"),
  body: V("body"),
  coldDeep: V("cold-deep"),
  sulfur: V("sulfur"),
  bone: V("bone"),
};
const STAKES = [1, 3, 5];
const num = (n: number): string => String(n).padStart(2, "0");
const T = {
  buf: "",
  reveal: -1,
  revealUntil: 0,
  stake: 1,
  hold: -1,
  holdN: 0,
  say: "",
  sayUntil: 0,
  phase: "",
  held: -1,
  hover: -1,
};

const canvas = $("#view");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#view is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.soot);
scene.fog = new THREE.FogExp2(COL.soot, 0.2);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 8);
scene.add(camera);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera);
ao.updateGtaoMaterial({ radius: 0.5, thickness: 1, scale: 2, distanceExponent: 2 });
composer.addPass(ao);
composer.addPass(new OutputPass());
function size() {
  const w = innerWidth,
    h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = innerWidth / innerHeight;
  const wide = 16 / 9;
  camera.fov =
    camera.aspect >= wide
      ? 50
      : THREE.MathUtils.radToDeg(
          2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(25)) * wide) / camera.aspect),
        );
  camera.updateProjectionMatrix();
}
addEventListener("resize", size);
size();

let seedT = 7;
const r = () => (seedT = (seedT * 1664525 + 1013904223) >>> 0) / 2 ** 32;
type G = CanvasRenderingContext2D;
const speckle = (g: G, w: number, h: number, cols: string[], n: number): void => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0] ?? "";
    g.fillRect((r() * w) | 0, (r() * h) | 0, 1 + ((r() * 2) | 0), 1);
  }
};
const pixel = (t: THREE.Texture): void => {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
};
const tex = (
  w: number,
  h: number,
  draw: (g: G, w: number, h: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(ctx2d(c), w, h);
  const t = new THREE.CanvasTexture(c);
  pixel(t);
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
};
const grain = (g: G, w: number, y0: number, y1: number, cols: string[], n: number): void => {
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
const veneer =
  (base: string, lines: string[]) =>
  (g: G, w: number, h: number): void => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    grain(g, w, 0, h, lines, h / 6);
  };
const TEAK = veneer(COL.rustDeep, [COL.grime, COL.grime, COL.rust]);
const WALNUT = veneer(COL.grime, [COL.char]);
const planks = (g: G, w: number, h: number, size: number, base: string, lines: string[]): void => {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += size) {
    grain(g, w, y + 2, y + size - 1, lines, size / 6);
    g.fillStyle = COL.soot;
    g.fillRect(0, y, w, 1);
    g.fillRect((r() * w) | 0, y, 1, size);
  }
};
const bevel = (g: G, x: number, y: number, w: number, h: number, light: string): void => {
  g.fillStyle = light;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = COL.soot;
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
};
const wallTex = tex(
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
const floorTex = tex(128, 128, (g, w, h) => planks(g, w, h, 16, COL.char, [COL.soot]), [3, 3]);
const deskTex = tex(140, 72, (g, w, h) => {
  planks(g, w, h, 12, COL.grime, [COL.char]);
  for (const x of [12, 76]) {
    g.fillStyle = COL.grime;
    g.fillRect(x, 16, 52, 26);
    g.save();
    g.translate(x, 0);
    grain(g, 52, 18, 40, [COL.char], 4);
    g.restore();
    bevel(g, x, 16, 52, 26, COL.rustDeep);
    g.fillStyle = COL.rust;
    g.fillRect(x + 19, 26, 14, 3);
    g.fillStyle = COL.soot;
    g.fillRect(x + 19, 29, 14, 1);
  }
});
const tvFrontTex = tex(128, 100, (g, w, h) => {
  TEAK(g, w, h);
  g.fillStyle = COL.soot;
  for (let y = 58; y < 92; y += 4) g.fillRect(112, y, 13, 2);
  g.fillStyle = COL.rust;
  g.fillRect(112, 95, 13, 1);
});
const metalTex = (base: string): THREE.CanvasTexture =>
  tex(32, 32, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, [COL.soot, COL.grime], 12);
  });

const lambert = (o: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial(o);
const basic = (o: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial(o);
const rough = (map: THREE.Texture, bumpScale = 0.35): THREE.MeshLambertMaterial =>
  lambert({ map, bumpMap: map, bumpScale });
const shade = (root: THREE.Object3D): void =>
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial))
      o.castShadow = o.receiveShadow = true;
  });
const lit = (map: THREE.Texture): THREE.MeshLambertMaterial =>
  lambert({ map, emissiveMap: map, emissive: COL.bone, emissiveIntensity: 0.4 });
const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 16): THREE.Mesh =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

const wallM = rough(wallTex);
const back = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.8), wallM);
back.position.set(0, 1.4, -1.8);
scene.add(back);
for (const side of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.8), wallM);
  w.position.set(side * 2.2, 1.4, 0.2);
  w.rotation.y = (-side * Math.PI) / 2;
  scene.add(w);
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), rough(floorTex));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, 0.2);
scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), lambert({ color: COL.soot }));
ceil.rotation.x = Math.PI / 2;
ceil.position.set(0, 2.8, 0.2);
scene.add(ceil);
const pipe = cyl(0.05, 0.05, 4.4, lambert({ map: metalTex(COL.rustDeep) }), 8);
pipe.rotation.z = Math.PI / 2;
pipe.position.set(0, 2.55, -1.7);
scene.add(pipe);
const ambient = new THREE.AmbientLight(COL.coldDeep, 0.9);
scene.add(ambient);
const bulbLight = new THREE.PointLight(0xffd6a0, 4, 0, 2);
bulbLight.position.set(-0.3, 1.8, -0.75);
bulbLight.castShadow = true;
bulbLight.shadow.mapSize.set(512, 512);
bulbLight.shadow.bias = -0.004;
bulbLight.shadow.camera.near = 0.05;
bulbLight.shadow.camera.far = 8;
scene.add(bulbLight);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), basic({ color: COL.sulfur }));
bulb.position.copy(bulbLight.position);
scene.add(bulb);
const halo = new THREE.Points(
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
const wire = box(0.008, 1, 0.008, basic({ color: COL.soot }));
wire.position.set(bulb.position.x, 2.3, bulb.position.z);
scene.add(wire);
const walnut = rough(tex(128, 64, WALNUT));
const top = rough(tex(128, 128, (g, w, h) => planks(g, w, h, 24, COL.grime, [COL.char]), [2, 1]));
const table = box(1.4, 0.72, 0.8, [walnut, walnut, top, walnut, rough(deskTex), walnut]);
table.position.set(0, 0.36, -1.35);
scene.add(table);

const PW = 384,
  PH = 512;
const paperCanvas = document.createElement("canvas");
paperCanvas.width = PW;
paperCanvas.height = PH;
const pg = ctx2d(paperCanvas);
const paperTex = new THREE.CanvasTexture(paperCanvas);
paperTex.colorSpace = THREE.SRGBColorSpace;
paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const paper = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.4),
  lambert({ map: paperTex, transparent: true, alphaTest: 0.5 }),
);
paper.position.set(0, 0.74, -0.86);
paper.rotation.x = -1.25;
scene.add(paper);
const burnLight = new THREE.PointLight(COL.sulfur, 0, 1.2, 2);
burnLight.position.set(0, 0.85, -0.8);
scene.add(burnLight);
const LOW = matchMedia("(prefers-reduced-motion: reduce)").matches;
type Step = "read" | "ink" | "scan" | "signed" | "done" | "off" | "burn" | "dark";
type Waiver = { step: Step; at: number; ink: number };
const W8: Waiver = { step: "read", at: 0, ink: 0 };
const SCRIBBLE = Array.from({ length: 28 }, (_, i): [number, number] => [
  70 + i * 9,
  388 + Math.sin(i * 1.7) * 14 + Math.sin(i * 0.5) * 6,
]);
paper.renderOrder = 1;
let paperDrawn = false;
function drawPaper(now: number): void {
  const g = pg;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, PW, PH);
  g.fillStyle = COL.bone;
  g.fillRect(0, 0, PW, PH);
  seedT = 11;
  speckle(g, PW, PH, [COL.grime, COL.rust], 260);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = COL.blood;
  g.font = "700 38px Silkscreen";
  g.fillText("HORROR TUBE", 28, 62);
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

const TW = 640,
  TH = 480;
const tvCanvas = document.createElement("canvas");
tvCanvas.width = TW;
tvCanvas.height = TH;
const tvCtx = ctx2d(tvCanvas);
const tvTex = new THREE.CanvasTexture(tvCanvas);
tvTex.magFilter = THREE.LinearFilter;
tvTex.minFilter = THREE.LinearMipmapLinearFilter;
tvTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
tvTex.colorSpace = THREE.SRGBColorSpace;
const tv = new THREE.Group();
tv.position.set(0, 1.12, -1.4);
scene.add(tv);
const teak = rough(tex(128, 64, TEAK));
tv.add(box(1.02, 0.8, 0.72, [teak, teak, teak, teak, rough(tvFrontTex), teak]));
const bezel = box(0.86, 0.66, 0.02, lambert({ color: COL.soot }));
bezel.position.set(-0.06, 0, 0.36);
tv.add(bezel);
const crt = new THREE.PlaneGeometry(0.78, 0.585, 12, 9);
const cp = crt.getAttribute("position");
for (let i = 0; i < cp.count; i++) {
  const x = cp.getX(i) / 0.39,
    y = cp.getY(i) / 0.2925;
  cp.setZ(i, 0.018 * (1 - x * x) * (1 - y * y));
}
const screen = new THREE.Mesh(crt, basic({ map: tvTex, fog: false }));
screen.position.set(-0.06, 0, 0.372);
tv.add(screen);
const glass = new THREE.Mesh(
  crt,
  basic({
    map: tex(64, 48, (g, w, h) => {
      const hl = g.createRadialGradient(14, 10, 0, 14, 10, 40);
      hl.addColorStop(0, COL.bone);
      hl.addColorStop(1, COL.soot);
      g.globalAlpha = 0.12;
      g.fillStyle = hl;
      g.fillRect(0, 0, w, h);
    }),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
glass.position.set(-0.06, 0, 0.374);
tv.add(glass);
for (const y of [0.18, 0.02]) {
  const k = cyl(0.035, 0.035, 0.04, lambert({ color: COL.char }), 10);
  k.rotation.x = Math.PI / 2;
  k.position.set(0.44, y, 0.37);
  tv.add(k);
}
const tvGlow = new THREE.PointLight(COL.body, 1.2, 0, 2);
tvGlow.position.set(0, 1.1, -0.8);
scene.add(tvGlow);
const motes = new THREE.Points(
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
const drift = (t: number): void => {
  const p = motes.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) - 0.0004;
    p.setXYZ(i, p.getX(i) + Math.sin(t * 0.7 + i) * 0.0003, y < 0.7 ? 2.3 : y, p.getZ(i));
  }
  p.needsUpdate = true;
};

const label = (
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
const remote = new THREE.Group();
remote.position.set(0.31, -0.17, -0.62);
remote.rotation.set(-0.3, -0.22, -0.1);
remote.scale.setScalar(0.82);
camera.add(remote);
const shell = box(0.13, 0.36, 0.035, lambert({ map: metalTex(COL.char) }));
remote.add(shell);
const faceLight = new THREE.PointLight(0xffd6a0, 0.25, 0.8, 2);
faceLight.position.set(0.05, 0.05, 0.3);
remote.add(faceLight);
const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), basic({ color: COL.bloodDeep }));
led.position.set(0, 0.165, 0.019);
remote.add(led);
const keys: THREE.Mesh[] = [];
const keyById = new Map<string, THREE.Mesh>();
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
    basic({ map: label(text, bg, fg, Math.round(w * 3000), Math.round(h * 3000), font * 3) }),
    side,
  ]);
  m.position.set(x, y, 0.022);
  m.userData.keyId = id;
  remote.add(m);
  keys.push(m);
  keyById.set(id, m);
  return m;
};
key("A", "A", -0.03, 0.125, 0.05, 0.036, COL.bone, COL.soot, 22);
key("B", "B", 0.03, 0.125, 0.05, 0.036, COL.sulfur, COL.soot, 22);
key("-", "VOL−", -0.03, 0.08, 0.05, 0.026, COL.grime, COL.bone, 11);
key("+", "VOL+", 0.03, 0.08, 0.05, 0.026, COL.grime, COL.bone, 11);
const pad = [
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

const VW = 320,
  VH = 544;
const tapeCanvas = document.createElement("canvas");
tapeCanvas.width = VW;
tapeCanvas.height = VH;
const tapeTex = new THREE.CanvasTexture(tapeCanvas);
tapeTex.colorSpace = THREE.SRGBColorSpace;
tapeTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const plastic = lambert({ map: metalTex(COL.soot) });
const tapeFaces: THREE.Material[] = [
  plastic,
  plastic,
  plastic,
  plastic,
  basic({ map: tapeTex }),
  plastic,
];
const tape = box(0.2, 0.34, 0.04, tapeFaces);
tape.rotation.set(-0.12, 0.26, 0.06);
camera.add(tape);
const TAPE = { key: "", id: -1, at: 0, up: 0 };
function drawTape(ch: Character): void {
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
function tapeResident(): Character | null {
  if (S.phase === "gate") return null;
  if (S.phase === "vote" && !S.cast) {
    if (T.reveal >= 0 && performance.now() < T.revealUntil) return S.chars[T.reveal] ?? null;
    if (T.buf.length === 2) return S.chars[+T.buf - 1] ?? null;
  }
  return S.chars[T.held] ?? null;
}

const SHELF = { x: 0.88, z: -1.14, w: 0.8, h: 1.66, d: 0.28, rows: [1.3, 0.97] };
const shelf = new THREE.Group();
shelf.position.set(SHELF.x, 0, SHELF.z);
shelf.rotation.y = -0.38;
scene.add(shelf);
const shelfWood = rough(tex(128, 64, veneer(COL.rustDeep, [COL.grime])));
const plank = (
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
const SPINE = { w: 0.06, h: 0.25, d: 0.17, px: [40, 168] };
const fillerTex = [0, 1, 2, 3].map((kind) =>
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
type Slot = {
  mesh: THREE.Mesh;
  id: number;
  home: THREE.Vector3;
  out: number;
  key: string;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  face: THREE.Material;
};
const slots: Slot[] = [];
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
    const t = new THREE.CanvasTexture(canvas);
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
const tints = new Map<string, HTMLCanvasElement>();
const tinted = (ch: Character): HTMLCanvasElement => {
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
const paperLabel = (g: G, x: number, y: number, w: number, h: number, alive: boolean): void => {
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
function drawSpine(slot: Slot, ch: Character): void {
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
function updateShelf(shown: Character | null): void {
  shelf.visible = S.phase !== "gate" || W8.step === "done";
  for (const slot of slots) {
    const ch = S.chars[slot.id];
    slot.mesh.visible = shelf.visible && !!ch && shown !== ch;
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
function updateTape(now: number): void {
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
  tape.visible = TAPE.up > 0.01;
  tape.position.set(-0.34, -0.48 + TAPE.up * 0.48, -0.62);
  tape.rotation.y = 0.26 + Math.PI * (1 - flip) * (1 - flip);
}

const video = document.createElement("video");
video.src = "assets/demo-fight.mp4";
video.playsInline = true;
video.preload = "auto";
video.muted = true;
const small = document.createElement("canvas");
small.width = 160;
small.height = 120;
const sg = ctx2d(small, { willReadFrequently: true });
const RAMP = [COL.soot, COL.rustDeep, COL.rust, COL.bone].map(rgb);
let vidMode: "" | "live" | "rec" = "";
function syncVideo(): void {
  const mode = S.phase === "fight" ? "live" : replaying() ? "rec" : "";
  if (mode === vidMode) return;
  vidMode = mode;
  if (!mode) {
    video.pause();
    return;
  }
  video.currentTime = 0;
  video.loop = mode === "rec";
  video.muted = mode === "rec";
  video.play().catch(() => {
    video.muted = true;
    void video.play();
  });
}
function crop(sw0: number, sh0: number, dw: number, dh: number): [number, number, number, number] {
  let sw = sw0,
    sh = sw0 / (dw / dh);
  if (sh > sh0) {
    sh = sh0;
    sw = sh0 * (dw / dh);
  }
  return [(sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh];
}
function videoFrame(dx = 0, dy = 0, dw = TW, dh = TH): void {
  const w = 160,
    h = Math.round((160 * dh) / dw);
  if (small.height !== h) small.height = h;
  sg.drawImage(video, ...crop(832, 480, dw, dh), 0, 0, w, h);
  const img = sg.getImageData(0, 0, w, h),
    d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i] ?? 0,
      g0 = d[i + 1] ?? 0,
      b0 = d[i + 2] ?? 0,
      l = Math.min(1, Math.max(0, ((0.3 * r0 + 0.59 * g0 + 0.11 * b0) / 255 - 0.08) * 1.35)),
      p = l * 3,
      k = Math.min(2, p | 0),
      f = p - k,
      red = r0 > 110 && r0 > g0 * 1.8,
      lo = RAMP[k] ?? [],
      hi = RAMP[k + 1] ?? [];
    for (let c = 0; c < 3; c++) {
      const a = lo[c] ?? 0,
        warm = a + ((hi[c] ?? 0) - a) * f,
        v = d[i + c] ?? 0;
      d[i + c] = red ? warm * 0.4 + v * 0.6 : warm * 0.8 + v * 0.2;
    }
  }
  sg.putImageData(img, 0, 0);
  const g = tvCtx,
    sy = dh / h;
  g.imageSmoothingEnabled = false;
  if (Math.random() < 0.05) {
    const y = (Math.random() * (h - 10)) | 0;
    g.drawImage(small, 0, 0, w, y, dx, dy, dw, y * sy);
    g.drawImage(small, 0, y, w, 10, dx + 24, dy + y * sy, dw, 10 * sy);
    g.drawImage(small, 0, y + 10, w, h - y - 10, dx, dy + (y + 10) * sy, dw, (h - y - 10) * sy);
  } else g.drawImage(small, 0, 0, w, h, dx, dy, dw, dh);
}
function drawGuide(now: number): void {
  const g = tvCtx,
    W = TW,
    H = TH,
    top = 236;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, W, H);
  const filmCanvas = film();
  if (vidMode && video.readyState >= 2) videoFrame(0, 0, W, top);
  else if (S.last && filmCanvas.width) {
    g.imageSmoothingEnabled = false;
    g.drawImage(filmCanvas, ...crop(160, 90, W, top), 0, 0, W, top);
  } else {
    g.fillStyle = COL.char;
    g.fillRect(0, 0, W, top);
    g.textAlign = "center";
    g.font = "700 26px Silkscreen";
    g.fillStyle = COL.bone;
    g.fillText("NOTHING HAS AIRED YET", W / 2, top / 2 + 8);
  }
  if (S.last) {
    g.textAlign = "left";
    if ((now / 500) % 2 < 1) {
      g.fillStyle = COL.blood;
      g.beginPath();
      g.arc(34, 38, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.font = "700 24px Silkscreen";
    g.fillStyle = COL.bone;
    g.fillText("REC · LAST NIGHT", 52, 47);
  }
  g.fillStyle = COL.char;
  g.fillRect(0, top, W, H - top);
  g.fillStyle = COL.sulfur;
  g.fillRect(0, top, W, 32);
  g.fillStyle = COL.soot;
  g.textAlign = "left";
  g.font = "700 18px Silkscreen";
  g.fillText(S.cast ? "GOOD NIGHT." : "TONIGHT'S RESIDENTS", 16, top + 23);
  g.textAlign = "right";
  g.fillText(S.cast ? "YOUR PICKS ARE IN" : "TYPE A NUMBER", W - 16, top + 23);
  S.chars.forEach((ch, i) => {
    const x = i < 5 ? 12 : W / 2 + 6,
      y = top + 34 + (i % 5) * 42,
      mine = S.picks.includes(ch.id);
    if (mine) {
      g.fillStyle = COL.bone;
      g.fillRect(x - 6, y, W / 2 - 12, 40);
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(face(ch), x, y + 2, 36, 36);
    g.textAlign = "left";
    g.font = "700 20px Silkscreen";
    g.fillStyle = !ch.alive ? COL.grime : mine ? COL.soot : COL.sulfur;
    g.fillText(num(ch.id + 1), x + 44, y + 28);
    g.font = "22px DotGothic16";
    g.fillStyle = !ch.alive ? COL.rust : mine ? COL.soot : COL.bone;
    g.fillText(ch.name, x + 88, mine ? y + 22 : y + 28);
    if (!ch.alive) {
      g.fillStyle = COL.rust;
      g.fillRect(x + 86, y + 20, g.measureText(ch.name).width + 4, 2);
    }
    if (mine) {
      g.font = "700 12px Silkscreen";
      g.fillText("✓ PICKED", x + 88, y + 37);
    }
  });
}

const wrap = (g: G, text: string, x: number, y0: number, maxW: number, lh: number): number => {
  let y = y0;
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      y += lh;
      line = word;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
};
const say = (text: string, ms = 3600): void => {
  T.say = text;
  T.sayUntil = performance.now() + ms;
};

function drawTV(): void {
  const g = tvCtx,
    W = TW,
    H = TH,
    now = performance.now();
  g.imageSmoothingEnabled = false;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, W, H);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  let noise = S.phase === "fight" ? 0.18 : 0.06;
  const text = (
    t: string,
    y: number,
    size: number,
    color = COL.bone,
    face = "Silkscreen",
    weight = 700,
  ): void => {
    g.font = `${weight} ${size}px ${face}`;
    g.fillStyle = color;
    g.fillText(t, W / 2, y);
  };
  const fill = (color: string): void => {
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
  };
  const band = (y: number, h: number, color = COL.soot): void => {
    g.fillStyle = color;
    g.fillRect(0, y, W, h);
  };
  if (S.phase === "gate") {
    noise = 0.5;
    if (W8.step === "scan") {
      noise = 0.1;
      fill(COL.soot);
      const cell = 12,
        n = 25,
        ox = (W - n * cell) / 2,
        oy = 40;
      seedT = 23;
      g.fillStyle = COL.bone;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const finder = [
            [0, 0],
            [n - 7, 0],
            [0, n - 7],
          ].some(
            ([fx = 0, fy = 0]) =>
              x >= fx &&
              x < fx + 7 &&
              y >= fy &&
              y < fy + 7 &&
              (x === fx ||
                x === fx + 6 ||
                y === fy ||
                y === fy + 6 ||
                (x > fx + 1 && x < fx + 5 && y > fy + 1 && y < fy + 5)),
          );
          const inFinder = [
            [0, 0],
            [n - 7, 0],
            [0, n - 7],
          ].some(([fx = 0, fy = 0]) => x >= fx && x < fx + 8 && y >= fy && y < fy + 8);
          if (finder || (!inFinder && r() < 0.48))
            g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        }
      text("SCAN WITH WORLD APP", 380, 30, COL.sulfur);
      text("Orb only. We check it on our side.", 420, 24, COL.bone, "DotGothic16", 400);
    } else if (W8.step === "signed") {
      noise = 0.1;
      fill(COL.soot);
      text("VERIFIED", 210, 48, COL.blood);
      text("ONE HUMAN · 18+", 270, 26, COL.bone);
    } else if (W8.step === "done" && S.noteKind === "bad") {
      noise = 0.35;
      fill(COL.soot);
      text("NO SIGNAL", 210, 56, COL.blood);
      text("The residents did not answer.", 270, 26, COL.bone, "DotGothic16", 400);
    } else if (W8.step === "done") {
      noise = 0.12;
      const bars = [
        COL.bone,
        COL.sulfur,
        COL.rust,
        COL.rustDeep,
        COL.blood,
        COL.bloodDeep,
        COL.grime,
      ];
      bars.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect((i * W) / bars.length, 0, W / bars.length + 1, 300);
      });
      band(300, H - 300);
      text("PLEASE STAND BY", 370, 40, COL.bone);
      text(
        `tuning in${".".repeat(1 + (((now / 400) | 0) % 3))}`,
        420,
        24,
        COL.rust,
        "DotGothic16",
        400,
      );
    } else if (W8.step !== "read") {
      noise = 0;
      fill(COL.soot);
      const k = LOW ? 1 : Math.min(1, (now - W8.at) / 320);
      if (W8.step === "off" && k < 1) {
        const h = Math.max(2, H * (1 - k * 2)),
          w = k < 0.5 ? W : W * (1 - (k - 0.5) * 2);
        g.fillStyle = COL.bone;
        g.fillRect((W - w) / 2, (H - h) / 2, Math.max(4, w), h);
      }
    }
  } else if (S.view === 2) {
    fill(COL.char);
    text("RESIDENT RECORDS", 42, 26);
    g.textAlign = "left";
    g.font = "20px DotGothic16";
    S.chars.forEach((c, i) => {
      g.fillStyle = c.alive ? COL.bone : COL.rust;
      g.fillText(
        `${num(c.id + 1)} ${c.ens.split(".")[0]}${c.alive ? "" : " †"}`,
        i < 16 ? 24 : 336,
        80 + (i % 16) * 24,
      );
    });
  } else if (S.phase === "vote" && !S.cast && (T.buf || (T.reveal >= 0 && now < T.revealUntil))) {
    fill(COL.soot);
    noise = 0.14;
    if (T.reveal >= 0 && now < T.revealUntil) {
      const ch = char(T.reveal);
      text(`RESIDENT ${num(ch.id + 1)}`, 150, 30, COL.sulfur);
      text(ch.name.toUpperCase(), 230, 44, COL.blood);
      text(S.picks.length === 2 ? "THANK YOU. GOOD NIGHT." : "ONE MORE.", 330, 26);
    } else {
      text(`${T.buf.padEnd(2, "_")}`, 170, 110);
      const n = +T.buf,
        ch = T.buf.length === 2 ? S.chars[n - 1] : null;
      if (T.buf.length < 2) text("TYPE TWO DIGITS", 280, 24, COL.rust);
      else if (!ch) text("NO SUCH RESIDENT", 280, 28, COL.rust);
      else if (!ch.alive) text("THIS ROOM IS EMPTY", 280, 28, COL.rust);
      else if (S.picks.includes(ch.id)) text("YOU ALREADY ASKED FOR THEM", 280, 24, COL.rust);
      else {
        g.font = "24px DotGothic16";
        g.fillStyle = COL.bone;
        wrap(g, `“${ch.brief}”`, W / 2, 250, W - 100, 30);
        text("PRESS OK TO REQUEST", 420, 26, COL.sulfur);
      }
    }
  } else {
    const filmCanvas = film();
    if (S.phase === "vote") drawGuide(now);
    else if (vidMode && video.readyState >= 2) videoFrame();
    else if (filmCanvas.width) g.drawImage(filmCanvas, 20, 0, 120, 90, 0, 0, W, H);
    const [a, b] = (S.fighters || []).map(char);
    if (S.phase === "story") {
      fill(COL.soot);
      text("TONIGHT'S EPISODE IS BEING WRITTEN", 90, 20, COL.rust);
      g.textAlign = "left";
      g.font = "28px DotGothic16";
      g.fillStyle = COL.bone;
      const y = wrap(g, S.story, 60, 170, W - 120, 36);
      g.fillText("WINNER: ████████", 60, y + 10);
      g.fillText("DAMAGE: ██", 60, y + 46);
      g.textAlign = "center";
    } else if (S.phase === "bet") {
      fill(COL.bone);
      text("WHO WALKS OUT?", 80, 44, COL.soot);
      [a, b].forEach((ch, i) => {
        if (!ch) return;
        const x = i ? W * 0.74 : W * 0.26;
        g.fillStyle = i ? COL.sulfur : COL.char;
        g.fillRect(x - 130, 130, 260, 150);
        g.fillStyle = i ? COL.soot : COL.bone;
        g.font = "700 40px Silkscreen";
        g.fillText(i ? "B" : "A", x, 180);
        g.font = "700 26px Silkscreen";
        g.fillText(ch.short, x, 228);
        g.font = "24px DotGothic16";
        g.fillText(`pays ×${odds(i)}`, x, 264);
      });
      if (S.bet)
        text(
          `${S.bet.amt} USDC ON ${char(S.fighters?.[S.bet.side] ?? -1).short}. GOOD LUCK.`,
          360,
          26,
          COL.soot,
        );
      else if (S.credit <= 0) text("NO STAKE. FEED THE COIN BOX.", 360, 24, COL.soot);
      else {
        text(`STAKE ${STAKES[T.stake]} USDC  ·  VOL ± TO CHANGE`, 340, 24, COL.soot);
        text(
          T.hold >= 0 ? `${"▮".repeat(T.holdN)}${"▯".repeat(8 - T.holdN)}` : "HOLD A OR B TO BET",
          390,
          26,
          COL.bloodDeep,
        );
      }
      text(`closes in ${mmss(S.t)}`, 450, 20, COL.rustDeep, "DotGothic16", 400);
    } else if (S.phase === "fight") {
      if (!vidMode && S.frame % 28 >= 22) {
        fill(COL.soot);
        text("PLEASE STAND BY", H / 2, 36);
      }
    } else if (S.phase === "settle") {
      const w = char(S.fighters?.[S.winner] ?? -1),
        l = char(S.fighters?.[1 - S.winner] ?? -1);
      fill(COL.soot);
      band(60, 50, COL.blood);
      text("WE INTERRUPT THIS PROGRAM", 96, 24, COL.soot);
      text(l.name.toUpperCase(), 200, 40, COL.blood);
      text("has left the program.", 248, 28, COL.bone, "DotGothic16", 400);
      text(`${w.name} walks on, bleeding.`, 290, 28, COL.bone, "DotGothic16", 400);
      if (S.claim) text(`PRESS OK TO COLLECT ${usd(S.claim)} USDC`, 390, 26, COL.sulfur);
      else if (S.bet && S.result < 0) text(`YOU LOST ${usd(S.bet.amt)} USDC`, 390, 26, COL.rust);
    } else if (S.phase === "over") {
      fill(COL.soot);
      const l = living();
      text("END OF PROGRAMMING", 200, 34);
      text(
        l[0] ? `${l[0].name} is the last one left.` : "Nobody is left.",
        250,
        28,
        COL.bone,
        "DotGothic16",
        400,
      );
      text("PRESS OK TO START AGAIN", 350, 24, COL.sulfur);
    }
  }
  if (S.phase !== "gate" && T.say && now < T.sayUntil) {
    band(H - 80, 56);
    text(T.say, H - 42, 26, COL.bone, "DotGothic16", 400);
  }
  if (S.phase !== "gate") {
    g.globalAlpha = 0.8;
    g.textAlign = "right";
    g.font = "700 18px Silkscreen";
    g.fillStyle = S.phase === "bet" && S.view === 1 ? COL.soot : COL.bone;
    g.fillText(`${living().length} LEFT · ${usd(S.credit)} USDC`, W - 24, 40);
    g.globalAlpha = 1;
    g.textAlign = "center";
  }
  const img = g.getImageData(0, 0, W, H),
    d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * noise,
      dim = ((i / 4 / W) | 0) % 4 === 0;
    for (let c = i; c < i + 3; c++) {
      d[c] = (d[c] ?? 0) + n;
      if (dim) d[c] = (d[c] ?? 0) * 0.85;
    }
  }
  g.putImageData(img, 0, 0);
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  tvTex.needsUpdate = true;
}

function hintText(): void {
  const h = $("#hint");
  const b = (s: string): string => `<b>${s}</b>`;
  const hovered = S.chars[T.hover];
  h.innerHTML = hovered
    ? `${b(num(hovered.id + 1))} ${hovered.name}. Click to pull the tape.`
    : S.phase === "gate"
      ? W8.step === "read"
        ? `Read the waiver. Press ${b("ENTER")} or click the line to sign with World ID.`
        : W8.step === "scan"
          ? `Scan the code on the TV with ${b("World App")}. Orb only.`
          : W8.step === "done" && S.noteKind === "bad"
            ? `${S.note.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)} Reload to try again.`
            : W8.step === "done"
              ? "The TV is warming up."
              : ""
      : S.phase === "vote" && !S.cast
        ? `Pull a tape off the shelf to read it. Type its number, then ${b("OK")}. You pick two.`
        : S.phase === "bet" && !S.bet && S.credit > 0
          ? `${b("VOL ±")} changes your stake. ${b("Hold A or B")} to bet.`
          : S.claim
            ? `${b("OK")} collects your winnings.`
            : S.phase === "over"
              ? `${b("OK")} starts again.`
              : S.credit <= 0
                ? `No stake. Click the coin slot ${b("D")}, or the sticker ${b("P")} to pay by phone.`
                : "";
}

function press(id: string): void {
  const k = keyById.get(id);
  if (k) {
    k.position.z = 0.016;
    setTimeout(() => (k.position.z = 0.022), 120);
  }
  led.material.color.set(COL.blood);
  setTimeout(() => led.material.color.set(COL.bloodDeep), 120);
  if (S.phase === "gate") return;
  if (/^\d$/.test(id)) {
    if (S.phase === "vote" && !S.cast) {
      T.reveal = -1;
      T.buf = (T.buf.length >= 2 ? "" : T.buf) + id;
    }
  } else if (id === "clr") {
    T.buf = "";
    T.held = -1;
  } else if (id === "ok") ok();
  else if (id === "+" || id === "-") {
    if (S.phase === "bet" && !S.bet)
      T.stake = Math.max(0, Math.min(2, T.stake + (id === "+" ? 1 : -1)));
  }
  hintText();
}
function ok(): void {
  if (S.phase === "vote" && !S.cast && T.buf.length === 2) {
    const ch = S.chars[Number(T.buf) - 1];
    if (!ch || !ch.alive || S.picks.includes(ch.id)) return;
    pick(ch.id);
    T.buf = "";
    T.reveal = ch.id;
    T.revealUntil = performance.now() + 3200;
    if (S.picks.length === 2) $("#h-cast").click();
  } else if (S.claim) {
    $("#h-claim").click();
    say("Collected.");
  } else if (S.phase === "over") $("#h-reset").click();
}
let holdTimer = 0;
const stake = (): number => STAKES[T.stake] ?? 0;
const pressKey = (id: string, z: number): void => {
  const k = keyById.get(id);
  if (k) k.position.z = z;
};
function holdStart(side: number): void {
  if (S.phase !== "bet" || S.bet || holdTimer) return;
  if (stake() > S.credit)
    return say(S.credit <= 0 ? "No stake. Feed the coin box." : "Not enough for that stake.");
  T.hold = side;
  T.holdN = 0;
  pressKey(side ? "B" : "A", 0.016);
  holdTimer = window.setInterval(() => {
    T.holdN++;
    if (T.holdN >= 8) {
      holdEnd();
      S.side = side;
      S.amt = stake();
      $("#h-bet").click();
      hintText();
    }
  }, 100);
}
function holdEnd(): void {
  clearInterval(holdTimer);
  holdTimer = 0;
  T.hold = -1;
  T.holdN = 0;
  pressKey("A", 0.022);
  pressKey("B", 0.022);
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitAt = (e: MouseEvent): string | null => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!remote.visible) return null;
  const h = ray.intersectObjects(keys, false)[0];
  const id: string | undefined = h?.object.userData.keyId;
  return id ?? null;
};
const onShelf = (e: MouseEvent): THREE.Object3D | null => {
  if (S.phase === "gate") return null;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = slots.filter((s) => s.mesh.visible).map((s) => s.mesh);
  if (tape.visible) targets.push(tape);
  return ray.intersectObjects(targets, false)[0]?.object ?? null;
};
const slotOf = (o: THREE.Object3D | null): Slot | undefined => slots.find((s) => s.mesh === o);
const onPaper = (e: MouseEvent): boolean => {
  if (S.phase !== "gate" || W8.step !== "read" || !$("#gate").hidden) return false;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(paper, false).length > 0;
};

const store = <T>(fn: (s: Storage) => T): T | null => {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
};
function cut(fn: () => void): void {
  $("#cut").hidden = false;
  fn();
  setTimeout(() => ($("#cut").hidden = true), LOW ? 0 : 160);
}
function step(name: Step): void {
  W8.step = name;
  W8.at = performance.now();
  hintText();
}
function sign(): void {
  if (W8.step !== "read") return;
  step("ink");
  const t0 = performance.now();
  const inkTimer = setInterval(() => {
    W8.ink = Math.min(1, (performance.now() - t0) / 700);
    if (W8.ink < 1) return;
    clearInterval(inkTimer);
    step("scan");
    scanTimer = window.setTimeout(verified, 2800);
  }, 30);
}
let scanTimer = 0;
function verified(): void {
  step("signed");
  store((s) => s.setItem("ht.verified", "1"));
  setTimeout(() => cut(enterRoom), 1400);
}
function enterRoom(): void {
  step("done");
  paper.visible = false;
  $("#gate").hidden = true;
  void newSeason();
}
let coinBox: CoinBox | null = null;
let chainCredit = 0;
void getGameWallet().then((wallet) => {
  coinBox = createCoinBox(
    wallet,
    (usdc) => {
      S.credit += usdc - chainCredit;
      chainCredit = usdc;
      hintText();
    },
    say,
  );
  coinBox.group.position.set(-0.6, 0.87, -0.98);
  coinBox.group.scale.setScalar(1.05);
  coinBox.group.rotation.y = 0.55;
  shade(coinBox.group);
  scene.add(coinBox.group);
});
const coinPartAt = (e: MouseEvent): CoinBoxPart | null => {
  if (coinBox === null || !coinBox.group.visible) return null;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return coinBox.partAt(ray);
};
function noOrb(): void {
  if (W8.step !== "read" && W8.step !== "scan") return;
  clearTimeout(scanTimer);
  step("off");
  setTimeout(() => step("burn"), LOW ? 0 : 500);
  setTimeout(() => step("dark"), LOW ? 0 : 3100);
}
function retry(): void {
  cut(() => {
    W8.ink = 0;
    burnLight.intensity = 0;
    paperDrawn = false;
    step("read");
  });
}
$("#no-orb").addEventListener("click", noOrb);
$("#forget").addEventListener("click", () => {
  store((s) => s.removeItem("ht.verified"));
  location.reload();
});
const look = new THREE.Vector2();
let pointer: MouseEvent | null = null;
function updateHover(): void {
  const hover = pointer ? (slotOf(onShelf(pointer))?.id ?? -1) : -1;
  if (hover === T.hover) return;
  T.hover = hover;
  hintText();
}
addEventListener("pointermove", (e) => {
  pointer = e;
  look.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  canvas.classList.toggle(
    "hot",
    !!hitAt(e) || onPaper(e) || coinPartAt(e) !== null || !!onShelf(e),
  );
});
canvas.addEventListener("pointerdown", (e) => {
  if (onPaper(e)) return sign();
  const part = coinPartAt(e);
  if (part !== null) return coinBox?.use(part);
  const hit = onShelf(e);
  if (hit) {
    T.buf = "";
    T.reveal = -1;
    T.held = slotOf(hit)?.id ?? -1;
    T.hover = -1;
    return hintText();
  }
  const id = hitAt(e);
  if (!id) return;
  if (id === "A" || id === "B") holdStart(id === "B" ? 1 : 0);
  else press(id);
});
addEventListener("pointerup", holdEnd);
addEventListener(
  "keydown",
  (e) => {
    if (S.phase === "gate" && !e.metaKey && !e.ctrlKey && !e.altKey && $("#gate").hidden) {
      const k = e.key.toLowerCase();
      if (k === "enter" && W8.step === "read") sign();
      else if (k === "enter" && W8.step === "dark") retry();
      else if (k === "x") noOrb();
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (S.phase === "gate" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector("dialog[open]") !== null) return;
    const k = e.key.toLowerCase();
    const coinKey = COIN_KEYS.get(k);
    if (coinKey !== undefined && coinBox !== null) {
      e.preventDefault();
      e.stopPropagation();
      return coinBox.use(coinKey);
    }
    let id: string | null = null;
    if (/^\d$/.test(k)) id = k;
    else if (k === "enter") id = "ok";
    else if (k === "backspace" || k === "escape") id = "clr";
    else if (k === "+" || k === "=" || k === "arrowup") id = "+";
    else if (k === "-" || k === "arrowdown") id = "-";
    else if ((k === "a" || k === "b") && !e.repeat) {
      e.stopPropagation();
      return holdStart(k === "b" ? 1 : 0);
    }
    if (!id) return;
    e.stopPropagation();
    e.preventDefault();
    press(id);
  },
  true,
);
addEventListener("keyup", (e) => {
  if (e.key.toLowerCase() === "a" || e.key.toLowerCase() === "b") holdEnd();
});

shade(scene);
const clock = new THREE.Clock();
let lastPaint = 0;
let gaze = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const waiver = S.phase === "gate" && W8.step !== "done";
  const dark = waiver && W8.step === "dark";
  if (waiver) {
    camera.position.set(Math.sin(t * 0.6) * 0.006, 1.36 + Math.sin(t * 1.0) * 0.005, -0.12);
    const up = W8.step === "scan" ? 1 : 0;
    gaze = LOW ? up : gaze + (up - gaze) * 0.06;
    camera.lookAt(look.x * 0.06, 0.78 + gaze * 0.36 - look.y * 0.04, -0.98 - gaze * 0.42);
  } else {
    camera.position.set(
      0.1 + look.x * 0.05 + Math.sin(t * 0.6) * 0.008,
      1.2 - look.y * 0.03 + Math.sin(t * 1.0) * 0.006,
      0.28,
    );
    camera.lookAt(0.16 + look.x * 0.12, 1.02 - look.y * 0.06, -1.4);
  }
  remote.visible = !waiver;
  updateTape(performance.now());
  updateHover();
  if (coinBox !== null) coinBox.group.visible = !waiver;
  $("#demo-room").hidden = S.phase === "gate";
  $("#demo-gate").hidden = S.phase !== "gate" || dark;
  $("#no-orb").hidden = !waiver;
  $("#waiver-text").hidden = !waiver || dark;
  $("#dark").hidden = !dark;
  paper.visible = waiver && !dark;
  if (paper.visible && (W8.step !== "read" || !paperDrawn)) {
    drawPaper(performance.now());
    paperDrawn = true;
  }
  const lightsOut = waiver && (W8.step === "off" || W8.step === "burn" || dark);
  const flick = lightsOut ? 0 : Math.sin(t * 13) > 0.97 || Math.sin(t * 2.3 + 1) > 0.995 ? 0.3 : 1;
  ambient.intensity = dark ? 0 : lightsOut ? 0.1 : 0.35;
  bulbLight.intensity = 7 * flick;
  bulb.material.color.set(flick < 1 ? COL.grime : COL.bone);
  halo.material.opacity = 0.7 * flick;
  motes.material.opacity = 0.5 * flick * (lightsOut ? 0 : 1);
  if (!LOW) drift(t);
  tvGlow.intensity = lightsOut
    ? 0
    : S.phase === "fight"
      ? 1 + Math.random() * 0.5
      : S.phase === "bet"
        ? 1.4
        : 0.8;
  syncVideo();
  if (t - lastPaint > 0.083) {
    lastPaint = t;
    drawTV();
  }
  composer.render();
});

hooks.render = () => {
  if (S.phase === "gate") return hintText();
  if (T.phase !== S.phase) {
    const was = T.phase;
    T.phase = S.phase;
    T.buf = "";
    if (was === "vote" && !S.cast && S.phase === "story")
      say("You did not choose. Someone else did.", 4200);
    if (S.phase === "bet") T.stake = 1;
    holdEnd();
  }
  hintText();
};
void document.fonts.ready.then(() => {
  paperDrawn = false;
  TAPE.key = "";
  drawTV();
});
if (store((s) => s.getItem("ht.verified")) === "1") enterRoom();
hintText();
