import { createDAppKit } from "@mysten/dapp-kit-core";
import "@mysten/dapp-kit-core/web";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import QRCode from "qrcode";
import * as THREE from "three";

import { type Coin, COINS, coinTotal, tokensFor } from "./coin-tokens.ts";
import { LOW } from "./room-state.ts";
import { sfx } from "./sfx.ts";
import { fillSuiMark, suiMarkWidth } from "./sui-mark.ts";
import { blotch, crack, drip, scratches, seeded } from "./sprites.ts";

import {
  type GameWallet,
  SUI_TESTNET_GRPC,
  depositUsdc,
  fromUsdcUnits,
  getUsdcBalance,
  sendUsdc,
  toUsdcUnits,
} from "./wallet.ts";

export const PAYOUT_STORAGE_KEY = "horror-tube.payout-address";

export type CoinBoxPart = Coin | "handle" | "sticker" | "lock" | "body";

export const isCoin = (part: CoinBoxPart | null): part is Coin => COINS.some((c) => c === part);
export type CoinBoxView = "meter" | "sticker";

export type CoinBox = {
  group: THREE.Group;
  address: () => string | null;
  connect: (wallet: GameWallet, coinType: string) => void;
  credit: () => number;
  waiting: () => number;
  partAt: (hit: THREE.Intersection) => CoinBoxPart;
  view: (at: CoinBoxView) => [eye: THREE.Vector3, target: THREE.Vector3];
  drop: (coin: Coin) => void;
  grab: (coin: Coin, ray: THREE.Ray) => boolean;
  drag: (ray: THREE.Ray) => void;
  release: (click: boolean) => void;
  turn: () => void;
  giveBack: () => void;
  tick: (ms: number) => void;
  open: () => void;
};

type Rect = [x: number, y: number, w: number, h: number];

const SIZE = { w: 0.128, top: 0.22, drawer: 0.148, d: 0.11 };
const PX = 2000;
const FW = SIZE.w * PX;
const TOP_H = SIZE.top * PX;
const DRAWER_H = SIZE.drawer * PX;
const WINDOW: Rect = [32, 22, 192, 64];
const PLATE: Rect = [32, 92, 192, 96];
const DRUM: Rect = [24, 194, 208, 40];
const DIAL = { x: FW / 2, y: 336, r: 82 };
const RULES: Rect = [40, 12, 176, 100];
const STICKER: Rect = [12, 158, 232, 124];
const FULL = 20;
const TOKEN = { r: 0.026, t: 0.005, px: 128 };
const FLY_MS = 420;
const SINK_MS = 220;
const SPILL_MS = 2600;
const SPILL_MAX = 3;
const HANDLE_REST = 0.35;
const NUDGE_EVERY_MS = 2200;
const NUDGE_MS = 700;

const dAppKit = createDAppKit({
  networks: ["testnet"],
  defaultNetwork: "testnet",
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: SUI_TESTNET_GRPC }),
});

const shadowOnlyModalTheme = new CSSStyleSheet();
shadowOnlyModalTheme.replaceSync(`
  dialog { box-shadow: inset 0 0 0 2px var(--grime), 0 0 0 4px var(--soot); }
  dialog::backdrop { background: var(--shade); }
  .title { font: 400 16px/1 var(--f-osd); text-transform: uppercase; letter-spacing: 0.06em; }
`);

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

const inside = (rect: Rect, x: number, y: number): boolean =>
  x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3];

function connectedAddress(): string | null {
  return dAppKit.stores.$connection.get().account?.address ?? null;
}

async function connectBrowserWallet(): Promise<string | null> {
  const now = connectedAddress();
  if (now !== null) return now;
  const modal = document.createElement("mysten-dapp-kit-connect-modal");
  modal.instance = dAppKit;
  document.body.append(modal);
  modal.shadowRoot?.adoptedStyleSheets.push(shadowOnlyModalTheme);
  const connected = new Promise<string | null>((resolve) => {
    const stop = dAppKit.stores.$connection.subscribe((connection) => {
      if (connection.account === null) return;
      stop();
      resolve(connection.account.address);
    });
    modal.addEventListener("closed", () => {
      stop();
      resolve(connectedAddress());
    });
  });
  await modal.show();
  const address = await connected;
  modal.remove();
  return address;
}

function storedPayout(): string | null {
  try {
    return localStorage.getItem(PAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberPayout(address: string): void {
  try {
    localStorage.setItem(PAYOUT_STORAGE_KEY, address);
  } catch {
    return;
  }
}

function drawQr(g: CanvasRenderingContext2D, text: string, rect: Rect, ink: string): void {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "L" });
  const cell = Math.floor(Math.min(rect[2], rect[3]) / modules.size);
  const x0 = rect[0] + Math.floor((rect[2] - cell * modules.size) / 2);
  const y0 = rect[1] + Math.floor((rect[3] - cell * modules.size) / 2);
  g.fillStyle = ink;
  for (let row = 0; row < modules.size; row++)
    for (let col = 0; col < modules.size; col++)
      if (modules.get(row, col)) g.fillRect(x0 + col * cell, y0 + row * cell, cell, cell);
}

export function createCoinBox(
  onCredit: (usdc: number) => void,
  say: (text: string) => void,
  onError: (message: string) => void,
): CoinBox {
  const colors = {
    soot: cssVar("soot"),
    char: cssVar("char"),
    grime: cssVar("grime"),
    rust: cssVar("rust"),
    blood: cssVar("blood"),
    sulfur: cssVar("sulfur"),
    bone: cssVar("bone"),
    rustDeep: cssVar("rust-deep"),
    enamel: cssVar("enamel"),
    bloodDeep: cssVar("blood-deep"),
  };
  const rand = seeded(41);
  const layer = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    if (x === null) throw new Error("Coin box needs a 2D canvas.");
    return [c, x];
  };
  const pixelTexture = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const enamel = (c: CanvasRenderingContext2D, w: number, h: number): void => {
    c.fillStyle = colors.bone;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.5;
    c.fillStyle = colors.sulfur;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
    for (let i = 0; i < 6; i++)
      blotch(c, rand, rand() * w, rand() * h, 20 + rand() * 50, colors.rust, 0.06);
    for (let i = 0; i < 5; i++)
      blotch(c, rand, rand() * w, rand() * h, 8 + rand() * 16, colors.grime, 0.08);
    scratches(c, rand, [0, 0, w, h], 25, colors.grime, 0.35);
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ])
      blotch(c, rand, x, y, 50, colors.rustDeep, 0.55);
    for (let i = 0; i < 3; i++) {
      const x = rand() * w,
        y = rand() * h;
      blotch(c, rand, x, y, 8 + rand() * 10, colors.rustDeep, 0.7);
      drip(c, rand, x, y, 30 + rand() * 70, 3, colors.rustDeep, 0.45);
    }
  };
  const plate = (c: CanvasRenderingContext2D, [x, y, w, h]: Rect, brass: boolean): void => {
    c.fillStyle = colors.bone;
    c.fillRect(x, y, w, h);
    c.globalAlpha = brass ? 0.75 : 0.3;
    c.fillStyle = colors.sulfur;
    c.fillRect(x, y, w, h);
    c.globalAlpha = brass ? 0.25 : 0.1;
    c.fillStyle = colors.rust;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
    c.strokeStyle = colors.grime;
    c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);
    scratches(c, rand, [x, y, w, h], 10, colors.grime, 0.5);
    for (const rx of [x + 7, x + w - 7]) {
      c.fillStyle = colors.grime;
      c.beginPath();
      c.arc(rx, y + h / 2, 3, 0, Math.PI * 2);
      c.fill();
    }
  };
  const hammertone = (c: CanvasRenderingContext2D, w: number, h: number): void => {
    c.fillStyle = colors.soot;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++)
      blotch(c, rand, rand() * w, rand() * h, 4 + rand() * 8, colors.char, 0.5);
    for (let i = 0; i < 4; i++)
      blotch(c, rand, rand() * w, rand() * h, 6 + rand() * 10, colors.rustDeep, 0.6);
    scratches(c, rand, [0, 0, w, h], 20, colors.grime, 0.6);
  };

  const wornMark = (h: number, rnd: () => number, wear: number): HTMLCanvasElement => {
    const w = Math.ceil(suiMarkWidth(h));
    const [cv, cc] = layer(w, h);
    fillSuiMark(cc, 0, 0, h, colors.enamel);
    cc.globalCompositeOperation = "destination-out";
    for (let i = 0; i < (wear * w * h) / 60; i++)
      cc.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
    scratches(cc, rnd, [0, 0, w, h], Math.round(8 * wear), colors.soot, 0.9);
    return cv;
  };

  const [topCanvas, g] = layer(FW, TOP_H);
  const [topBase, tb] = layer(FW, TOP_H);
  const [drawerCanvas, dg] = layer(FW, DRAWER_H);
  const topTex = pixelTexture(topCanvas);
  const drawerTex = pixelTexture(drawerCanvas);
  topTex.userData.text = true;
  let link: { wallet: GameWallet; coinType: string } | null = null;
  const stickerSpace = (): void => {
    dg.translate(STICKER[0] + STICKER[2] / 2, STICKER[1] + STICKER[3] / 2);
    dg.rotate(-0.035);
    dg.translate(-STICKER[2] / 2, -STICKER[3] / 2);
  };
  function paintQr(): void {
    if (link === null) return;
    dg.save();
    stickerSpace();
    drawQr(dg, link.wallet.address, [6, 6, 112, 112], colors.soot);
    dg.restore();
    drawerTex.needsUpdate = true;
  }
  function paintStatic(): void {
    enamel(tb, FW, TOP_H);
    tb.fillStyle = colors.soot;
    tb.fillRect(WINDOW[0] - 5, WINDOW[1] - 5, WINDOW[2] + 10, WINDOW[3] + 10);
    plate(tb, PLATE, true);
    tb.fillStyle = colors.soot;
    tb.textAlign = "center";
    tb.textBaseline = "middle";
    const plateLines: [string, number, string][] = [
      ["T.V. SWITCH", 15, colors.soot],
      ["Serial No 666013", 10, colors.soot],
      ["240 V  50 Hz", 10, colors.soot],
      ["WARNING 160 W MAX", 10, colors.bloodDeep],
      ["HORROR TUBE LTD", 10, colors.soot],
    ];
    const worn = seeded(66);
    const markH = PLATE[3] - 12;
    const markW = suiMarkWidth(markH);
    const markX = PLATE[0] + 12;
    const markY = PLATE[1] + 6;
    tb.globalAlpha = 0.5;
    fillSuiMark(tb, markX - 1, markY - 1, markH, colors.soot);
    fillSuiMark(tb, markX + 1, markY + 1, markH, colors.bone);
    tb.globalAlpha = 0.3;
    fillSuiMark(tb, markX, markY, markH, colors.grime);
    tb.globalAlpha = 0.9;
    tb.drawImage(wornMark(markH, worn, 1), markX, markY);
    tb.globalAlpha = 1;
    const textLeft = markX + markW + 4;
    const textW = PLATE[0] + PLATE[2] - 12 - textLeft;
    plateLines.forEach(([text, size, ink], i) => {
      tb.fillStyle = ink;
      tb.font = `${size === 15 ? "700 " : ""}${size}px ${size === 15 ? "Silkscreen" : "DotGothic16"}`;
      tb.fillText(text, textLeft + textW / 2, PLATE[1] + 18 + i * 15, textW);
    });
    tb.fillStyle = colors.soot;
    for (const vx of [18, FW - 32]) tb.fillRect(vx, DRUM[1] + 10, 14, 5);
    tb.fillRect(DRUM[0] - 4, DRUM[1] - 4, DRUM[2] + 8, DRUM[3] + 8);
    tb.fillStyle = colors.soot;
    tb.beginPath();
    tb.arc(DIAL.x, DIAL.y, DIAL.r + 8, 0, Math.PI * 2);
    tb.fill();
    tb.fillStyle = colors.bone;
    tb.beginPath();
    tb.arc(DIAL.x, DIAL.y, DIAL.r, 0, Math.PI * 2);
    tb.fill();
    tb.globalAlpha = 0.35;
    tb.fillStyle = colors.grime;
    tb.fill();
    tb.globalAlpha = 1;
    tb.strokeStyle = colors.grime;
    tb.lineWidth = 1;
    for (let k = 0; k < 14; k++) {
      tb.globalAlpha = 0.25;
      tb.beginPath();
      tb.arc(DIAL.x, DIAL.y, 20 + rand() * (DIAL.r - 24), rand() * 6, rand() * 6 + 1.5);
      tb.stroke();
    }
    tb.globalAlpha = 1;
    tb.fillStyle = colors.soot;
    tb.font = "700 11px Silkscreen";
    const ring = "VIEWER CREDIT";
    [...ring].forEach((ch, i) => {
      const a = -Math.PI / 2 + (i - (ring.length - 1) / 2) * 0.145;
      tb.save();
      tb.translate(DIAL.x + Math.cos(a) * (DIAL.r - 12), DIAL.y + Math.sin(a) * (DIAL.r - 12));
      tb.rotate(a + Math.PI / 2);
      tb.fillText(ch, 0, 0);
      tb.restore();
    });
    tb.font = "700 12px Silkscreen";
    [15, 35, 55, 75, 95, 115].forEach((v, i) => {
      const a = Math.PI * (0.2 + i * 0.12);
      tb.fillText(
        String(v),
        DIAL.x + Math.cos(a) * (DIAL.r - 16),
        DIAL.y + Math.sin(a) * (DIAL.r - 16),
      );
    });
    tb.font = "700 20px Silkscreen";
    tb.fillText("USDC", DIAL.x, DIAL.y + 40);
    tb.save();
    tb.translate(DIAL.x, DIAL.y);
    tb.fillStyle = colors.soot;
    tb.fillRect(-4, -DIAL.r + 26, 8, 44);
    tb.restore();
    blotch(tb, rand, DIAL.x, DIAL.y - DIAL.r + 48, 30, colors.grime, 0.35);
    crack(tb, seeded(9), DIAL.x - 60, DIAL.y + 10, 60, 0.9, colors.grime);
    enamel(dg, FW, DRAWER_H);
    dg.fillStyle = colors.soot;
    dg.fillRect(0, 0, FW, 3);
    plate(dg, RULES, false);
    dg.fillStyle = colors.soot;
    dg.textAlign = "center";
    dg.textBaseline = "middle";
    dg.font = "11px DotGothic16";
    [
      "VIEWING IS COMPLIMENTARY.",
      "WAGERS REQUIRE CREDIT.",
      "DROP TOKENS. TURN THE DIAL.",
      "SELECT LOCK TO WITHDRAW.",
      "PLEASE CHECK YOUR WAGER.",
      "THE RESIDENTS CANNOT.",
    ].forEach((line, i) => dg.fillText(line, FW / 2, RULES[1] + 14 + i * 14.5));
    dg.save();
    stickerSpace();
    plate(dg, [0, 0, STICKER[2], STICKER[3]], false);
    dg.textAlign = "left";
    dg.fillStyle = colors.soot;
    dg.font = "700 16px Silkscreen";
    dg.fillText("PAY", 126, 24);
    dg.fillText("BY", 126, 44);
    dg.fillText("PHONE", 126, 64);
    dg.font = "10px DotGothic16";
    dg.fillStyle = colors.bloodDeep;
    dg.fillText("HORROR TUBE", 126, 88);
    dg.fillText("TV RENTALS", 126, 100);
    dg.fillStyle = colors.soot;
    dg.fillText("DO NOT TAMPER", 126, 112);
    dg.fillStyle = colors.grime;
    dg.beginPath();
    dg.moveTo(STICKER[2], STICKER[3] - 24);
    dg.lineTo(STICKER[2] - 24, STICKER[3]);
    dg.lineTo(STICKER[2], STICKER[3]);
    dg.fill();
    dg.restore();
    drawerTex.needsUpdate = true;
    paintQr();
  }
  paintStatic();

  const [shellCanvas, sg] = layer(64, 192);
  hammertone(sg, 64, 192);
  const shellTex = pixelTexture(shellCanvas);
  const dim = new THREE.Color().setScalar(0.62);
  const shell = new THREE.MeshLambertMaterial({ map: shellTex });
  const topFace = new THREE.MeshLambertMaterial({ map: topTex, color: dim });
  const drawerFace = new THREE.MeshLambertMaterial({ map: drawerTex, color: dim });
  const chrome = new THREE.MeshLambertMaterial({
    color: new THREE.Color(colors.bone).multiplyScalar(0.5),
  });
  const brass = new THREE.MeshLambertMaterial({
    color: new THREE.Color(colors.sulfur).lerp(new THREE.Color(colors.rustDeep), 0.45),
  });
  const iron = new THREE.MeshLambertMaterial({ color: colors.grime });
  const front = SIZE.d / 2;
  const at = (tx: number, ty: number): [number, number] => [
    (tx - FW / 2) / PX,
    SIZE.top / 2 - ty / PX,
  ];

  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(SIZE.w, SIZE.top, SIZE.d), [
    shell,
    shell,
    shell,
    shell,
    topFace,
    shell,
  ]);
  box.position.y = SIZE.drawer / 2;
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(SIZE.w - 0.004, SIZE.drawer, SIZE.d - 0.01), [
    shell,
    shell,
    shell,
    shell,
    drawerFace,
    shell,
  ]);
  drawer.position.set(0, -SIZE.top / 2, 0.005);
  const pull = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0028, 5, 10, Math.PI), chrome);
  pull.rotation.z = Math.PI;
  pull.position.set(0, SIZE.drawer / 2 - (RULES[1] + RULES[3] + 10) / PX, front - 0.001);
  drawer.add(pull);
  const roof = new THREE["Shape"]();
  roof.moveTo(-SIZE.d / 2, 0);
  roof.lineTo(SIZE.d / 2, 0);
  roof.lineTo(0, 0.026);
  roof.lineTo(-SIZE.d / 2, 0);
  const capGeo = new THREE.ExtrudeGeometry(roof, { depth: SIZE.w + 0.004, bevelEnabled: false });
  capGeo.translate(0, 0, -(SIZE.w + 0.004) / 2);
  capGeo.rotateY(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, shell);
  cap.position.y = SIZE.drawer / 2 + SIZE.top / 2;
  group.add(box, drawer, cap);

  const [dialX, dialY] = at(DIAL.x, DIAL.y);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(DIAL.r / PX + 0.003, 0.004, 4, 12), chrome);
  bezel.position.set(dialX, dialY + box.position.y, front + 0.002);
  const handle = new THREE.Group();
  handle.position.set(dialX, dialY + box.position.y, front + 0.006);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 10), chrome);
  hub.rotation.x = Math.PI / 2;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.009, 0.004),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(colors.bone).multiplyScalar(0.3) }),
  );
  blade.position.z = 0.004;
  const slit = new THREE.Mesh(
    new THREE.BoxGeometry(TOKEN.r * 2.3, 0.0028, 0.0012),
    new THREE.MeshBasicMaterial({ color: colors.soot }),
  );
  slit.position.z = 0.0065;
  handle.add(hub, blade, slit);
  handle.rotation.z = HANDLE_REST;
  const [stapleX, stapleY] = at(DIAL.x + DIAL.r - 6, DIAL.y + DIAL.r + 10);
  const staple = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0022, 5, 10, Math.PI), iron);
  staple.rotation.x = Math.PI / 2;
  staple.position.set(stapleX, stapleY + box.position.y, front + 0.003);
  const lock = new THREE.Group();
  lock.position.set(stapleX, stapleY + box.position.y - 0.002, front + 0.009);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0028, 6, 12, Math.PI), chrome);
  shackle.position.y = -0.01;
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.03, 0.014), brass);
  lockBody.position.y = -0.024;
  const keyhole = new THREE.Mesh(
    new THREE.BoxGeometry(0.003, 0.009, 0.001),
    new THREE.MeshBasicMaterial({ color: colors.soot }),
  );
  keyhole.position.set(0, -0.028, 0.0075);
  lock.add(shackle, lockBody, keyhole);
  lock.rotation.z = 0.12;
  group.add(bezel, handle, staple, lock);

  const metals = {
    1: [colors.rust, colors.rustDeep],
    5: [colors.bone, colors.grime],
    10: [colors.sulfur, colors.rustDeep],
  } satisfies Record<Coin, [face: string, dark: string]>;
  const tokenGeo = {
    face: new THREE.CircleGeometry(TOKEN.r, 18),
    edge: new THREE.CylinderGeometry(TOKEN.r, TOKEN.r, TOKEN.t, 18, 1, true),
    rim: new THREE.TorusGeometry(TOKEN.r - 0.001, 0.0013, 6, 24),
  };
  tokenGeo.edge.rotateX(Math.PI / 2);
  type TokenLook = { face: THREE.Material; edge: THREE.Material };
  const paintToken = (coin: Coin): TokenLook => {
    const [base, dark] = metals[coin];
    const [c, x] = layer(TOKEN.px, TOKEN.px);
    const mid = TOKEN.px / 2;
    x.fillStyle = base;
    x.beginPath();
    x.arc(mid, mid, mid, 0, Math.PI * 2);
    x.fill();
    if (coin === 5) {
      x.globalAlpha = 0.35;
      x.fillStyle = colors.grime;
      x.fill();
      x.globalAlpha = 1;
    }
    const shine = x.createRadialGradient(mid - 22, mid - 26, 4, mid, mid, mid);
    shine.addColorStop(0, colors.bone);
    shine.addColorStop(1, dark);
    x.globalAlpha = 0.15;
    x.fillStyle = shine;
    x.fill();
    x.globalAlpha = 1;
    scratches(x, rand, [8, 8, TOKEN.px - 16, TOKEN.px - 16], 10, dark, 0.35);
    const ring = (r: number, width: number, ink: string, from = 0, to = Math.PI * 2): void => {
      x.strokeStyle = ink;
      x.lineWidth = width;
      x.beginPath();
      x.arc(mid, mid, r, from, to);
      x.stroke();
    };
    ring(mid - 3, 6, dark);
    x.globalAlpha = 0.6;
    ring(mid - 5, 2, colors.bone, Math.PI * 0.9, Math.PI * 1.6);
    x.globalAlpha = 1;
    ring(mid - 8, 2, dark);
    const markH = 46;
    const markX = mid - suiMarkWidth(markH) / 2;
    x.globalAlpha = 0.75;
    fillSuiMark(x, markX + 2, 12, markH, colors.soot);
    fillSuiMark(x, markX - 2, 8, markH, colors.bone);
    x.globalAlpha = 1;
    fillSuiMark(x, markX, 10, markH, base);
    x.drawImage(wornMark(markH, rand, 0.3), markX, 10);
    x.globalAlpha = 1;
    x.font = "700 50px Silkscreen";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.globalAlpha = 0.6;
    x.fillStyle = colors.bone;
    x.fillText(String(coin), mid + 2, 94);
    x.globalAlpha = 1;
    x.fillStyle = colors.soot;
    x.fillText(String(coin), mid, 92);
    const map = pixelTexture(c);
    const edge = new THREE.Color(base).multiplyScalar(0.55);
    return {
      face: new THREE.MeshLambertMaterial({
        map,
        emissiveMap: map,
        emissive: colors.bone,
        emissiveIntensity: 0.2,
      }),
      edge: new THREE.MeshLambertMaterial({ color: edge }),
    };
  };
  const tokenLook = {
    1: paintToken(1),
    5: paintToken(5),
    10: paintToken(10),
  } satisfies Record<Coin, TokenLook>;
  const makeToken = (coin: Coin): THREE.Group => {
    const { face, edge } = tokenLook[coin];
    const token = new THREE.Group();
    const front = new THREE.Mesh(tokenGeo.face, face);
    front.position.z = TOKEN.t / 2;
    const back = new THREE.Mesh(tokenGeo.face, face);
    back.position.z = -TOKEN.t / 2;
    back.rotation.y = Math.PI;
    token.add(front, back, new THREE.Mesh(tokenGeo.edge, edge));
    for (const z of [TOKEN.t / 2, -TOKEN.t / 2]) {
      const rim = new THREE.Mesh(tokenGeo.rim, edge);
      rim.position.z = z;
      token.add(rim);
    }
    token.rotation.order = "ZYX";
    return token;
  };

  const tray = new THREE.Group();
  const well = TOKEN.r + 0.0025;
  const pitch = well * 2 + 0.004;
  const trayW = pitch + 0.004;
  const trayH = COINS.length * pitch + 0.004;
  const rimD = 0.009;
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(trayW, trayH, 0.003),
    new THREE.MeshLambertMaterial({ color: colors.char }),
  );
  felt.position.z = -0.0015;
  const rim = (w: number, h: number, x: number, y: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, rimD), chrome);
    m.position.set(x, y, rimD / 2 - 0.003);
    return m;
  };
  const side = 0.003;
  tray.add(
    felt,
    rim(side, trayH + side * 2, -(trayW + side) / 2, 0),
    rim(side, trayH + side * 2, (trayW + side) / 2, 0),
    rim(trayW, side, 0, (trayH + side) / 2),
    rim(trayW, side, 0, -(trayH + side) / 2),
  );
  const wellGeo = new THREE.CylinderGeometry(well, well, 0.005, 20, 1, true);
  wellGeo.rotateX(Math.PI / 2);
  const wellMat = new THREE.MeshLambertMaterial({ color: colors.grime, side: THREE.DoubleSide });
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.01), iron);
  bracket.position.set(trayW / 2 + side + 0.009, 0, -0.006);
  tray.add(bracket);
  const trayTokens = COINS.map((coin, i) => {
    const y = trayH / 2 - 0.002 - (i + 0.5) * pitch;
    const cup = new THREE.Mesh(wellGeo, wellMat);
    cup.position.set(0, y, 0.0025);
    const token = makeToken(coin);
    token.position.set(0, y - (well - TOKEN.r), TOKEN.t / 2);
    tray.add(cup, token);
    return token;
  });
  tray.position.set(-(SIZE.w / 2 + trayW / 2 + side + 0.018), 0.035, front - 0.012);
  tray.rotation.x = -0.55;
  group.add(tray);

  let credit = 0;
  let status = "";
  let busy = false;
  const slot: Coin[] = [];
  type Flight = {
    token: THREE.Group;
    from: THREE.Vector3;
    home: THREE.Vector3 | null;
    start: number;
    back: boolean;
    rung: boolean;
  };
  const flights: Flight[] = [];
  let held: { coin: Coin; token: THREE.Group } | null = null;
  let waitingSince = 0;
  let cue = false;
  let turning = false;
  const spilled: THREE.Group[] = [];

  function draw(): void {
    g.drawImage(topBase, 0, 0);
    const [wx, wy, ww, wh] = WINDOW;
    g.fillStyle = colors.bone;
    g.fillRect(wx, wy, ww, wh);
    g.globalAlpha = 0.3;
    g.fillStyle = colors.sulfur;
    g.fillRect(wx, wy, ww, wh);
    g.globalAlpha = 1;
    const x0 = wx + 12,
      span = ww - 60;
    g.fillStyle = colors.bloodDeep;
    g.fillRect(x0 + span + 6, wy + 6, ww - span - 24, 26);
    g.fillStyle = colors.bone;
    g.font = "700 10px Silkscreen";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("FULL", x0 + span + 6 + (ww - span - 24) / 2, wy + 19);
    g.fillStyle = g.strokeStyle = colors.soot;
    g.lineWidth = 1;
    g.font = "700 13px Silkscreen";
    for (let v = 0; v <= FULL; v++) {
      const x = x0 + (v / FULL) * span;
      g.fillRect(x, wy + 6, 1, v % 4 === 0 ? 14 : 7);
      if (v % 4 === 0) g.fillText(String(v), x, wy + 30);
    }
    g.font = "12px DotGothic16";
    g.fillText("USDC CREDIT", wx + ww / 2 - 20, wy + 51);
    const nx = x0 + (Math.min(credit, FULL) / FULL) * span;
    g.fillStyle = colors.bloodDeep;
    g.fillRect(nx - 1, wy + 2, 3, wh - 4);
    g.fillStyle = colors.soot;
    g.fillRect(nx - 3, wy + wh - 6, 7, 4);
    const [dx, dy, dw, dh] = DRUM;
    const drum =
      status || (slot.length === 0 ? "" : cue ? "TURN DIAL" : `+${String(coinTotal(slot))} USDC`);
    if (drum) {
      g.fillStyle = colors.char;
      g.fillRect(dx, dy, dw, dh);
      g.fillStyle = colors.blood;
      g.font = "700 18px Silkscreen";
      g.fillText(drum, dx + dw / 2, dy + dh / 2 + 1);
    } else {
      const cell = (dw - 16) / 4;
      let x = dx;
      g.font = "700 34px Silkscreen";
      [...credit.toFixed(2).padStart(5, "0")].forEach((d, i) => {
        if (d === ".") {
          g.fillStyle = colors.blood;
          g.fillRect(x + 5, dy + dh - 10, 6, 6);
          x += 16;
          return;
        }
        g.fillStyle = i % 2 ? colors.char : colors.soot;
        g.fillRect(x + 1, dy, cell - 2, dh);
        g.fillStyle = colors.bone;
        g.fillText(d, x + cell / 2, dy + dh / 2 + 2);
        x += cell;
      });
    }
    topTex.needsUpdate = true;
  }

  function setStatus(text: string): void {
    status = text;
    draw();
  }

  const linked = (): { wallet: GameWallet; coinType: string } => {
    if (link === null) throw new Error("The coin box is not connected to your wallet yet.");
    return link;
  };

  async function refresh(): Promise<void> {
    if (link === null) return;
    const next = fromUsdcUnits(await getUsdcBalance(link.wallet, link.coinType));
    if (next === credit) return;
    sfx.meter();
    credit = next;
    onCredit(credit);
    draw();
  }

  async function deposit(): Promise<void> {
    const dollars = coinTotal(slot);
    const { wallet, coinType } = linked();
    const payer = await connectBrowserWallet();
    if (payer === null) throw new Error("Deposit cancelled. No wallet was connected.");
    const { balance } = await dAppKit.getClient().core.getBalance({ owner: payer, coinType });
    const held = BigInt(balance.balance);
    if (held < toUsdcUnits(dollars))
      throw new Error(
        `Your wallet holds ${fromUsdcUnits(held).toFixed(2)} USDC. The dial holds ${String(dollars)} USDC in tokens.`,
      );
    setStatus("INSERTING");
    await depositUsdc(wallet, coinType, payer, toUsdcUnits(dollars), async (txBytes) => {
      const signed = await dAppKit.signTransaction({ transaction: txBytes });
      return signed.signature;
    });
    slot.length = 0;
    rememberPayout(payer);
    say(`${String(dollars)} USDC deposited. Thank you.`);
  }

  async function withdraw(): Promise<void> {
    const { wallet, coinType } = linked();
    const units = await getUsdcBalance(wallet, coinType);
    if (units === 0n) return say("No credit remains in the meter.");
    const to = storedPayout() ?? (await connectBrowserWallet());
    if (to === null)
      throw new Error("Withdrawal cancelled. Connect a wallet to receive your credit.");
    setStatus("RETURNING");
    await sendUsdc(wallet, coinType, to, units);
    sfx.coins(10);
    spill(fromUsdcUnits(units));
    say(`${fromUsdcUnits(units).toFixed(2)} USDC returned to your wallet.`);
    await new Promise((done) => setTimeout(done, SPILL_MS));
  }

  function run(task: () => Promise<void>): void {
    if (busy) return;
    busy = true;
    task()
      .catch((error: Error) => {
        sfx.spat();
        onError(error.message);
      })
      .finally(() => {
        busy = false;
        setStatus("");
        void refresh();
      });
  }

  function turnHandle(): void {
    turning = true;
    handle.rotation.z = 1.3;
    setTimeout(() => {
      handle.rotation.z = HANDLE_REST;
      turning = false;
    }, 500);
  }

  function closeDrawer(): void {
    lock.rotation.z = 0.12;
    drawer.position.z = 0.005;
    drawer.remove(...spilled);
    spilled.length = 0;
  }

  function openDrawer(): void {
    if (busy) return;
    sfx.lever();
    lock.rotation.z = -0.6;
    drawer.position.z = 0.045;
    const opened = performance.now();
    run(() =>
      withdraw().finally(() => {
        setTimeout(closeDrawer, Math.max(0, 1200 - (performance.now() - opened)));
      }),
    );
  }

  function spill(dollars: number): void {
    const coins = tokensFor(dollars, SPILL_MAX);
    const top = SIZE.drawer / 2 + TOKEN.r * 0.5;
    coins.forEach((coin, i) => {
      const token = makeToken(coin);
      token.position.set((i - (coins.length - 1) / 2) * TOKEN.r * 1.9, top, SIZE.d / 2 - 0.03);
      token.rotation.set(-1 + (rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 1.2);
      drawer.add(token);
      spilled.push(token);
    });
  }

  const slitAt = (): THREE.Vector3 =>
    new THREE.Vector3(handle.position.x, handle.position.y, handle.position.z + 0.0065);
  const trayAt = (coin: Coin): THREE.Vector3 => {
    group.updateMatrixWorld();
    return group.worldToLocal(
      trayTokens[COINS.indexOf(coin)].getWorldPosition(new THREE.Vector3()),
    );
  };

  function fly(coin: Coin, back: boolean, delay = 0, from = trayAt(coin)): void {
    if (LOW) return;
    const token = makeToken(coin);
    group.add(token);
    const flight = { token, from, home: null, start: performance.now() + delay, back, rung: back };
    flights.push(flight);
    pose(flight, back ? 1 : 0);
  }

  function flyHome(coin: Coin, from: THREE.Vector3): void {
    if (LOW) return;
    const token = makeToken(coin);
    group.add(token);
    const home = trayAt(coin);
    flights.push({ token, from, home, start: performance.now(), back: false, rung: true });
    token.position.copy(from);
  }

  function pose(f: Flight, u: number): void {
    if (f.home !== null) {
      f.token.position.lerpVectors(f.from, f.home, u * u * (3 - 2 * u));
      return;
    }
    const split = FLY_MS / (FLY_MS + SINK_MS);
    const a = Math.min(u / split, 1);
    const ease = a * a * (3 - 2 * a);
    const slitPos = slitAt();
    const approach = slitPos.clone().setZ(slitPos.z + TOKEN.r + 0.002);
    f.token.position.lerpVectors(f.from, approach, ease);
    f.token.position.z += Math.sin(Math.PI * ease) * 0.03;
    if (u > split) f.token.position.z -= ((u - split) / (1 - split)) * (TOKEN.r * 2 + 0.004);
    f.token.rotation.set((-Math.PI / 2) * ease, 0, handle.rotation.z * ease);
  }

  function nudge(ms: number): void {
    const since = ms - waitingSince;
    const nextCue = slot.length > 0 && !busy && Math.floor(since / 1000) % 2 === 1;
    if (nextCue !== cue) {
      cue = nextCue;
      draw();
    }
    if (turning) return;
    if (LOW || busy || slot.length === 0) {
      handle.rotation.z = HANDLE_REST;
      return;
    }
    const phase = (since % NUDGE_EVERY_MS) - (NUDGE_EVERY_MS - NUDGE_MS);
    const k = phase < 0 ? 0 : phase / NUDGE_MS;
    handle.rotation.z = HANDLE_REST + 0.2 * Math.sin(k * Math.PI * 5) * (1 - k);
  }

  function tick(ms: number): void {
    nudge(ms);
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const p = (ms - f.start) / (f.home === null ? FLY_MS + SINK_MS : FLY_MS);
      if (p < 0) continue;
      if (!f.rung && p >= FLY_MS / (FLY_MS + SINK_MS)) {
        f.rung = true;
        sfx.coin();
      }
      if (p >= 1) {
        group.remove(f.token);
        flights.splice(i, 1);
      } else pose(f, f.back ? 1 - p : p);
    }
  }

  function drop(coin: Coin, from = trayAt(coin)): void {
    if (busy) return;
    if (slot.length === 0) waitingSince = performance.now();
    slot.push(coin);
    if (LOW) sfx.coin();
    fly(coin, false, 0, from);
    draw();
  }

  const dragPlane = new THREE.Plane();
  function drag(ray: THREE.Ray): void {
    if (held === null) return;
    group.updateMatrixWorld();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld);
    dragPlane.setFromNormalAndCoplanarPoint(
      normal,
      group.localToWorld(new THREE.Vector3(0, 0, front + 0.03)),
    );
    const hit = ray.intersectPlane(dragPlane, new THREE.Vector3());
    if (hit !== null) held.token.position.copy(group.worldToLocal(hit));
  }

  function grab(coin: Coin, ray: THREE.Ray): boolean {
    if (busy || held !== null) return false;
    const token = makeToken(coin);
    token.position.copy(trayAt(coin));
    group.add(token);
    held = { coin, token };
    sfx.slide();
    drag(ray);
    return true;
  }

  function release(click: boolean): void {
    if (held === null) return;
    const { coin, token } = held;
    held = null;
    group.remove(token);
    const at = token.position.clone();
    const slitPos = slitAt();
    const onDial = Math.hypot(at.x - slitPos.x, at.y - slitPos.y) <= (DIAL.r + 8) / PX + 0.01;
    if (click || onDial) drop(coin, at);
    else flyHome(coin, at);
  }

  function returnSlot(): void {
    if (slot.length === 0) return;
    slot.forEach((coin, i) => fly(coin, true, i * 90));
    sfx.coins(slot.length);
    slot.length = 0;
    draw();
  }

  function turn(): void {
    if (busy) return;
    if (slot.length === 0) {
      sfx.spat();
      say("The dial will not turn without a token.");
      return;
    }
    turnHandle();
    run(() => deposit().finally(returnSlot));
  }

  draw();
  void document.fonts.ready.then(() => {
    paintStatic();
    draw();
  });
  setInterval(() => void refresh().catch(() => undefined), 4000);

  return {
    group,
    waiting: () => coinTotal(slot),
    drop,
    grab,
    drag,
    release,
    turn,
    giveBack: () => {
      if (!busy) returnSlot();
    },
    tick,
    address: () => link?.wallet.address ?? null,
    connect: (wallet, coinType) => {
      link = { wallet, coinType };
      paintQr();
      void refresh().catch((error: Error) =>
        console.error(`Coin box balance read failed: ${error.message}`),
      );
    },
    credit: () => credit,
    partAt: (hit) => {
      const coin = COINS[trayTokens.findIndex((t) => t === hit.object.parent)];
      if (coin !== undefined) return coin;
      if (hit.object.parent === handle) return "handle";
      if (hit.object === staple || hit.object.parent === lock || hit.object.parent === drawer)
        return "lock";
      if (hit.uv === undefined || hit.face?.materialIndex !== 4) return "body";
      if (hit.object === box) {
        const [x, y] = [hit.uv.x * FW, (1 - hit.uv.y) * TOP_H];
        return Math.hypot(x - DIAL.x, y - DIAL.y) <= DIAL.r + 8 ? "handle" : "body";
      }
      if (hit.object !== drawer) return "body";
      return inside(STICKER, hit.uv.x * FW, (1 - hit.uv.y) * DRAWER_H) ? "sticker" : "lock";
    },
    view: (at) => {
      group.updateMatrixWorld();
      const y =
        at === "sticker"
          ? drawer.position.y + SIZE.drawer / 2 - (STICKER[1] + STICKER[3] / 2) / PX
          : 0.02;
      const dist = at === "sticker" ? 0.17 : 0.44;
      const x = at === "sticker" ? 0 : -0.02;
      return [
        group.localToWorld(new THREE.Vector3(x, y, front + dist)),
        group.localToWorld(new THREE.Vector3(x, y, front)),
      ];
    },
    open: openDrawer,
  };
}
