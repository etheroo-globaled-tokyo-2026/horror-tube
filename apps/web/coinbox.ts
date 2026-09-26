import { createDAppKit } from "@mysten/dapp-kit-core";
import "@mysten/dapp-kit-core/web";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import QRCode from "qrcode";
import * as THREE from "three";

import { sfx } from "./sfx.ts";
import { blotch, crack, drip, scratches, seeded } from "./sprites.ts";

import {
  type GameWallet,
  SUI_TESTNET_GRPC,
  fromUsdcUnits,
  getSuiBalance,
  getUsdcBalance,
  sendUsdc,
  toUsdcUnits,
  usdcTransfer,
} from "./wallet.ts";

export const COINS = [5, 10, 20] as const;

export const PAYOUT_STORAGE_KEY = "horror-tube.payout-address";

export type CoinBoxPart = "slot" | "sticker" | "lock" | "body";
export type CoinBoxView = "meter" | "sticker";

export type CoinBox = {
  group: THREE.Group;
  address: string;
  credit: () => number;
  partAt: (ray: THREE.Raycaster) => CoinBoxPart | null;
  view: (at: CoinBoxView) => [eye: THREE.Vector3, target: THREE.Vector3];
  insert: (usdc: number) => void;
  open: () => void;
};

type Rect = [x: number, y: number, w: number, h: number];

const SIZE = { w: 0.128, top: 0.22, drawer: 0.148, d: 0.11 };
const PX = 2000;
const FW = SIZE.w * PX;
const TOP_H = SIZE.top * PX;
const DRAWER_H = SIZE.drawer * PX;
const WINDOW: Rect = [32, 22, 192, 64];
const PLATE: Rect = [32, 96, 192, 72];
const DRUM: Rect = [24, 172, 208, 42];
const DIAL = { x: FW / 2, y: 316, r: 92 };
const RULES: Rect = [40, 12, 176, 100];
const STICKER: Rect = [12, 158, 232, 124];
const FULL = 20;

const dAppKit = createDAppKit({
  networks: ["testnet"],
  defaultNetwork: "testnet",
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: SUI_TESTNET_GRPC }),
});

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
  wallet: GameWallet,
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

  const [topCanvas, g] = layer(FW, TOP_H);
  const [topBase, tb] = layer(FW, TOP_H);
  const [drawerCanvas, dg] = layer(FW, DRAWER_H);
  const topTex = pixelTexture(topCanvas);
  const drawerTex = pixelTexture(drawerCanvas);
  topTex.userData.text = true;
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
      ["Volts 200/250  Cycles 50", 10, colors.soot],
      ["WARNING  Load 90-160 watts", 10, colors.bloodDeep],
      ["HORROR TUBE METERS LTD", 10, colors.soot],
    ];
    plateLines.forEach(([text, size, ink], i) => {
      tb.fillStyle = ink;
      tb.font = `${size === 15 ? "700 " : ""}${size}px ${size === 15 ? "Silkscreen" : "DotGothic16"}`;
      tb.fillText(text, FW / 2, PLATE[1] + 13 + i * 13);
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
    const ring = "MINUTES PER COIN";
    [...ring].forEach((ch, i) => {
      const a = -Math.PI / 2 + (i - (ring.length - 1) / 2) * 0.13;
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
      "TURN HANDLE TO LEFT",
      "INSERT COIN IN SLOT",
      "TURN HANDLE TO RIGHT.",
      "DO NOT INSERT MORE COINS",
      "AFTER POINTER INDICATES FULL.",
      "DO NOT USE DAMAGED COINS",
    ].forEach((line, i) => dg.fillText(line, FW / 2, RULES[1] + 14 + i * 14.5));
    dg.save();
    dg.translate(STICKER[0] + STICKER[2] / 2, STICKER[1] + STICKER[3] / 2);
    dg.rotate(-0.035);
    dg.translate(-STICKER[2] / 2, -STICKER[3] / 2);
    plate(dg, [0, 0, STICKER[2], STICKER[3]], false);
    drawQr(dg, wallet.address, [6, 6, 112, 112], colors.soot);
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
  handle.add(hub, blade);
  handle.rotation.z = 0.35;
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

  let credit = 0;
  let status = "";
  let busy = false;

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
    g.fillText("USDC PAID FOR", wx + ww / 2 - 20, wy + 51);
    const nx = x0 + (Math.min(credit, FULL) / FULL) * span;
    g.fillStyle = colors.bloodDeep;
    g.fillRect(nx - 1, wy + 2, 3, wh - 4);
    g.fillStyle = colors.soot;
    g.fillRect(nx - 3, wy + wh - 6, 7, 4);
    const [dx, dy, dw, dh] = DRUM;
    if (status) {
      g.fillStyle = colors.char;
      g.fillRect(dx, dy, dw, dh);
      g.fillStyle = colors.blood;
      g.font = "700 18px Silkscreen";
      g.fillText(status, dx + dw / 2, dy + dh / 2 + 1);
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

  async function refresh(): Promise<void> {
    const next = fromUsdcUnits(await getUsdcBalance(wallet));
    if (next === credit) return;
    sfx.meter();
    credit = next;
    onCredit(credit);
    draw();
  }

  async function deposit(dollars: number): Promise<void> {
    const payer = await connectBrowserWallet();
    if (payer === null) throw new Error("No wallet connected. The slot stays shut.");
    const gas = await dAppKit.getClient().core.getBalance({ owner: payer });
    if (BigInt(gas.balance.balance) === 0n)
      throw new Error(
        "Your wallet has no testnet SUI to pay the gas. Get some at faucet.sui.io, then try again.",
      );
    setStatus("INSERTING");
    const result = await dAppKit.signAndExecuteTransaction({
      transaction: usdcTransfer(wallet.address, toUsdcUnits(dollars)),
    });
    if (result.$kind === "FailedTransaction")
      throw new Error(result.FailedTransaction.status.error?.message ?? "Deposit failed");
    await dAppKit.getClient().core.waitForTransaction({ digest: result.Transaction.digest });
    rememberPayout(payer);
    sfx.coin();
    say(`${dollars} USDC in. The meter ticks up.`);
  }

  async function withdraw(): Promise<void> {
    const units = await getUsdcBalance(wallet);
    if (units === 0n) return say("Nothing to give back.");
    if ((await getSuiBalance(wallet)) === 0n)
      throw new Error("The coin return is jammed: the box has no testnet SUI to pay the gas.");
    const to = storedPayout() ?? (await connectBrowserWallet());
    if (to === null) throw new Error("No wallet connected to pay back to.");
    setStatus("RETURNING");
    await sendUsdc(wallet, to, units);
    sfx.coins(10);
    say(`${fromUsdcUnits(units).toFixed(2)} USDC back to your wallet.`);
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
    handle.rotation.z = 1.3;
    setTimeout(() => (handle.rotation.z = 0.35), 500);
  }

  function openDrawer(): void {
    sfx.lever();
    lock.rotation.z = -0.6;
    drawer.position.z = 0.045;
    setTimeout(() => {
      lock.rotation.z = 0.12;
      drawer.position.z = 0.005;
    }, 1200);
    run(withdraw);
  }

  draw();
  void document.fonts.ready.then(() => {
    paintStatic();
    draw();
  });
  void refresh();
  setInterval(() => void refresh().catch(() => undefined), 4000);

  return {
    group,
    address: wallet.address,
    credit: () => credit,
    partAt: (ray) => {
      const hit = ray.intersectObject(group, true)[0];
      if (hit === undefined) return null;
      if (hit.object.parent === handle) return "slot";
      if (hit.object === staple || hit.object.parent === lock || hit.object.parent === drawer)
        return "lock";
      if (hit.uv === undefined || hit.face?.materialIndex !== 4) return "body";
      if (hit.object === box) {
        const [x, y] = [hit.uv.x * FW, (1 - hit.uv.y) * TOP_H];
        return Math.hypot(x - DIAL.x, y - DIAL.y) <= DIAL.r + 8 ? "slot" : "body";
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
      return [
        group.localToWorld(new THREE.Vector3(0, y, front + dist)),
        group.localToWorld(new THREE.Vector3(0, y, front)),
      ];
    },
    insert: (usdc) => {
      turnHandle();
      run(() => deposit(usdc));
    },
    open: openDrawer,
  };
}
