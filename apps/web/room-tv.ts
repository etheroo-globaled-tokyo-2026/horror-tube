import * as THREE from "three";
import QRCode from "qrcode";
import {
  DUR,
  S,
  applyRoundState,
  char,
  face,
  usd,
  film,
  living,
  mmss,
  note,
  odds,
  replaying,
  type Character,
} from "./game.ts";
import { postPlaybackStart } from "./round-client.ts";
import { fromUsdcUnits } from "./wallet.ts";
import { blotch, burn, crack, ctx2d, drip, scratches, screw, seeded } from "./sprites.ts";
import { BARS, COL, RAMP } from "./room-palette.ts";
import { drawLogo } from "./logo.ts";
import {
  TEAK,
  TV_Y,
  basic,
  box,
  cyl,
  label,
  lambert,
  r,
  rough,
  tex,
  speckle,
} from "./room-materials.ts";
import { renderer, scene, textTex } from "./room-render.ts";
import { tinted } from "./room-shelf.ts";
import { LOW, STAKES, T, W8, wrap, num } from "./room-state.ts";

export const TW = 640,
  TH = 480;
export const tvCanvas = document.createElement("canvas");
tvCanvas.width = TW;
tvCanvas.height = TH;
export const tvCtx = ctx2d(tvCanvas);
export const tvTex = textTex(new THREE.CanvasTexture(tvCanvas));
tvTex.magFilter = THREE.LinearFilter;
tvTex.minFilter = THREE.LinearMipmapLinearFilter;
tvTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
tvTex.colorSpace = THREE.SRGBColorSpace;
tvTex.repeat.set(0.78 / 0.74, 0.585 / 0.545);
tvTex.offset.set((1 - tvTex.repeat.x) / 2, (1 - tvTex.repeat.y) / 2);
export const tv = new THREE.Group();
tv.position.set(0, TV_Y, -1.4);
scene.add(tv);
export const teak = rough(
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
export const body = box(1.02, 0.8, 0.63, teak);
body.position.z = -0.045;
tv.add(body);
export const ivory = lambert({
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
export const rounded = (
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
export const maskOutline = new THREE["Shape"]();
rounded(maskOutline, -0.505, -0.395, 1.01, 0.79, 0.02);
export const hole = new THREE.Path();
rounded(hole, -0.47, -0.315, 0.82, 0.63, 0.08);
maskOutline.holes.push(hole);
export const mask = new THREE.Mesh(
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
export const MASK = { x: -0.505, y: -0.395, w: 1.01, h: 0.79, px: 600 };
export const maskTex = tex(
  Math.round(MASK.w * MASK.px),
  Math.round(MASK.h * MASK.px),
  (g, w, h) => {
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
  },
);
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
export const loop = (x: number, y: number, w: number, h: number, c: number): THREE.Vector2[] => {
  const sh = new THREE["Shape"]();
  rounded(sh, x, y, w, h, c);
  return sh.getSpacedPoints(64);
};
export const mouth = loop(-0.47, -0.315, 0.82, 0.63, 0.08),
  throat = loop(-0.43, -0.2725, 0.74, 0.545, 0.06);
export const funnelPos: number[] = [];
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
export const funnelGeo = new THREE.BufferGeometry();
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
export const badge = new THREE.Mesh(
  new THREE.PlaneGeometry(0.17, 0.026),
  lambert({ map: label("HORROR TUBE", COL.rustDeep, COL.bone, 340, 52, 30) }),
);
badge.position.set(-0.06, -0.337, 0.3785);
tv.add(badge);
export const knobM = lambert({ color: COL.soot });
export const knobMetal = lambert({ color: new THREE.Color(COL.bone).multiplyScalar(0.7) });
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
export const ears = new THREE.Group();
ears.position.set(0.12, 0.4, -0.08);
export const earBase = cyl(0.045, 0.06, 0.035, knobM, 12);
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
export const crt = new THREE.PlaneGeometry(0.78, 0.585, 32, 24);
export const cp = crt.getAttribute("position"),
  cuv = crt.getAttribute("uv");
export const BULGE = 0.025,
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
export const screen = new THREE.Mesh(crt, basic({ map: tvTex, fog: false }));
screen.position.set(-0.06, 0, 0.28);
tv.add(screen);
export const glass = new THREE.Mesh(
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
export const smudge = new THREE.Mesh(
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
export const tvGlow = new THREE.PointLight(COL.body, 1.2, 0, 2);
tvGlow.position.set(0, TV_Y - 0.02, -0.8);
scene.add(tvGlow);

export const video = document.createElement("video");
video.playsInline = true;
video.preload = "auto";
video.muted = true;
export let lastVideoUrl: string | null = null;
export const small = document.createElement("canvas");
small.width = 160;
small.height = 120;
export const sg = ctx2d(small, { willReadFrequently: true });
export let vidMode: "" | "live" | "rec" = "";
let reportedBattleId: string | null = null;
// WARNING: the server starts the betting deadline from this report; send it only on a real `playing` event.
video.addEventListener("playing", () => {
  const battleId = S.battleId;
  if (vidMode !== "live" || S.phase !== "bet" || battleId === null) return;
  if (S.bettingClosesAt !== null || reportedBattleId === battleId) return;
  reportedBattleId = battleId;
  postPlaybackStart(battleId)
    .then(applyRoundState)
    .catch((cause: unknown) => {
      reportedBattleId = null;
      note(
        `PLAYBACK START NOT RECORDED. ${cause instanceof Error ? cause.message : String(cause)}`,
        "bad",
      );
    });
});
export function syncVideo(): void {
  const url = S.videoUrl;
  if (!url) {
    if (vidMode) {
      video.pause();
      vidMode = "";
    }
    lastVideoUrl = null;
    return;
  }
  if (url !== lastVideoUrl) {
    video.src = url;
    lastVideoUrl = url;
  }
  const mode = S.phase === "fight" || S.phase === "bet" ? "live" : replaying() ? "rec" : "";
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
export function crop(
  sw0: number,
  sh0: number,
  dw: number,
  dh: number,
): [number, number, number, number] {
  let sw = sw0,
    sh = sw0 / (dw / dh);
  if (sh > sh0) {
    sh = sh0;
    sw = sh0 * (dw / dh);
  }
  return [(sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh];
}
export function videoFrame(dx = 0, dy = 0, dw = TW, dh = TH): void {
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
export function drawGuide(now: number): void {
  const g = tvCtx,
    W = TW,
    H = TH,
    top = 236;
  g.fillStyle = COL.soot;
  g.fillRect(0, 0, W, H);
  const filmCanvas = film();
  if (S.phase === "countdown") {
    g.textAlign = "center";
    g.font = "700 26px Silkscreen";
    g.fillStyle = COL.sulfur;
    g.fillText(S.cast ? "VOTING CLOSES IN" : "LAST CALL TO VOTE", W / 2, 76);
    g.font = "700 84px Silkscreen";
    g.fillStyle = COL.blood;
    g.fillText(mmss(S.t), W / 2, 164);
    g.font = "24px DotGothic16";
    g.fillStyle = COL.bone;
    const bots = S.bots.filter((b) => b.picks !== null).length,
      humans = S.voters - bots;
    g.fillText(
      `${humans} ${humans === 1 ? "human" : "humans"}${bots === 0 ? "" : ` + ${bots === 1 ? "house bot" : `${bots} house bots`}`} voted`,
      W / 2,
      206,
    );
    const bar = W * Math.min(1, S.t / DUR.countdown);
    g.fillStyle = COL.blood;
    g.fillRect((W - bar) / 2, top - 8, bar, 8);
  } else if (vidMode && video.readyState >= 2) videoFrame(0, 0, W, top);
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
  if (S.last && S.phase !== "countdown") {
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
  S.chars.forEach((ch) => {
    if (
      (S.phase === "vote" || S.phase === "countdown") &&
      S.champion !== null &&
      ch.id === S.champion
    ) {
      return;
    }
    const visibleIndex = S.chars
      .filter(
        (c) =>
          !(
            (S.phase === "vote" || S.phase === "countdown") &&
            S.champion !== null &&
            c.id === S.champion
          ),
      )
      .indexOf(ch);
    const x = visibleIndex < 5 ? 12 : W / 2 + 6,
      y = top + 34 + (visibleIndex % 5) * 42,
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

export let tvNoise = 0;
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
    : S.champion !== null && ch.id === S.champion
      ? ["THE CHAMPION STAYS ON", COL.rust]
      : S.picks.includes(ch.id)
        ? ["YOU ALREADY ASKED FOR THEM", COL.rust]
        : ["PRESS OK TO REQUEST", COL.sulfur];
  g.textAlign = "center";
  g.fillStyle = color;
  g.font = "700 22px Silkscreen";
  g.fillText(footer, W / 2, 456);
}
export function drawTV(): void {
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
    g.textAlign = "center";
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
        text("PROVE YOU'RE STILL HUMAN", oy + side + 36, 28, COL.sulfur);
        text("The dead have enough channels.", oy + side + 68, 22, COL.bone, "DotGothic16", 400);
      } else {
        text("IS ANYBODY ALIVE?", 210, 36, COL.sulfur);
        text("Hold still. Finding your signal.", 270, 24, COL.bone, "DotGothic16", 400);
      }
    } else if (W8.step === "wallet") {
      noise = 0.1;
      fill(COL.soot);
      text("VERIFIED", 210, 48, COL.blood);
      text(`OPENING YOUR WALLET${".".repeat(1 + (((now / 400) | 0) % 3))}`, 270, 26, COL.bone);
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
      BARS.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect((i * W) / BARS.length, 0, W / BARS.length + 1, 48);
      });
      drawLogo(g, W / 2, 196, 420);
      text("PLEASE STAND BY", 370, 40, COL.bone);
      text(
        `tuning in${".".repeat(1 + (((now / 400) | 0) % 3))}`,
        420,
        24,
        COL.rust,
        "DotGothic16",
        400,
      );
    } else if (W8.fail !== "") {
      noise = 0.2;
      fill(COL.soot);
      text(W8.down === "" ? "YOU ARE NOT IN" : "ENTRY IS DOWN", 110, 48, COL.blood);
      g.font = "400 22px DotGothic16";
      g.fillStyle = COL.bone;
      const end = wrap(g, W8.fail, W / 2, 170, W - 64, 28);
      if (W8.down === "") text("ENTER TO TRY AGAIN", Math.min(H - 24, end + 24), 24, COL.rust);
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
  } else if (
    (S.phase === "vote" || S.phase === "countdown") &&
    !S.cast &&
    (T.buf || (T.reveal >= 0 && now < T.revealUntil))
  ) {
    fill(COL.soot);
    noise = 0.14;
    if (T.reveal >= 0 && now < T.revealUntil) {
      const ch = char(T.reveal);
      text(`RESIDENT ${num(ch.id + 1)}`, 150, 30, COL.sulfur);
      text(ch.name.toUpperCase(), 230, 44, COL.blood);
      text(S.picks.length >= S.slots ? "THANK YOU. GOOD NIGHT." : "ONE MORE.", 330, 26);
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
    if (S.phase === "vote" || S.phase === "countdown") drawGuide(now);
    else if (vidMode && video.readyState >= 2) videoFrame();
    else if (filmCanvas.width) g.drawImage(filmCanvas, 20, 0, 120, 90, 0, 0, W, H);
    const [a, b] = (S.fighters || []).map(char);
    if (S.phase === "bet" && vidMode === "live") {
      band(H - 150, 100);
      text(
        S.bettingClosesAt === null
          ? "BETS OPEN"
          : `BETS CLOSE IN ${mmss(Math.max(0, (S.bettingClosesAt - Date.now()) / 1000))}`,
        H - 110,
        30,
        COL.sulfur,
      );
      text(
        S.bet
          ? `${S.bet.amt} USDC ON ${char(S.fighters?.[S.bet.side] ?? -1).short}. GOOD LUCK.`
          : S.pending === "bet"
            ? "PLACING YOUR BET…"
            : "HOLD A OR B TO BET",
        H - 70,
        24,
        COL.bone,
        "DotGothic16",
        400,
      );
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
        const pays = odds(i);
        g.fillText(pays === "no stake" ? "no stake" : `pays ×${pays}`, x, 264);
        const house = S.bots.flatMap((bot) => (bot.bet?.side === i ? [bot.bet.units] : []));
        if (house.length > 0) {
          g.fillStyle = COL.soot;
          g.font = "20px DotGothic16";
          g.fillText(
            `HOUSE BOT ${usd(fromUsdcUnits(BigInt(house.reduce((s, u) => s + u, 0))))} USDC`,
            x,
            306,
          );
        }
      });
      if (S.bet)
        text(
          `${S.bet.amt} USDC ON ${char(S.fighters?.[S.bet.side] ?? -1).short}. GOOD LUCK.`,
          360,
          26,
          COL.soot,
        );
      else if (S.pending === "bet") text("PLACING YOUR BET…", 360, 26, COL.soot);
      else if (S.poolId === null) text("OPENING THE BOOK", 360, 26, COL.soot);
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
      if (S.pending === "claim") text("COLLECTING…", 390, 26, COL.sulfur);
      else if (S.claim) text(`PRESS OK TO COLLECT ${usd(S.claim)} USDC`, 390, 26, COL.sulfur);
      else if (S.result < 0) text(`YOU LOST ${usd(-S.result)} USDC`, 390, 26, COL.rust);
    } else if (S.phase === "over") {
      fill(COL.soot);
      const l = living(),
        endedByFailure = !!S.error;
      text(endedByFailure ? "SIGNAL LOST" : "END OF PROGRAMMING", 200, 34);
      text(
        endedByFailure
          ? "The tape jammed before anyone bled."
          : l[0]
            ? `${l[0].name} is the last one left.`
            : "Nobody is left.",
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
