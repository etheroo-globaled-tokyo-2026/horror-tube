import { createDAppKit } from "@mysten/dapp-kit-core";
import "@mysten/dapp-kit-core/web";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import QRCode from "qrcode";
import * as THREE from "three";

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

export type CoinBoxPart = "slot" | "sticker" | "lever";

export type CoinBox = {
  group: THREE.Group;
  partAt: (ray: THREE.Raycaster) => CoinBoxPart | null;
  use: (part: CoinBoxPart) => void;
};

type Rect = [x: number, y: number, w: number, h: number];

const FW = 96;
const FH = 144;
const METER: Rect = [10, 22, 76, 26];
const SLOT: Rect = [38, 56, 20, 30];
const STICKER: Rect = [14, 92, 68, 46];

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

function panel(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "coinbox";
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

export function createCoinBox(
  wallet: GameWallet,
  onCredit: (usdc: number) => void,
  say: (text: string) => void,
): CoinBox {
  const colors = {
    soot: cssVar("soot"),
    char: cssVar("char"),
    grime: cssVar("grime"),
    rust: cssVar("rust"),
    blood: cssVar("blood"),
    sulfur: cssVar("sulfur"),
    bone: cssVar("bone"),
    alive: cssVar("alive") || cssVar("sulfur"),
  };
  const canvas = document.createElement("canvas");
  canvas.width = FW;
  canvas.height = FH;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("Coin box needs a 2D canvas.");
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const body = new THREE.MeshLambertMaterial({ color: colors.grime });
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.16), [
    body,
    body,
    body,
    body,
    new THREE.MeshLambertMaterial({ map: texture }),
    body,
  ]);
  group.add(box);
  const lever = new THREE.Group();
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6),
    new THREE.MeshLambertMaterial({ color: colors.char }),
  );
  arm.position.y = 0.05;
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 8, 6),
    new THREE.MeshLambertMaterial({ color: colors.blood }),
  );
  knob.position.y = 0.1;
  lever.add(arm, knob);
  lever.position.set(0.11, 0.02, 0.03);
  group.add(lever);

  let credit = 0;
  let status = "";
  let busy = false;

  function draw(): void {
    if (g === null) return;
    g.fillStyle = colors.char;
    g.fillRect(0, 0, FW, FH);
    g.fillStyle = colors.rust;
    g.fillRect(0, 0, FW, 14);
    g.fillStyle = colors.bone;
    g.font = "700 10px Silkscreen";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("COIN TV", FW / 2, 8);
    g.fillStyle = colors.soot;
    g.fillRect(...METER);
    g.fillStyle = credit > 0 ? colors.sulfur : colors.blood;
    g.font = "700 9px Silkscreen";
    g.fillText(status || "CREDIT", FW / 2, METER[1] + 7);
    g.font = "700 13px Silkscreen";
    g.fillText(credit.toFixed(2), FW / 2, METER[1] + 19);
    g.fillStyle = colors.grime;
    g.fillRect(...SLOT);
    g.fillStyle = colors.soot;
    g.fillRect(SLOT[0] + 8, SLOT[1] + 4, 4, SLOT[3] - 8);
    g.fillStyle = colors.bone;
    g.fillRect(...STICKER);
    drawQr(g, wallet.address, [STICKER[0] + 2, STICKER[1] + 2, 34, 34], colors.soot);
    g.fillStyle = colors.soot;
    g.font = "700 8px Silkscreen";
    g.textAlign = "left";
    g.fillText("PAY", STICKER[0] + 40, STICKER[1] + 12);
    g.fillText("BY", STICKER[0] + 40, STICKER[1] + 22);
    g.fillText("PHONE", STICKER[0] + 40, STICKER[1] + 32);
    texture.needsUpdate = true;
  }

  function setStatus(text: string): void {
    status = text;
    draw();
  }

  async function refresh(): Promise<void> {
    const next = fromUsdcUnits(await getUsdcBalance(wallet));
    if (next === credit) return;
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
    say(`${fromUsdcUnits(units).toFixed(2)} USDC back to your wallet.`);
  }

  const slotPanel = panel();
  slotPanel.innerHTML = `<h2 class="lit">INSERT A COIN</h2><p>Your wallet opens once to approve.</p>
    <div class="row">${COINS.map((c) => `<button class="btn primary" data-cursor="coin" value="${c}">${c} USDC</button>`).join("")}</div>
    <div class="row"><button class="btn" value="0">WALK AWAY</button></div>`;
  slotPanel.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    slotPanel.close();
    const dollars = Number(event.target.value);
    if (dollars > 0) run(() => deposit(dollars));
  });

  const stickerPanel = panel();
  const qr = document.createElement("canvas");
  void QRCode.toCanvas(qr, wallet.address, { margin: 2, scale: 6 });
  stickerPanel.innerHTML = `<h2 class="lit">PAY BY PHONE</h2><p>Send testnet USDC on Sui to this box. The meter counts up when it lands.</p>`;
  const address = document.createElement("p");
  address.className = "ens";
  address.textContent = wallet.address;
  const close = document.createElement("button");
  close.className = "btn";
  close.textContent = "PUT IT BACK";
  close.addEventListener("click", () => stickerPanel.close());
  stickerPanel.append(qr, address, close);

  const errorPanel = panel();
  errorPanel.innerHTML = `<h2 class="lit">THE BOX SPAT IT OUT</h2>`;
  const errorText = document.createElement("p");
  const errorClose = document.createElement("button");
  errorClose.className = "btn";
  errorClose.textContent = "OK";
  errorClose.addEventListener("click", () => errorPanel.close());
  errorPanel.append(errorText, errorClose);

  function showError(message: string): void {
    errorText.textContent = message;
    if (!errorPanel.open) errorPanel.showModal();
  }

  function run(task: () => Promise<void>): void {
    if (busy) return;
    busy = true;
    task()
      .catch((error: Error) => showError(error.message))
      .finally(() => {
        busy = false;
        setStatus("");
        void refresh();
      });
  }

  function pullLever(): void {
    lever.rotation.x = -0.6;
    setTimeout(() => (lever.rotation.x = 0), 400);
    run(withdraw);
  }

  draw();
  void refresh();
  setInterval(() => void refresh().catch(() => undefined), 4000);

  return {
    group,
    partAt: (ray) => {
      const hit = ray.intersectObjects([box, lever], true)[0];
      if (hit === undefined) return null;
      if (hit.object !== box) return "lever";
      if (hit.uv === undefined || hit.face?.materialIndex !== 4) return null;
      const x = hit.uv.x * FW;
      const y = (1 - hit.uv.y) * FH;
      if (inside(SLOT, x, y)) return "slot";
      if (inside(STICKER, x, y)) return "sticker";
      return null;
    },
    use: (part) => {
      if (part === "slot") slotPanel.showModal();
      else if (part === "sticker") stickerPanel.showModal();
      else pullLever();
    },
  };
}
