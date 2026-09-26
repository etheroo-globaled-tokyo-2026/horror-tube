import * as THREE from "three";
import {
  $,
  DUR,
  S,
  chooseNextFighter,
  hooks,
  loadBettingIds,
  setWallet,
  startBout,
  usd,
  voteSide,
  type Phase,
} from "./game.ts";
import { type CoinBoxPart, type CoinBoxView, createCoinBox, isCoin } from "./coinbox.ts";
import { COINS } from "./coin-tokens.ts";
import { SUI_MARK_SVG } from "./sui-mark.ts";
import { canBet, canCollect } from "./betting.ts";
import { getGameWallet, hasWalletSession, type GameWallet } from "./wallet.ts";
import { ambience, isMuted, sfx, toggleMute } from "./sfx.ts";
import { COL } from "./room-palette.ts";
import {
  T,
  VCR,
  Z,
  W8,
  LOW,
  boutNumber,
  num,
  reelById,
  say,
  walkRef,
  type WalkStep,
} from "./room-state.ts";
import { errorHint, esc } from "./hint.ts";
import { typedFighterId, typedStake } from "./typed-fighter.ts";
import { canvas, camera, draw, renderer, scene } from "./room-render.ts";
import { lambert, shade, TV_Y } from "./room-materials.ts";
import { ambient, bulb, bulbLight, drift, halo, motes } from "./room-shell.ts";
import {
  drawPaper,
  enterRoom,
  nextGateStep,
  noOrb,
  paper,
  paperFlag,
  sign,
  store,
  waiverHooks,
} from "./room-waiver.ts";
import { drawTV, mask, syncVideo, tv, tvGlow, tvNoise, video, vidMode } from "./room-tv.ts";
import { powerOff, powerStage, tickPower } from "./room-power.ts";
import { keyById, led, remote } from "./room-remote.ts";
import { shelf, tape, TAPE, updateTape } from "./room-shelf.ts";
import { boutTitle, reels, refreshTapes, shownTapes, updateVcr, vcr } from "./room-vcr.ts";

const COIN_KEYS = new Map<string, CoinBoxPart>([
  ["d", "body"],
  ["p", "sticker"],
  ["w", "lock"],
]);

const busy = (): boolean => powerStage(performance.now()) !== "";
function hintText(): void {
  const h = $("#hint");
  if (busy()) {
    h.innerHTML = "";
    return;
  }
  const b = (s: string): string => `<b>${s}</b>`;
  const step = WALK[walkRef.n];
  if (step) {
    h.innerHTML = `${step.say} <span class="hint-key">ENTER</span>`;
    return;
  }
  const credit = `${usd(coinBox.credit())} USDC`;
  const waiting = coinBox.waiting();
  const collect =
    S.pending === "claim" ? " · COLLECTING…" : canCollect(S) ? ` · COLLECT ${b("OK")}` : "";
  const meter = Z.error
    ? `${b("COIN BOX NOTICE")} ${esc(Z.error)}`
    : Z.at === "sticker"
      ? `${b("PAY BY PHONE")} testnet USDC on Sui to <span class="addr">${coinBox.address() ?? ""}</span>`
      : Z.at !== null && isCoin(Z.hover)
        ? `${b("TOKEN")} ${SUI_MARK_SVG} ${String(Z.hover)} USDC ${b(String(COINS.indexOf(Z.hover) + 1))}`
        : Z.at !== null && Z.hover === "handle"
          ? waiting > 0
            ? `${b("COIN DIAL")} TURN FOR ${String(waiting)} USDC ${b("ENTER")}`
            : `${b("COIN DIAL")} DROP A TOKEN FIRST`
          : Z.at !== null && Z.hover === "lock"
            ? `${b("PADLOCK")} ${credit} inside`
            : Z.at !== null && Z.hover === "sticker"
              ? b("PAY BY PHONE")
              : Z.at !== null && waiting > 0
                ? `${b("COIN METER")} +${String(waiting)} USDC WAITING · TURN THE DIAL ${b("ENTER")}`
                : Z.at !== null
                  ? `${b("COIN METER")} ${credit} · DRAG A TOKEN TO THE DIAL ${b("1 2 3")}`
                  : Z.hover !== null
                    ? `${b("COIN METER")} ${credit}`
                    : "";
  if (meter) {
    h.innerHTML = Z.at === null ? meter : `${meter} <span class="hint-key">ESC</span>`;
    return;
  }
  const error = errorHint(S);
  if (error !== null) {
    h.innerHTML = error;
    return;
  }
  const reel = reelById(VCR.hover);
  if (reel) {
    h.innerHTML = `${b(`BOUT ${num(boutNumber(reel))}`)} ${esc(boutTitle(reel))}`;
    return;
  }
  if (VCR.over) {
    h.innerHTML = `${b("VCR")} ${VCR.loaded ? "EJECT" : VCR.held ? "PLAY THE TAPE" : "TAKE A TAPE FROM THE SHELF"}`;
    return;
  }
  if (VCR.held) {
    h.innerHTML = `CLICK THE ${b("VCR")} ON THE TV TO PLAY · CLICK THE TAPE TO PUT IT BACK`;
    return;
  }
  h.innerHTML =
    S.phase === "gate"
      ? W8.step === "read"
        ? `SIGN WITH WORLD ID ${b("ENTER")}`
        : W8.step === "scan"
          ? `SCAN WITH ${b("WORLD APP")}${W8.qrUri === "" ? "" : ` <button data-copy-link>COPY LINK</button>`}`
          : W8.step === "wallet"
            ? `${b("VIEWER REGISTERED")} · OPENING YOUR WALLET`
            : W8.down !== ""
              ? `${b("ENTRY IS DOWN")} ${esc(W8.down)}`
              : W8.fail !== ""
                ? `${b("ENTRY INCOMPLETE")} ${esc(W8.fail)} · TRY AGAIN ${b("ENTER")}`
                : W8.step === "done" && S.noteKind === "bad"
                  ? `${esc(S.note.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 220))} · RELOAD`
                  : W8.step === "done"
                    ? "TUNING IN"
                    : `NEXT ${b("ENTER")}`
      : S.phase === "vote" || S.phase === "countdown"
        ? `WHO WALKS OUT · ${S.fighters === null ? "" : S.fighters.map((id, side) => `${b(S.chars[id]?.short ?? String(id))} ${String(S.votes[side])}`).join(" · ")} · ${S.voters}/${S.quorum}${collect}`
        : S.phase === "waiting" || S.phase === "over" || S.phase === "pick"
          ? `TYPE THE NUMBER · OK${collect}`
          : S.phase === "bet" && !S.bet && S.poolId === null
            ? "OPENING THE BOOK"
            : S.pending === "bet"
              ? "RECORDING YOUR BET…"
              : S.pending === "claim"
                ? "COLLECTING…"
                : S.phase === "bet" && !S.bet && S.credit > 0
                  ? `${b("A")} OR ${b("B")} · TYPE THE AMOUNT · ${b("OK")}`
                  : S.claim
                    ? `COLLECT ${b("OK")}`
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
  if (id === "power") return turnOff();
  if (S.phase === "gate") return;
  if (/^\d$/.test(id)) {
    VCR.held = "";
    if (S.phase === "bet" && !S.bet && S.pending === null) T.buf = (T.buf + id).slice(0, 6);
    else T.buf = (T.buf.length >= 2 ? "" : T.buf) + id;
  } else if (id === "clr") {
    T.buf = "";
    VCR.held = "";
  } else if (id === "ok") ok();
  hintText();
}
function turnOff(): void {
  if (S.phase === "gate" && W8.step !== "done") return;
  Z.at = null;
  coinBox.giveBack();
  holdEnd();
  T.buf = "";
  VCR.held = "";
  powerOff(() => {
    video.muted = vidMode !== "live";
    sfx.tvOn();
    say("Thank you. We've had trouble with unattended sets.", 6000);
    hintText();
  });
  hintText();
}
function useVcr(): void {
  if (VCR.loaded !== "") {
    sfx.tape();
    VCR.held = VCR.loaded;
    VCR.loaded = "";
    return hintText();
  }
  if (VCR.held === "") {
    sfx.deny();
    return say("Take a tape from the shelf.");
  }
  if (S.phase === "bet" || S.phase === "fight") {
    sfx.deny();
    return say("Not during the broadcast.");
  }
  sfx.tape();
  VCR.loaded = VCR.held;
  VCR.held = "";
  hintText();
}
function ok(): void {
  if (S.phase === "bet") {
    placeTypedBet();
    return;
  }
  const booked = typedFighterId(T.buf, S.selectable);
  if (booked !== null && (S.phase === "waiting" || S.phase === "over")) {
    T.buf = "";
    void startBout(booked);
    return;
  }
  if (booked !== null && S.phase === "pick") {
    T.buf = "";
    void chooseNextFighter(booked);
    return;
  }
  if (S.claim) {
    if (!canCollect(S)) return;
    $("#h-claim").click();
  }
}
let holdTimer = 0;
const pressKey = (id: string, z: number): void => {
  const k = keyById.get(id);
  if (k) k.position.z = z;
};
function sideKey(side: 0 | 1): void {
  if (S.phase === "vote" || S.phase === "countdown") {
    voteSide(side);
    return;
  }
  if (S.phase === "bet") {
    chooseBetSide(side);
    return;
  }
}
function chooseBetSide(side: 0 | 1): void {
  if (S.bet || S.pending !== null) return;
  if (S.poolId === null) {
    sfx.deny();
    return say("Opening the book.");
  }
  T.betSide = side;
  hintText();
}
function placeTypedBet(): void {
  if (S.bet || S.pending !== null) return;
  if (S.poolId === null) {
    sfx.deny();
    return say("Opening the book.");
  }
  if (T.betSide !== 0 && T.betSide !== 1) {
    sfx.deny();
    return say("Press A or B.");
  }
  const amt = typedStake(T.buf);
  if (amt === null) {
    sfx.deny();
    return say("Type the amount, then OK.");
  }
  if (amt > S.credit) {
    sfx.deny();
    return say(
      S.credit <= 0
        ? "Add funds to the coin box to bet. Watching is free."
        : "Your balance is below that stake.",
    );
  }
  S.side = T.betSide;
  S.amt = amt;
  if (!canBet(S)) return;
  sfx.bet();
  $("#h-bet").click();
}
function holdEnd(): void {
  clearInterval(holdTimer);
  holdTimer = 0;
  T.hold = -1;
  T.holdN = 0;
  pressKey("A", 0.022);
  pressKey("B", 0.022);
}
let coinBoxError = "";
const coinBox = createCoinBox(
  (usdc) => {
    S.credit = usdc;
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
let coinBoxMount: Promise<void> | null = null;
async function connectCoinBox(wallet: GameWallet): Promise<void> {
  setWallet(wallet);
  const { coinType } = await loadBettingIds();
  coinBox.connect(wallet, coinType);
}
async function mountCoinBox(wallet: GameWallet): Promise<void> {
  coinBoxMount ??= connectCoinBox(wallet).catch((err: Error) => {
    coinBoxMount = null;
    throw err;
  });
  await coinBoxMount;
  const address = coinBox.address();
  if (address !== wallet.address) {
    throw new Error(
      `The coin box is open for wallet ${address}, not yours (${wallet.address}). Reload the page to open yours.`,
    );
  }
}
if (hasWalletSession()) {
  void getGameWallet()
    .then(mountCoinBox)
    .catch((err: Error) => {
      coinBoxError = err.message;
      console.error(`Shinami wallet failed: ${coinBoxError}`);
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
  | { at: "hand" }
  | { at: "reel"; id: string }
  | { at: "vcr" }
  | { at: "key"; id: string };
const shown = (o: THREE.Object3D | null): boolean => o === null || (o.visible && shown(o.parent));
const within = (o: THREE.Object3D | null, root: THREE.Object3D): boolean =>
  o !== null && (o === root || within(o.parent, root));
const aimAt = (e: MouseEvent): THREE.Ray => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray;
};
const pickAt = (e: MouseEvent): Pick | null => {
  aimAt(e);
  const hit = ray
    .intersectObject(scene, true)
    .find((h) => h.object instanceof THREE.Mesh && shown(h.object));
  if (hit === undefined) return null;
  const o = hit.object;
  if (o === paper) return S.phase === "gate" && W8.step === "read" ? { at: "paper" } : null;
  if (within(o, coinBox.group)) return { at: "coin", part: coinBox.partAt(hit) };
  const id: string | undefined = o.userData.keyId;
  if (id !== undefined) return { at: "key", id };
  if (S.phase === "gate" || Z.at !== null) return null;
  if (o === tape) return { at: "hand" };
  if (o === vcr) return { at: "vcr" };
  const reel = shownTapes()[reels.findIndex((r) => r.mesh === o)];
  if (reel !== undefined) return { at: "reel", id: reel.battleId };
  return null;
};
const WALK: WalkStep[] = [
  {
    say: "YOUR SET RECEIVES ONE CHANNEL. RECEPTION IS GOOD HERE.",
    view: () => [
      tv.localToWorld(new THREE.Vector3(-0.06, 0.02, 1.35)),
      tv.localToWorld(new THREE.Vector3(-0.06, 0, 0.38)),
    ],
    remote: false,
  },
  {
    say: "EVERY BOUT IS TAPED. THE SHELF KEEPS THEM.",
    view: () => [
      shelf.localToWorld(new THREE.Vector3(0, 1.28, 1.05)),
      shelf.localToWorld(new THREE.Vector3(0, 1.22, 0.1)),
    ],
    remote: false,
  },
  {
    say: "PULL A TAPE AND PLAY IT ON THE VCR.",
    view: () => [
      vcr.localToWorld(new THREE.Vector3(0, 0.05, 0.9)),
      vcr.localToWorld(new THREE.Vector3(0, -0.02, 0)),
    ],
    remote: false,
  },
  {
    say: "WATCHING IS FREE. THE METER IS FOR BETS.",
    view: () => coinBox.view("meter"),
    remote: false,
  },
  {
    say: "EXPECTING A SURVIVOR? PRESS A OR B, TYPE THE AMOUNT, THEN OK.",
    view: () => null,
    remote: true,
  },
];
function walkTo(n: number): void {
  walkRef.n = n < WALK.length ? n : -1;
  hintText();
}
function zoom(at: CoinBoxView | null): void {
  Z.at = at;
  hintText();
}
function stepBack(): void {
  if (Z.error) Z.error = "";
  else if (Z.at === "sticker") Z.at = "meter";
  else {
    Z.at = null;
    coinBox.giveBack();
  }
  hintText();
}
function useCoinPart(part: CoinBoxPart): void {
  Z.error = "";
  if (isCoin(part)) {
    coinBox.drop(part);
    zoom("meter");
  } else if (part === "handle") {
    zoom("meter");
    coinBox.turn();
  } else if (part === "sticker") zoom("sticker");
  else if (part === "lock") {
    zoom("meter");
    coinBox.open();
  } else zoom(Z.at ?? "meter");
}
function openCoinKey(part: CoinBoxPart): void {
  if (coinBox.address() === null) {
    say(coinBoxError === "" ? "The coin box is still opening." : coinBoxError);
    return;
  }
  if (walkRef.n >= 0) walkTo(WALK.length);
  useCoinPart(part);
}
async function copyWorldIdLink(button: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(W8.qrUri);
    button.textContent = "COPIED";
  } catch (err) {
    button.textContent = "COPY FAILED";
    console.error(`Copy World ID link failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
$("#hint").addEventListener("click", (e) => {
  const copy = e.target instanceof Element ? e.target.closest("[data-copy-link]") : null;
  if (copy instanceof HTMLElement) void copyWorldIdLink(copy);
});
$("#no-orb").addEventListener("click", noOrb);
$("#forget").addEventListener("click", () => {
  store((s) => s.removeItem("ht.verified"));
  location.reload();
});
const look = new THREE.Vector2();
let pointer: MouseEvent | null = null;
function updateHover(): void {
  const pick = pointer ? pickAt(pointer) : null;
  const reel = pick?.at === "reel" ? pick.id : "";
  const over = pick?.at === "vcr";
  if (reel === VCR.hover && over === VCR.over) return;
  if (reel !== "" && reel !== VCR.hover) sfx.slide();
  VCR.hover = reel;
  VCR.over = over;
  hintText();
}
let dragFrom: [x: number, y: number] | null = null;
addEventListener("pointermove", (e) => {
  if (dragFrom !== null) coinBox.drag(aimAt(e));
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
  1: "coin",
  5: "coin",
  10: "coin",
  handle: "grab",
  sticker: "phone",
  lock: "grab",
  body: "press",
} satisfies Record<CoinBoxPart, string>;
function cursorFor(pick: Pick | null): string {
  if (pick?.at === "coin") return PART_CURSOR[pick.part];
  if (walkRef.n >= 0) return "press";
  if (pick === null) return "";
  if (pick.at === "paper") return "pen";
  return pick.at === "hand" || pick.at === "reel" ? "grab" : "press";
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || busy()) return;
  if (S.phase === "gate" && W8.fail !== "") return;
  if (S.phase === "gate" && W8.step === "signed") return nextGateStep();
  const pick = pickAt(e);
  if (pick?.at === "key" && pick.id === "power") return press("power");
  if (walkRef.n >= 0) {
    if (pick?.at === "coin") return openCoinKey(pick.part);
    return walkTo(walkRef.n + 1);
  }
  if (Z.at !== null && pick?.at === "coin" && isCoin(pick.part)) {
    Z.error = "";
    if (coinBox.grab(pick.part, aimAt(e))) dragFrom = [e.clientX, e.clientY];
    return;
  }
  if (Z.at !== null) return pick?.at === "coin" ? useCoinPart(pick.part) : stepBack();
  if (pick === null) return;
  if (pick.at === "paper") return sign();
  if (pick.at === "coin") return zoom("meter");
  if (pick.at === "hand") {
    sfx.tape();
    VCR.held = "";
    return hintText();
  }
  if (pick.at === "reel") {
    sfx.tape();
    T.buf = "";
    VCR.held = pick.id;
    VCR.hover = "";
    return hintText();
  }
  if (pick.at === "vcr") return useVcr();
  if (pick.id === "A" || pick.id === "B") sideKey(pick.id === "B" ? 1 : 0);
  else press(pick.id);
});
addEventListener("pointerup", (e) => {
  holdEnd();
  if (dragFrom === null) return;
  const moved = Math.hypot(e.clientX - dragFrom[0], e.clientY - dragFrom[1]) > 6;
  dragFrom = null;
  coinBox.release(!moved);
  hintText();
});
const dropDrag = (): void => {
  if (dragFrom === null) return;
  dragFrom = null;
  coinBox.release(false);
  hintText();
};
addEventListener("pointercancel", dropDrag);
addEventListener("blur", dropDrag);
addEventListener(
  "keydown",
  (e) => {
    const waiverUp = S.phase === "gate" && W8.step !== "done";
    if (waiverUp && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
    if (busy()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === "o") {
      e.preventDefault();
      e.stopPropagation();
      press("power");
      return;
    }
    const coinKey = COIN_KEYS.get(k);
    if (coinKey !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      openCoinKey(coinKey);
      return;
    }
    if (walkRef.n >= 0) {
      if (k === "escape") walkTo(WALK.length);
      else if (k === "enter" || k === " " || k === "arrowright") walkTo(walkRef.n + 1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (Z.at !== null) {
      if (k === "escape" || k === "backspace") stepBack();
      else if (k === "enter") useCoinPart("handle");
      else {
        const coin = COINS[Number(k) - 1];
        if (/^[1-3]$/.test(k) && coin !== undefined) useCoinPart(coin);
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    let id: string | null = null;
    if (/^\d$/.test(k)) id = k;
    else if (k === "enter") id = "ok";
    else if (k === "backspace" || k === "escape") id = "clr";
    else if (k === "+" || k === "=" || k === "arrowup") id = "+";
    else if (k === "-" || k === "arrowdown") id = "-";
    else if ((k === "a" || k === "b") && !e.repeat) {
      e.stopPropagation();
      return sideKey(k === "b" ? 1 : 0);
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
    const up = W8.step === "scan" || W8.step === "wallet" ? 1 : 0;
    gaze = LOW ? up : gaze + (up - gaze) * 0.06;
    camera.lookAt(look.x * 0.06, 0.57 + gaze * (TV_Y - 0.55) - look.y * 0.04, -0.86 - gaze * 0.54);
    snap = true;
  } else {
    const walkView = WALK[walkRef.n]?.view() ?? null;
    if (walkView !== null) {
      wantEye.copy(walkView[0]);
      wantAim.copy(walkView[1]);
    } else if (Z.at !== null) {
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
  const pw = tickPower(performance.now());
  const raise = WALK[walkRef.n]?.remote ? 1 : 0;
  remoteUp = LOW ? raise : remoteUp + (raise - remoteUp) * 0.12;
  remote.position.set(0.31 - 0.2 * remoteUp, -0.17 + 0.09 * remoteUp, -0.62 + 0.14 * remoteUp);
  remote.rotation.set(-0.3 + 0.22 * remoteUp, -0.22 + 0.2 * remoteUp, -0.1 + 0.1 * remoteUp);
  if (raise) led.material.color.set(Math.sin(t * 8) > 0 ? COL.blood : COL.bloodDeep);
  remote.visible = !waiver && Z.at === null && (walkRef.n < 0 || raise === 1);
  updateTape(performance.now(), updateVcr(performance.now()));
  coinBox.tick(performance.now());
  updateHover();
  coinBox.group.visible = !waiver;
  cable.visible = !waiver;
  $("#demo-room").hidden = S.phase === "gate";
  $("#demo-gate").hidden = S.phase !== "gate" || dark;
  $("#no-orb").hidden = !waiver;
  $("#waiver-text").hidden = !waiver || dark;
  $("#dark").hidden = !dark;
  paper.visible = waiver && !dark;
  if (paper.visible && (W8.step !== "read" || !paperFlag.drawn)) {
    drawPaper(performance.now());
    paperFlag.drawn = true;
  }
  const lightsOut = (waiver && (W8.step === "off" || W8.step === "burn" || dark)) || pw !== "";
  const tvLit = pw !== "" && pw !== "off" && pw !== "black";
  const flick = lightsOut ? 0 : Math.sin(t * 13) > 0.97 || Math.sin(t * 2.3 + 1) > 0.995 ? 0.3 : 1;
  ambient.intensity = dark || pw !== "" ? 0 : lightsOut ? 0.1 : 0.35;
  bulbLight.intensity = 7 * flick;
  bulb.material.color.set(flick < 1 ? COL.grime : COL.bone);
  halo.material.opacity = 0.7 * flick;
  motes.material.opacity = 0.5 * flick * (lightsOut ? 0 : 1);
  if (!LOW) drift(t);
  tvGlow.intensity = tvLit
    ? 1.6 + Math.random() * 0.6
    : lightsOut
      ? 0
      : S.phase === "fight"
        ? 1 + Math.random() * 0.5
        : S.phase === "bet"
          ? 1.4
          : 0.8;
  syncVideo();
  if (pw !== "") video.muted = true;
  ambience(tvNoise, flick, lightsOut);
  const ms = performance.now();
  if (S.phase === "bet" && ms >= nextBeat) {
    const k = Math.max(0, Math.min(1, 1 - S.t / DUR.bet));
    sfx.beat(0.5 + 0.5 * k);
    nextBeat = ms + 1000 - 520 * k;
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
    T.phase = S.phase;
    T.buf = "";
    T.betSide = -1;
    holdEnd();
    PHASE_SOUND.get(S.phase)?.();
    refreshTapes();
  }
  hintText();
};

hooks.collected = () => {
  sfx.coins(14);
  say("Collected.");
};

waiverHooks.hintText = hintText;
waiverHooks.walkTo = walkTo;
waiverHooks.mountCoinBox = mountCoinBox;

void document.fonts.ready.then(() => {
  paperFlag.drawn = false;
  TAPE.key = "";
  drawTV();
});
if (store((s) => s.getItem("ht.verified")) === "1") enterRoom();
hintText();
