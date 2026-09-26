import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import {
  $,
  S,
  char,
  face,
  usd,
  film,
  hooks,
  living,
  newSeason,
  odds,
  pick,
  replaying,
  type Character,
  type Phase,
} from "./game.ts";
import { blotch, burn, crack, css, ctx2d, drip, rgb, scratches, screw, seeded } from "./sprites.ts";
import {
  COINS,
  type CoinBox,
  type CoinBoxPart,
  type CoinBoxView,
  createCoinBox,
} from "./coinbox.ts";
import QRCode from "qrcode";
import { getGameWallet, hasWalletSession, openGameWallet } from "./wallet.ts";
import { fetchEnterRoomRequest, startEnterRoomProof, verifyEnterRoomProof } from "./world-id.ts";
import { ambience, isMuted, sfx, toggleMute } from "./sfx.ts";

const COIN_KEYS = new Map<string, CoinBoxPart>([
  ["d", "slot"],
  ["p", "sticker"],
  ["w", "lock"],
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
type Focus = { at: CoinBoxView | null; pick: boolean; hover: CoinBoxPart | null; error: string };
const Z: Focus = {
  at: null,
  pick: false,
  hover: null,
  error: "",
};
type WalkStep = {
  say: string;
  view: () => [eye: THREE.Vector3, target: THREE.Vector3] | null;
  remote: boolean;
};
let walk = -1;
const esc = (text: string): string => text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
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
let ps1 = Number(localStorage.getItem("ps1") ?? 0.25);
let ps1Text = Number(localStorage.getItem("ps1Text") ?? 0.1);
const textTex = <T extends THREE.Texture>(t: T): T => {
  t.userData.text = true;
  return t;
};
const psSnap = { value: 0 };
THREE.ShaderChunk.common = "uniform float psSnap;\n" + THREE.ShaderChunk.common;
THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
  "gl_Position = projectionMatrix * mvPosition;",
  `gl_Position = projectionMatrix * mvPosition;
  if (psSnap > 0.0) gl_Position.xy = floor(gl_Position.xy / gl_Position.w * psSnap) / psSnap * gl_Position.w;`,
);
THREE.Material.prototype.onBeforeCompile = (shader) => {
  shader.uniforms.psSnap = psSnap;
};
const TEXT_LAYER = 1;
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
const levels = { value: 255 };
const dither = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, levels },
  vertexShader:
    "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
      uniform sampler2D tDiffuse; uniform float levels; varying vec2 vUv;
      const mat4 B = mat4(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
        float d = (B[p.x][p.y] / 16.0 - 0.5) / levels;
        gl_FragColor = vec4(floor((c.rgb + d) * levels + 0.5) / levels, c.a);
      }`,
});
dither.uniforms.levels = levels;
composer.addPass(dither);
composer.renderToScreen = false;
const textRT = new THREE.WebGLRenderTarget(1, 1, {
  magFilter: THREE.NearestFilter,
  minFilter: THREE.NearestFilter,
  type: THREE.HalfFloatType,
});
const blitMap = { value: new THREE.Texture() };
const blitLinear = { value: 0 };
const blit = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: { map: blitMap, linear: blitLinear },
    vertexShader:
      "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D map; uniform float linear; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (linear > 0.5 && c.a > 0.0) {
          vec3 l = clamp(c.rgb / c.a, 0.0, 1.0);
          c.rgb = mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)) * c.a;
        }
        gl_FragColor = clamp(c, 0.0, 1.0);
      }`,
    premultipliedAlpha: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }),
);
blit.frustumCulled = false;
const blitScene = new THREE.Scene().add(blit);
const blitCam = new THREE.Camera();
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
const snapFor = (v: number): number => (v < 0.05 ? 0 : THREE.MathUtils.lerp(600, 100, v));
const lowH = (v: number): number => Math.round(THREE.MathUtils.lerp(innerHeight, 180, v));
const isText = (m: THREE.Material): boolean =>
  "map" in m && m.map instanceof THREE.Texture && m.map.userData.text === true;
const clearColor = new THREE.Color();
function draw(): void {
  const text: THREE.Mesh[] = [];
  const seeThrough: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Light) o.layers.enable(TEXT_LAYER);
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.transparent)) seeThrough.push(o);
    if (mats.some(isText)) {
      o.layers.enable(TEXT_LAYER);
      text.push(o);
    } else o.layers.disable(TEXT_LAYER);
  });
  psSnap.value = snapFor(ps1);
  for (const m of text) m.visible = false;
  composer.render();
  for (const m of text) m.visible = true;
  blitMap.value = composer.readBuffer.texture;
  blitLinear.value = 0;
  blit.material.blending = THREE.NoBlending;
  renderer.setRenderTarget(null);
  renderer.render(blitScene, blitCam);
  psSnap.value = snapFor(ps1Text);
  const bg = scene.background;
  const clearAlpha = renderer.getClearAlpha();
  renderer.getClearColor(clearColor);
  scene.background = null;
  renderer.setRenderTarget(textRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.autoClear = false;
  scene.overrideMaterial = depthOnly;
  for (const m of seeThrough) m.visible = false;
  renderer.render(scene, camera);
  for (const m of seeThrough) m.visible = true;
  scene.overrideMaterial = null;
  camera.layers.set(TEXT_LAYER);
  renderer.render(scene, camera);
  camera.layers.set(0);
  scene.background = bg;
  renderer.setClearColor(clearColor, clearAlpha);
  renderer.setRenderTarget(null);
  blitMap.value = textRT.texture;
  blitLinear.value = 1;
  blit.material.blending = THREE.NormalBlending;
  renderer.render(blitScene, blitCam);
  renderer.autoClear = true;
}
function size() {
  const h = lowH(ps1),
    w = Math.round((h * innerWidth) / innerHeight),
    th = lowH(ps1Text);
  renderer.setSize(innerWidth, innerHeight, false);
  textRT.setSize(Math.round((th * innerWidth) / innerHeight), th);
  for (const t of [composer.renderTarget1.texture, composer.renderTarget2.texture])
    t.magFilter = THREE.NearestFilter;
  levels.value = THREE.MathUtils.lerp(255, 15, ps1);
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
for (const [id, get, set] of [
  ["ps1", () => ps1, (v: number) => (ps1 = v)],
  ["ps1Text", () => ps1Text, (v: number) => (ps1Text = v)],
] as const) {
  const el = $(`#${id}`);
  if (!(el instanceof HTMLInputElement)) continue;
  el.value = String(get());
  el.addEventListener("input", () => {
    set(Number(el.value));
    localStorage.setItem(id, el.value);
    size();
  });
}
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
const strut = (
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
const TV_Y = 1;
const legM = lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.45) });
const brassM = lambert({
  color: new THREE.Color(COL.sulfur).lerp(new THREE.Color(COL.rustDeep), 0.45),
});
const leg = (
  top: THREE.Vector3,
  foot: THREE.Vector3,
  r: number,
  parent: THREE.Object3D = scene,
): void => {
  const tip = foot.clone().lerp(top, 0.08);
  parent.add(strut(top, tip, r, r * 0.55, legM), strut(tip, foot, r * 0.55, r * 0.45, brassM));
};
const rails = [-1, 1].map((sx) => {
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
const STOOL = { x: 0, z: -0.75, top: 0.45 };
const stool = new THREE.Group();
scene.add(stool);
const cushion = cyl(
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

const PW = 384,
  PH = 512;
const paperCanvas = document.createElement("canvas");
paperCanvas.width = PW;
paperCanvas.height = PH;
const pg = ctx2d(paperCanvas);
const paperTex = textTex(new THREE.CanvasTexture(paperCanvas));
paperTex.colorSpace = THREE.SRGBColorSpace;
paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const paper = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.4),
  lambert({ map: paperTex, transparent: true, alphaTest: 0.5 }),
);
paper.position.set(STOOL.x, STOOL.top + 0.013, STOOL.z);
paper.rotation.x = -1.5;
scene.add(paper);
const burnLight = new THREE.PointLight(COL.sulfur, 0, 1.2, 2);
burnLight.position.set(STOOL.x, STOOL.top + 0.11, STOOL.z + 0.05);
scene.add(burnLight);
const LOW = matchMedia("(prefers-reduced-motion: reduce)").matches;
type Step = "read" | "ink" | "scan" | "signed" | "done" | "off" | "burn" | "dark";
type Waiver = { step: Step; at: number; ink: number; qrUri: string };
const W8: Waiver = { step: "read", at: 0, ink: 0, qrUri: "" };
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
const tvTex = textTex(new THREE.CanvasTexture(tvCanvas));
tvTex.magFilter = THREE.LinearFilter;
tvTex.minFilter = THREE.LinearMipmapLinearFilter;
tvTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
tvTex.colorSpace = THREE.SRGBColorSpace;
tvTex.repeat.set(0.78 / 0.74, 0.585 / 0.545);
tvTex.offset.set((1 - tvTex.repeat.x) / 2, (1 - tvTex.repeat.y) / 2);
const tv = new THREE.Group();
tv.position.set(0, TV_Y, -1.4);
scene.add(tv);
const teak = rough(
  tex(128, 64, (g, w, h) => {
    TEAK(g, w, h);
    const tr = seeded(17);
    g.strokeStyle = COL.grime;
    for (const [x, y, rad] of [
      [30, 22, 11],
      [37, 26, 10],
      [96, 40, 8],
    ]) {
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    scratches(g, tr, [0, 0, w, h], 30, COL.char, 0.6);
    scratches(g, tr, [0, 0, w, h], 12, COL.rust, 0.4);
  }),
);
const body = box(1.02, 0.8, 0.63, teak);
body.position.z = -0.045;
tv.add(body);
const ivory = lambert({
  map: tex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = COL.bone;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.45;
      g.fillStyle = COL.sulfur;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.1;
      g.fillStyle = COL.rust;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.arc(r() * w, r() * h, 4 + r() * 14, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      speckle(g, w, h, [COL.grime], 40);
    },
    [2, 2],
  ),
  color: new THREE.Color().setScalar(0.62),
});
const rounded = (
  p: THREE.Path | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: number,
): void => {
  p.moveTo(x + c, y);
  p.lineTo(x + w - c, y);
  p.quadraticCurveTo(x + w, y, x + w, y + c);
  p.lineTo(x + w, y + h - c);
  p.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  p.lineTo(x + c, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - c);
  p.lineTo(x, y + c);
  p.quadraticCurveTo(x, y, x + c, y);
};
const maskOutline = new THREE["Shape"]();
rounded(maskOutline, -0.505, -0.395, 1.01, 0.79, 0.02);
const hole = new THREE.Path();
rounded(hole, -0.47, -0.315, 0.82, 0.63, 0.08);
maskOutline.holes.push(hole);
const mask = new THREE.Mesh(
  new THREE.ExtrudeGeometry(maskOutline, {
    depth: 0.092,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 6,
  }),
  [ivory, ivory],
);
const MASK = { x: -0.505, y: -0.395, w: 1.01, h: 0.79, px: 600 };
const maskTex = tex(Math.round(MASK.w * MASK.px), Math.round(MASK.h * MASK.px), (g, w, h) => {
  const wr = seeded(13),
    at = (x: number, y: number): [number, number] => [
      (x - MASK.x) * MASK.px,
      (MASK.y + MASK.h - y) * MASK.px,
    ];
  g.fillStyle = COL.bone;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.5;
  g.fillStyle = COL.sulfur;
  g.fillRect(0, 0, w, h);
  g.fillStyle = COL.rust;
  for (let y = 0; y < h; y++) {
    g.globalAlpha = 0.28 * (1 - y / h) ** 2;
    g.fillRect(0, y, w, 1);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 10; i++) blotch(g, wr, wr() * w, wr() * h, 30 + wr() * 70, COL.rust, 0.07);
  const [hx, hy] = at(-0.47, 0.315);
  const hw = 0.82 * MASK.px,
    hh = 0.63 * MASK.px;
  for (const [lw, a, c] of [
    [22, 0.12, COL.grime],
    [12, 0.22, COL.grime],
    [5, 0.45, COL.soot],
  ] as const) {
    g.globalAlpha = a;
    g.strokeStyle = c;
    g.lineWidth = lw;
    g.beginPath();
    rounded(g, hx, hy, hw, hh, 0.08 * MASK.px);
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 4; i++)
    drip(g, wr, 30 + wr() * (w - 60), 0, 40 + wr() * 90, 4, COL.rustDeep, 0.35);
  for (const [x, y] of [
    [16, 16],
    [w - 16, 16],
    [16, h - 16],
    [w - 16, h - 16],
  ])
    screw(g, wr, x, y, 7, COL.grime, COL.rustDeep);
  crack(g, wr, hx + 6, hy + hh - 10, 90, 2.4, COL.soot);
  crack(g, wr, hx + hw - 8, hy + 10, 60, -0.7, COL.soot);
  scratches(g, wr, [0, 0, w, h], 90, COL.grime, 0.35);
  scratches(g, wr, [hx, hy + hh + 6, hw, h - hy - hh - 12], 40, COL.soot, 0.4);
  burn(g, hx + hw * 0.72, hy + hh + 34, 7, COL.soot, COL.rustDeep);
  burn(g, hx + hw * 0.8, hy + hh + 46, 5, COL.soot, COL.rustDeep);
  g.globalAlpha = 0.3;
  g.fillStyle = COL.bloodDeep;
  for (let f = 0; f < 4; f++) {
    const fx = w - 34 + f * 7;
    for (let y = 0; y < 150 + f * 20; y++)
      g.fillRect(fx + Math.sin(y * 0.05 + f) * 2, 190 + y, 4 - y / 90, 1);
  }
  g.globalAlpha = 1;
  const [gx, gy] = at(0.37, 0.35);
  const gw = 0.12 * MASK.px,
    gh = 0.7 * MASK.px,
    grilleH = 0.36 * MASK.px;
  g.fillStyle = COL.soot;
  g.beginPath();
  rounded(g, gx, gy, gw, gh, 8);
  g.fill();
  g.fillStyle = COL.grime;
  for (let y = gy + 8; y < gy + grilleH; y += 8)
    for (let x = gx + 7 + ((y / 8) % 2) * 4; x < gx + gw - 6; x += 8) g.fillRect(x, y, 3, 3);
  for (let x = gx + 6; x < gx + gw - 4; x += 6)
    g.fillRect(x, gy + grilleH + 10, 2, gh - grilleH - 18);
  g.save();
  g.translate(hx + 90, hy + hh + 26);
  g.scale(0.8, 0.8);
  g.rotate(-0.06);
  g.fillStyle = COL.bone;
  g.fillRect(-80, -15, 160, 30);
  g.globalAlpha = 0.45;
  g.fillStyle = COL.sulfur;
  g.fillRect(-80, -15, 160, 30);
  g.globalAlpha = 1;
  g.fillStyle = COL.soot;
  g.font = "18px DotGothic16";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("DON'T TURN IT OFF", 0, 1);
  g.restore();
});
maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
maskTex.repeat.set(1 / MASK.w, 1 / MASK.h);
maskTex.offset.set(-MASK.x / MASK.w, -MASK.y / MASK.h);
mask.material = [
  lambert({
    map: maskTex,
    bumpMap: maskTex,
    bumpScale: 0.35,
    color: new THREE.Color().setScalar(0.62),
  }),
  lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.28) }),
];
mask.position.z = 0.278;
tv.add(mask);
const loop = (x: number, y: number, w: number, h: number, c: number): THREE.Vector2[] => {
  const sh = new THREE["Shape"]();
  rounded(sh, x, y, w, h, c);
  return sh.getSpacedPoints(64);
};
const mouth = loop(-0.47, -0.315, 0.82, 0.63, 0.08),
  throat = loop(-0.43, -0.2725, 0.74, 0.545, 0.06);
const funnelPos: number[] = [];
for (let i = 0; i < mouth.length - 1; i++) {
  const [a, b, c, d] = [mouth[i], mouth[i + 1], throat[i + 1], throat[i]];
  if (!a || !b || !c || !d) continue;
  funnelPos.push(
    a.x,
    a.y,
    0.378,
    b.x,
    b.y,
    0.378,
    c.x,
    c.y,
    0.28,
    a.x,
    a.y,
    0.378,
    c.x,
    c.y,
    0.28,
    d.x,
    d.y,
    0.28,
  );
}
const funnelGeo = new THREE.BufferGeometry();
funnelGeo.setAttribute("position", new THREE.Float32BufferAttribute(funnelPos, 3));
funnelGeo.computeVertexNormals();
tv.add(
  new THREE.Mesh(
    funnelGeo,
    lambert({
      color: new THREE.Color(COL.bone).multiplyScalar(0.45),
      side: THREE.DoubleSide,
    }),
  ),
);
const badge = new THREE.Mesh(
  new THREE.PlaneGeometry(0.17, 0.026),
  lambert({ map: label("HORROR TUBE", COL.rustDeep, COL.bone, 340, 52, 30) }),
);
badge.position.set(-0.06, -0.337, 0.3785);
tv.add(badge);
const knobM = lambert({ color: COL.soot });
const knobMetal = lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.7) });
const knob = (x: number, y: number, rad: number, depth: number): void => {
  const k = cyl(rad, rad * 1.08, depth, knobMetal, 14);
  k.rotation.x = Math.PI / 2;
  k.position.set(x, y, 0.378 + depth / 2);
  const capM = cyl(rad * 0.45, rad * 0.45, 0.004, knobM, 10);
  capM.rotation.x = Math.PI / 2;
  capM.position.set(x, y, 0.378 + depth + 0.002);
  tv.add(k, capM);
};
for (const y of [-0.05, -0.13, -0.21]) knob(0.43, y, 0.02, 0.026);
knob(0.43, -0.3, 0.038, 0.036);
const ears = new THREE.Group();
ears.position.set(0.12, 0.4, -0.08);
const earBase = cyl(0.045, 0.06, 0.035, knobM, 12);
earBase.position.y = 0.0175;
ears.add(earBase);
for (const side of [-1, 1]) {
  const rod = cyl(0.0035, 0.0035, 0.52, ivory, 5);
  rod.geometry.translate(0, 0.26, 0);
  rod.position.y = 0.03;
  rod.rotation.set(-0.2, 0, side < 0 ? -0.45 : 1.05);
  ears.add(rod);
  if (side < 0) {
    const foil = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.02, 0),
      lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.5) }),
    );
    foil.position.y = 0.52;
    foil.rotation.set(0.4, 0.9, 0.2);
    rod.add(foil);
  }
}
tv.add(ears);
const crt = new THREE.PlaneGeometry(0.78, 0.585, 32, 24);
const cp = crt.getAttribute("position"),
  cuv = crt.getAttribute("uv");
const BULGE = 0.025,
  BARREL = 0.06;
for (let i = 0; i < cp.count; i++) {
  const x = cp.getX(i) / 0.39,
    y = cp.getY(i) / 0.2925,
    u = cuv.getX(i) - 0.5,
    v = cuv.getY(i) - 0.5;
  cp.setZ(i, BULGE * (1 - x * x) * (1 - y * y));
  cuv.setXY(i, 0.5 + u * (1 + BARREL * 4 * v * v), 0.5 + v * (1 + BARREL * 4 * u * u));
}
crt.computeVertexNormals();
const screen = new THREE.Mesh(crt, basic({ map: tvTex, fog: false }));
screen.position.set(-0.06, 0, 0.28);
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
glass.position.set(-0.06, 0, 0.282);
tv.add(glass);
const smudge = new THREE.Mesh(
  crt,
  basic({
    map: tex(390, 292, (g, w, h) => {
      const sr = seeded(29);
      g.clearRect(0, 0, w, h);
      const print = (x: number, y: number, a: number): void => {
        g.strokeStyle = COL.grime;
        g.lineWidth = 1;
        g.globalAlpha = 0.16;
        for (let k = 2; k < 13; k += 2) {
          g.beginPath();
          g.ellipse(x, y, k * 0.8, k, a, 0, Math.PI * 2);
          g.stroke();
        }
      };
      print(w * 0.82, h * 0.86, 0.3);
      print(w * 0.88, h * 0.8, 0.5);
      print(w * 0.12, h * 0.9, -0.2);
      g.globalAlpha = 0.07;
      g.fillStyle = COL.grime;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.ellipse(
          sr() * w,
          h * (0.6 + sr() * 0.4),
          30 + sr() * 50,
          8 + sr() * 10,
          sr() - 0.5,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.globalAlpha = 0.18;
      g.fillStyle = COL.bone;
      for (let i = 0; i < 140; i++) g.fillRect(sr() * w, sr() * h, 1, 1);
      g.globalAlpha = 0.5;
      crack(g, sr, w - 4, h - 30, 80, 3.6, COL.bone);
      g.globalAlpha = 1;
    }),
    transparent: true,
    depthWrite: false,
  }),
);
smudge.position.set(-0.06, 0, 0.283);
tv.add(smudge);
for (const m of [glass.material.map, smudge.material.map]) if (m) textTex(m);
const tvGlow = new THREE.PointLight(COL.body, 1.2, 0, 2);
tvGlow.position.set(0, TV_Y - 0.02, -0.8);
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
const tapeTex = textTex(new THREE.CanvasTexture(tapeCanvas));
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
  tape.visible = TAPE.up > 0.01 && Z.at === null && walk < 0;
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
    const REEL_MS = 2600,
      CUT_MS = 160,
      ch = S.chars[Math.floor(now / REEL_MS) % S.chars.length];
    g.fillStyle = COL.char;
    g.fillRect(0, 0, W, top);
    if (!LOW && now % REEL_MS < CUT_MS) {
      for (let y = 0; y < top; y += 4) {
        g.fillStyle = Math.random() < 0.5 ? COL.grime : COL.soot;
        g.fillRect(0, y, W, 4);
      }
    } else if (ch) {
      g.imageSmoothingEnabled = false;
      g.drawImage(face(ch), 40, 28, 180, 180);
      g.textAlign = "left";
      g.font = "700 22px Silkscreen";
      g.fillStyle = COL.sulfur;
      g.fillText(`CH ${num(ch.id + 1)}`, 252, 88);
      g.font = "30px DotGothic16";
      g.fillStyle = COL.bone;
      const y = wrap(g, ch.name.toUpperCase(), 252, 130, W - 276, 34);
      g.font = "700 22px Silkscreen";
      g.fillStyle = ch.alive ? COL.bone : COL.rust;
      g.fillText(ch.alive ? "ALIVE" : "DEAD", 252, y + 10);
    }
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
    const nameW = W / 2 - 110;
    g.fillText(ch.name, x + 88, mine ? y + 22 : y + 28, nameW);
    if (!ch.alive) {
      g.fillStyle = COL.rust;
      g.fillRect(x + 86, y + 20, Math.min(g.measureText(ch.name).width, nameW) + 4, 2);
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

let tvNoise = 0;
function drawCaseFile(ch: Character): void {
  const g = tvCtx,
    W = TW,
    x = 232,
    seen = ch.fights > 0;
  g.fillStyle = COL.rust;
  g.font = "700 18px Silkscreen";
  g.textAlign = "left";
  g.fillText(`RESIDENT ${num(ch.id + 1)}`, 32, 40);
  g.imageSmoothingEnabled = false;
  g.drawImage(tinted(ch), 32, 64, 176, 176);
  if (!ch.alive) {
    g.save();
    g.translate(120, 152);
    g.rotate(-0.2);
    g.strokeStyle = g.fillStyle = COL.blood;
    g.lineWidth = 4;
    g.textAlign = "center";
    g.strokeRect(-92, -24, 184, 40);
    g.font = "700 24px Silkscreen";
    g.fillText("DECEASED", 0, 6);
    g.restore();
  }
  g.textAlign = "left";
  g.fillStyle = COL.bone;
  g.font = "30px DotGothic16";
  let y = wrap(g, ch.name, x, 92, W - x - 32, 34);
  g.fillStyle = COL.sulfur;
  g.font = "700 16px Silkscreen";
  g.fillText(seen ? `KILLS ${ch.kills} · DAMAGE ${ch.damage}` : "KILLS ?? · DAMAGE ??", x, y);
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("CASE FILE", x, y + 34);
  g.fillStyle = COL.bone;
  g.font = "20px DotGothic16";
  y = Math.max(wrap(g, ch.brief, x, y + 60, W - x - 32, 26), 272);
  g.fillStyle = COL.rust;
  g.font = "700 14px Silkscreen";
  g.fillText("INJURIES", 32, y);
  g.fillStyle = COL.bone;
  g.font = "20px DotGothic16";
  wrap(g, ch.injuries || "None.", 32, y + 26, W - 64, 26);
  const [footer, color] = !ch.alive
    ? ["THIS ROOM IS EMPTY", COL.rust]
    : S.picks.includes(ch.id)
      ? ["YOU ALREADY ASKED FOR THEM", COL.rust]
      : ["PRESS OK TO REQUEST", COL.sulfur];
  g.textAlign = "center";
  g.fillStyle = color;
  g.font = "700 22px Silkscreen";
  g.fillText(footer, W / 2, 456);
}
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
    const width = g.measureText(t).width,
      max = W - 64;
    if (width > max) g.font = `${weight} ${Math.floor((size * max) / width)}px ${face}`;
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
      if (W8.qrUri !== "") {
        const { modules } = QRCode.create(W8.qrUri, { errorCorrectionLevel: "M" });
        const pad = 36;
        const cell = Math.floor(Math.min(W - pad * 2, 280) / modules.size);
        const side = cell * modules.size;
        const ox = Math.floor((W - side) / 2);
        const oy = 28;
        g.fillStyle = COL.bone;
        g.fillRect(ox - 8, oy - 8, side + 16, side + 16);
        g.fillStyle = COL.soot;
        for (let row = 0; row < modules.size; row++)
          for (let col = 0; col < modules.size; col++)
            if (modules.get(row, col)) g.fillRect(ox + col * cell, oy + row * cell, cell, cell);
        text("SCAN WITH WORLD APP", oy + side + 36, 28, COL.sulfur);
        text(
          "Orb only. We check it on our side.",
          oy + side + 68,
          22,
          COL.bone,
          "DotGothic16",
          400,
        );
      } else {
        text("STARTING WORLD ID…", 210, 36, COL.sulfur);
        text("Orb only. Waiting for a signed request.", 270, 24, COL.bone, "DotGothic16", 400);
      }
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
      const ch = T.buf.length === 2 ? S.chars[+T.buf - 1] : null;
      if (ch) drawCaseFile(ch);
      else {
        text(`${T.buf.padEnd(2, "_")}`, 170, 110);
        if (T.buf.length < 2) text("TYPE TWO DIGITS", 280, 24, COL.rust);
        else text("NO SUCH RESIDENT", 280, 28, COL.rust);
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
  tvNoise = noise;
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
  const step = WALK[walk];
  if (step) {
    h.innerHTML = `${step.say} <span class="hint-key">ENTER</span>`;
    return;
  }
  const hovered = S.chars[T.hover];
  const credit = `${usd(coinBox?.credit() ?? 0)} USDC`;
  const meter = Z.error
    ? `${b("THE BOX SPAT IT OUT")} ${esc(Z.error)}`
    : Z.pick
      ? COINS.map((c, i) => `<button data-coin="${c}">${b(String(i + 1))} ${c} USDC</button>`).join(
          " ",
        )
      : Z.at === "sticker"
        ? `${b("PAY BY PHONE")} testnet USDC on Sui to <span class="addr">${coinBox?.address ?? ""}</span>`
        : Z.at !== null && Z.hover === "slot"
          ? b("COIN DIAL")
          : Z.at !== null && Z.hover === "lock"
            ? `${b("PADLOCK")} ${credit} inside`
            : Z.at !== null && Z.hover === "sticker"
              ? b("PAY BY PHONE")
              : Z.at !== null || Z.hover !== null
                ? `${b("COIN METER")} ${credit}`
                : "";
  if (meter) {
    h.innerHTML = Z.at === null ? meter : `${meter} <span class="hint-key">ESC</span>`;
    return;
  }
  h.innerHTML = hovered
    ? `${b(num(hovered.id + 1))} ${hovered.name}`
    : S.phase === "gate"
      ? W8.step === "read"
        ? `SIGN WITH WORLD ID ${b("ENTER")}`
        : W8.step === "scan"
          ? `SCAN WITH ${b("WORLD APP")} · ORB ONLY`
          : W8.step === "done" && S.noteKind === "bad"
            ? `${esc(S.note.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 220))} · RELOAD`
            : W8.step === "done"
              ? "WARMING UP"
              : `NEXT ${b("ENTER")}`
      : S.phase === "vote" && !S.cast
        ? `PICK TWO · NUMBER ${b("OK")}`
        : S.phase === "bet" && !S.bet && S.credit > 0
          ? `STAKE ${b("VOL ±")} · BET ${b("HOLD A / B")}`
          : S.claim
            ? `COLLECT ${b("OK")}`
            : S.phase === "over"
              ? `AGAIN ${b("OK")}`
              : S.credit <= 0
                ? `NO STAKE · METER ${b("D")} · PHONE ${b("P")} · NEXT ${b("N")}`
                : `NEXT ${b("N")}`;
}

function press(id: string): void {
  sfx.key();
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
      T.held = -1;
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
    if (!ch || !ch.alive || S.picks.includes(ch.id)) return sfx.deny();
    pick(ch.id);
    sfx.pick();
    T.buf = "";
    T.reveal = ch.id;
    T.revealUntil = performance.now() + 3200;
    if (S.picks.length === 2) $("#h-cast").click();
  } else if (S.claim) {
    $("#h-claim").click();
    sfx.coins(14);
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
  if (stake() > S.credit) {
    sfx.deny();
    return say(S.credit <= 0 ? "No stake. Feed the coin box." : "Not enough for that stake.");
  }
  T.hold = side;
  T.holdN = 0;
  pressKey(side ? "B" : "A", 0.016);
  holdTimer = window.setInterval(() => {
    T.holdN++;
    sfx.tick(T.holdN);
    if (T.holdN >= 8) {
      holdEnd();
      sfx.bet();
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

const store = <T>(fn: (s: Storage) => T): T | null => {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
};
function cut(fn: () => void): void {
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
function step(name: Step): void {
  W8.step = name;
  W8.at = performance.now();
  STEP_SOUND.get(name)?.();
  hintText();
}
let scanAbort: AbortController | null = null;
function sign(): void {
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
async function beginWorldIdScan(): Promise<void> {
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
    const idkitResult = await proof.wait();
    if (signal.aborted) return;
    await verifyEnterRoomProof(idkitResult);
    if (signal.aborted) return;
    await openGameWallet(JSON.stringify(idkitResult));
    if (signal.aborted) return;
    await mountCoinBox();
    if (signal.aborted) return;
    verified();
  } catch (err) {
    if (signal.aborted) return;
    console.error(
      `World ID enter-room failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    noOrb();
  }
}
function verified(): void {
  step("signed");
  store((s) => s.setItem("ht.verified", "1"));
}
function nextGateStep(): void {
  if (W8.step === "signed")
    cut(() => {
      enterRoom();
      walkTo(0);
    });
  else if (W8.step === "off") step("burn");
  else if (W8.step === "burn") step("dark");
  else if (W8.step === "dark") retry();
}
function enterRoom(): void {
  step("done");
  paper.visible = false;
  stool.visible = false;
  $("#gate").hidden = true;
  void newSeason();
}
let coinBox: CoinBox | null = null;
let chainCredit = 0;
async function mountCoinBox(): Promise<void> {
  if (coinBox !== null) return;
  const wallet = await getGameWallet();
  coinBox = createCoinBox(
    wallet,
    (usdc) => {
      S.credit += usdc - chainCredit;
      chainCredit = usdc;
      hintText();
    },
    say,
    (message) => {
      Z.error = message;
      Z.at ??= "meter";
      hintText();
    },
  );
  coinBox.group.position.set(-0.59, TV_Y + 0.19, -1.055);
  shade(coinBox.group);
  scene.add(coinBox.group);
}
if (hasWalletSession()) {
  void mountCoinBox().catch((err: Error) => {
    console.error(`Shinami wallet failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
const cable = new THREE.Mesh(
  new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(
      [
        [-0.59, TV_Y, -1.1],
        [-0.59, TV_Y - 0.32, -1.2],
        [-0.61, 0.3, -1.32],
        [-0.56, 0.008, -1.55],
        [-0.35, 0.008, -1.78],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    ),
    40,
    0.006,
    6,
  ),
  lambert({ color: COL.soot }),
);
scene.add(cable);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
type Pick =
  | { at: "paper" }
  | { at: "coin"; part: CoinBoxPart }
  | { at: "shelf"; slot: Slot | undefined }
  | { at: "key"; id: string };
const shown = (o: THREE.Object3D | null): boolean => o === null || (o.visible && shown(o.parent));
const within = (o: THREE.Object3D | null, root: THREE.Object3D): boolean =>
  o !== null && (o === root || within(o.parent, root));
const pickAt = (e: MouseEvent): Pick | null => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray
    .intersectObject(scene, true)
    .find((h) => h.object instanceof THREE.Mesh && shown(h.object));
  if (hit === undefined) return null;
  const o = hit.object;
  if (o === paper)
    return S.phase === "gate" && W8.step === "read" && $("#gate").hidden ? { at: "paper" } : null;
  if (coinBox !== null && within(o, coinBox.group))
    return { at: "coin", part: coinBox.partAt(hit) };
  const id: string | undefined = o.userData.keyId;
  if (id !== undefined) return { at: "key", id };
  if (S.phase === "gate" || Z.at !== null) return null;
  if (o === tape) return { at: "shelf", slot: undefined };
  const slot = slots.find((s) => s.mesh === o);
  return slot === undefined ? null : { at: "shelf", slot };
};
const WALK: WalkStep[] = [
  {
    say: "THE TV. EVERYTHING AIRS HERE.",
    view: () => [
      tv.localToWorld(new THREE.Vector3(-0.06, 0.02, 1.35)),
      tv.localToWorld(new THREE.Vector3(-0.06, 0, 0.38)),
    ],
    remote: false,
  },
  {
    say: "THE RESIDENTS. PULL A TAPE.",
    view: () => [
      shelf.localToWorld(new THREE.Vector3(0, 1.28, 1.05)),
      shelf.localToWorld(new THREE.Vector3(0, 1.22, 0.1)),
    ],
    remote: false,
  },
  { say: "THE REMOTE. VOTE FOR TWO. THEY FIGHT.", view: () => null, remote: true },
  { say: "THE METER. FEED IT TO BET.", view: () => coinBox?.view("meter") ?? null, remote: false },
  { say: "HOLD A OR B. BET ON WHO WALKS OUT.", view: () => null, remote: true },
];
function walkTo(n: number): void {
  walk = n < WALK.length ? n : -1;
  hintText();
}
function zoom(at: CoinBoxView | null, pick = false): void {
  Z.at = at;
  Z.pick = pick;
  hintText();
}
function stepBack(): void {
  if (Z.error) Z.error = "";
  else if (Z.pick) Z.pick = false;
  else if (Z.at === "sticker") Z.at = "meter";
  else Z.at = null;
  hintText();
}
function insertCoin(usdc: number): void {
  coinBox?.insert(usdc);
  zoom("meter");
}
function useCoinPart(part: CoinBoxPart): void {
  Z.error = "";
  if (part === "slot") zoom("meter", true);
  else if (part === "sticker") zoom("sticker");
  else if (part === "lock") {
    zoom("meter");
    coinBox?.open();
  } else zoom(Z.at ?? "meter", Z.pick);
}
$("#hint").addEventListener("click", (e) => {
  const coin = e.target instanceof Element ? e.target.closest("[data-coin]") : null;
  if (coin instanceof HTMLElement) insertCoin(Number(coin.dataset.coin));
});
function noOrb(): void {
  if (W8.step !== "read" && W8.step !== "scan") return;
  scanAbort?.abort();
  scanAbort = null;
  W8.qrUri = "";
  step("off");
}
function retry(): void {
  cut(() => {
    W8.ink = 0;
    W8.qrUri = "";
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
  const pick = pointer ? pickAt(pointer) : null;
  const hover = pick?.at === "shelf" ? (pick.slot?.id ?? -1) : -1;
  if (hover === T.hover) return;
  if (hover >= 0) sfx.slide();
  T.hover = hover;
  hintText();
}
addEventListener("pointermove", (e) => {
  pointer = e;
  look.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  const pick = pickAt(e);
  const part = pick?.at === "coin" ? pick.part : null;
  if (part !== Z.hover) {
    Z.hover = part;
    hintText();
  }
  canvas.dataset.cursor = cursorFor(pick);
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (Z.at !== null) stepBack();
});
const PART_CURSOR = {
  slot: "coin",
  sticker: "phone",
  lock: "grab",
  body: "press",
} satisfies Record<CoinBoxPart, string>;
function cursorFor(pick: Pick | null): string {
  if (walk >= 0) return "press";
  if (pick === null) return "";
  if (pick.at === "paper") return "pen";
  if (pick.at === "coin") return PART_CURSOR[pick.part];
  return pick.at === "shelf" ? "grab" : "press";
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (walk >= 0) return walkTo(walk + 1);
  const pick = pickAt(e);
  if (Z.at !== null) return pick?.at === "coin" ? useCoinPart(pick.part) : stepBack();
  if (pick === null) return;
  if (pick.at === "paper") return sign();
  if (pick.at === "coin") return zoom("meter");
  if (pick.at === "shelf") {
    sfx.tape();
    T.buf = "";
    T.reveal = -1;
    T.held = pick.slot?.id ?? -1;
    T.hover = -1;
    return hintText();
  }
  if (pick.id === "A" || pick.id === "B") holdStart(pick.id === "B" ? 1 : 0);
  else press(pick.id);
});
addEventListener("pointerup", holdEnd);
addEventListener(
  "keydown",
  (e) => {
    const waiverUp = S.phase === "gate" && W8.step !== "done";
    if (waiverUp && !e.metaKey && !e.ctrlKey && !e.altKey && $("#gate").hidden) {
      const k = e.key.toLowerCase();
      if (k === "enter" && W8.step === "read") sign();
      else if (k === "enter") nextGateStep();
      else if (k === "x") noOrb();
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (waiverUp || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "m") return muteKey();
    const coinKey = COIN_KEYS.get(k);
    if (walk >= 0) {
      if (k === "escape") walkTo(WALK.length);
      else if (k === "enter" || k === " " || k === "arrowright") walkTo(walk + 1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (Z.at !== null) {
      if (k === "escape" || k === "backspace") stepBack();
      else if (Z.pick && /^[1-3]$/.test(k)) insertCoin(COINS[Number(k) - 1]);
      else if (coinKey !== undefined) useCoinPart(coinKey);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (coinKey !== undefined && coinBox !== null) {
      e.preventDefault();
      e.stopPropagation();
      return useCoinPart(coinKey);
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
mask.castShadow = false;
const clock = new THREE.Clock();
let lastPaint = 0;
let gaze = 0;
const eye = new THREE.Vector3(),
  aim = new THREE.Vector3(),
  wantEye = new THREE.Vector3(),
  wantAim = new THREE.Vector3();
let snap = true;
let remoteUp = 0;
let nextBeat = 0;
let lastFrame = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const waiver = S.phase === "gate" && W8.step !== "done";
  const dark = waiver && W8.step === "dark";
  if (waiver) {
    camera.position.set(Math.sin(t * 0.6) * 0.006, 1.36 + Math.sin(t * 1.0) * 0.005, -0.12);
    const up = W8.step === "scan" ? 1 : 0;
    gaze = LOW ? up : gaze + (up - gaze) * 0.06;
    camera.lookAt(look.x * 0.06, 0.57 + gaze * (TV_Y - 0.55) - look.y * 0.04, -0.86 - gaze * 0.54);
    snap = true;
  } else {
    const walkView = WALK[walk]?.view() ?? null;
    if (walkView !== null) {
      wantEye.copy(walkView[0]);
      wantAim.copy(walkView[1]);
    } else if (Z.at !== null && coinBox !== null) {
      const [e2, a2] = coinBox.view(Z.at);
      wantEye.copy(e2);
      wantAim.copy(a2);
      wantEye.x += look.x * 0.004;
      wantEye.y -= look.y * 0.004;
    } else {
      wantEye.set(
        0.1 + look.x * 0.05 + Math.sin(t * 0.6) * 0.008,
        1.2 - look.y * 0.03 + Math.sin(t * 1.0) * 0.006,
        0.28,
      );
      wantAim.set(0.16 + look.x * 0.12, TV_Y - 0.1 - look.y * 0.06, -1.4);
    }
    const k = snap || LOW ? 1 : 0.1;
    eye.lerp(wantEye, k);
    aim.lerp(wantAim, k);
    snap = false;
    camera.position.copy(eye);
    camera.lookAt(aim);
  }
  const raise = WALK[walk]?.remote ? 1 : 0;
  remoteUp = LOW ? raise : remoteUp + (raise - remoteUp) * 0.12;
  remote.position.set(0.31 - 0.2 * remoteUp, -0.17 + 0.09 * remoteUp, -0.62 + 0.14 * remoteUp);
  remote.rotation.set(-0.3 + 0.22 * remoteUp, -0.22 + 0.2 * remoteUp, -0.1 + 0.1 * remoteUp);
  if (raise) led.material.color.set(Math.sin(t * 8) > 0 ? COL.blood : COL.bloodDeep);
  remote.visible = !waiver && Z.at === null && (walk < 0 || raise === 1);
  updateTape(performance.now());
  updateHover();
  if (coinBox !== null) coinBox.group.visible = !waiver;
  cable.visible = !waiver;
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
  ambience(tvNoise, flick, lightsOut);
  const ms = performance.now();
  if (S.phase === "bet" && ms >= nextBeat) {
    sfx.beat(0.75);
    nextBeat = ms + 740;
  }
  if (S.phase === "fight" && !vidMode && S.frame !== lastFrame && S.frame % 12 === 9) sfx.hit();
  lastFrame = S.frame;
  if (t - lastPaint > 0.083) {
    lastPaint = t;
    drawTV();
  }
  draw();
});

const PHASE_SOUND = new Map<Phase, () => void>([
  ["vote", sfx.bell],
  ["story", () => sfx.type(4)],
  ["bet", sfx.static],
  ["fight", sfx.fight],
  ["settle", () => sfx.sting(!!S.bet && S.result < 0)],
  ["over", sfx.signoff],
]);
function muteKey(): void {
  toggleMute();
  $("#mute").textContent = isMuted() ? "SOUND OFF · M" : "SOUND ON · M";
}
$("#mute").addEventListener("click", muteKey);
$("#mute").textContent = isMuted() ? "SOUND OFF · M" : "SOUND ON · M";
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
    PHASE_SOUND.get(S.phase)?.();
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
