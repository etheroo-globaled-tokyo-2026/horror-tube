import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { $ } from "./game.ts";
import { COL } from "./room-palette.ts";

const canvas = $("#view");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#view is not a canvas");
let ps1 = Number(localStorage.getItem("ps1") ?? 0.25);
let ps1Text = Number(localStorage.getItem("ps1Text") ?? 0.1);
export const textTex = <T extends THREE.Texture>(t: T): T => {
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
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
export const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.soot);
scene.fog = new THREE.FogExp2(COL.soot, 0.2);
export const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 8);
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
export function draw(): void {
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
export function size() {
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

export { canvas };
