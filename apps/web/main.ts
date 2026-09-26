import * as THREE from "three";
import {
  $,
  DUR,
  S,
  countdown,
  hooks,
  loadBettingIds,
  pick,
  refreshClaimable,
  setWallet,
  usd,
  type Phase,
} from "./game.ts";
import { COINS, type CoinBoxPart, type CoinBoxView, createCoinBox } from "./coinbox.ts";
import { getGameWallet, hasWalletSession } from "./wallet.ts";
import { ambience, isMuted, sfx, toggleMute } from "./sfx.ts";
import { COL } from "./room-palette.ts";
import { STAKES, T, Z, W8, LOW, esc, num, say, walkRef, type WalkStep } from "./room-state.ts";
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
import { drawTV, mask, syncVideo, tv, tvGlow, tvNoise, vidMode } from "./room-tv.ts";
import { renderPlaceholders } from "./placeholders.ts";
import { keyById, led, remote } from "./room-remote.ts";
import { shelf, slots, tape, TAPE, updateTape, type Slot } from "./room-shelf.ts";

const COIN_KEYS = new Map<string, CoinBoxPart>([
  ["d", "slot"],
  ["p", "sticker"],
  ["w", "lock"],
]);

function hintText(): void {
  const h = $("#hint");
  const b = (s: string): string => `<b>${s}</b>`;
  const step = WALK[walkRef.n];
  if (step) {
    h.innerHTML = `${step.say} <span class="hint-key">ENTER</span>`;
    return;
  }
  const hovered = S.chars[T.hover];
  const credit = `${usd(coinBox.credit())} USDC`;
  const meter = Z.error
    ? `${b("THE BOX SPAT IT OUT")} ${esc(Z.error)}`
    : Z.pick
      ? COINS.map((c, i) => `<button data-coin="${c}">${b(String(i + 1))} ${c} USDC</button>`).join(
          " ",
        )
      : Z.at === "sticker"
        ? `${b("PAY BY PHONE")} testnet USDC on Sui to <span class="addr">${coinBox.address() ?? ""}</span>`
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
          ? `SCAN WITH ${b("WORLD APP")} · ORB ONLY${W8.qrUri === "" ? "" : ` <a href="${esc(W8.qrUri)}" target="_blank" rel="noopener">OPEN LINK</a> <button data-copy-link>COPY LINK</button>`}`
          : W8.fail !== ""
            ? `NOT IN · TRY AGAIN ${b("ENTER")}`
            : W8.step === "done" && S.noteKind === "bad"
              ? `${esc(S.note.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 220))} · RELOAD`
              : W8.step === "done"
                ? "WARMING UP"
                : `NEXT ${b("ENTER")}`
      : S.phase === "vote" && !S.cast
        ? `PICK ${S.slots === 1 ? "ONE" : "TWO"} · NUMBER ${b("OK")}`
        : S.phase === "countdown" && !S.cast
          ? `LAST CALL · PICK ${S.slots === 1 ? "ONE" : "TWO"} · ${b("OK")}`
          : S.phase === "bet" && !S.bet && S.poolId === null
            ? "OPENING THE BOOK"
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
    if ((S.phase === "vote" || S.phase === "countdown") && !S.cast) {
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
  if ((S.phase === "vote" || S.phase === "countdown") && !S.cast && T.buf.length === 2) {
    const ch = S.chars[Number(T.buf) - 1];
    if (
      !ch ||
      !ch.alive ||
      S.picks.includes(ch.id) ||
      (S.champion !== null && ch.id === S.champion)
    )
      return sfx.deny();
    pick(ch.id);
    sfx.pick();
    T.buf = "";
    T.reveal = ch.id;
    T.revealUntil = performance.now() + 3200;
    if (S.picks.length >= S.slots) $("#h-cast").click();
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
  if (S.poolId === null) {
    sfx.deny();
    return say("Opening the book.");
  }
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
let coinBoxError = "";
let chainCredit = 0;
const coinBox = createCoinBox(
  (usdc) => {
    S.credit = usdc;
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
async function mountCoinBox(): Promise<void> {
  if (coinBox.address() !== null) return;
  const wallet = await getGameWallet();
  setWallet(wallet);
  const { coinType } = await loadBettingIds();
  void refreshClaimable().catch((err: Error) =>
    console.error(`claimable after wallet mount failed: ${err.message}`),
  );
  coinBox.connect(wallet, coinType);
}
if (hasWalletSession()) {
  void mountCoinBox().catch((err: Error) => {
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
  if (o === paper) return S.phase === "gate" && W8.step === "read" ? { at: "paper" } : null;
  if (within(o, coinBox.group)) return { at: "coin", part: coinBox.partAt(hit) };
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
  { say: "THE METER. FEED IT TO BET.", view: () => coinBox.view("meter"), remote: false },
  { say: "HOLD A OR B. BET ON WHO WALKS OUT.", view: () => null, remote: true },
];
function walkTo(n: number): void {
  walkRef.n = n < WALK.length ? n : -1;
  countdown.hold = walkRef.n >= 0;
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
  coinBox.insert(usdc);
  zoom("meter");
}
function useCoinPart(part: CoinBoxPart): void {
  Z.error = "";
  if (part === "slot") zoom("meter", true);
  else if (part === "sticker") zoom("sticker");
  else if (part === "lock") {
    zoom("meter");
    coinBox.open();
  } else zoom(Z.at ?? "meter", Z.pick);
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
  const coin = e.target instanceof Element ? e.target.closest("[data-coin]") : null;
  if (coin instanceof HTMLElement) insertCoin(Number(coin.dataset.coin));
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
  if (pick?.at === "coin") return PART_CURSOR[pick.part];
  if (walkRef.n >= 0) return "press";
  if (pick === null) return "";
  if (pick.at === "paper") return "pen";
  return pick.at === "shelf" ? "grab" : "press";
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (S.phase === "gate" && W8.fail !== "") return;
  if (S.phase === "gate" && W8.step === "signed") return nextGateStep();
  const pick = pickAt(e);
  if (walkRef.n >= 0) {
    if (pick?.at === "coin") return openCoinKey(pick.part);
    return walkTo(walkRef.n + 1);
  }
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
      else if (Z.pick && /^[1-3]$/.test(k)) insertCoin(COINS[Number(k) - 1]);
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
  const raise = WALK[walkRef.n]?.remote ? 1 : 0;
  remoteUp = LOW ? raise : remoteUp + (raise - remoteUp) * 0.12;
  remote.position.set(0.31 - 0.2 * remoteUp, -0.17 + 0.09 * remoteUp, -0.62 + 0.14 * remoteUp);
  remote.rotation.set(-0.3 + 0.22 * remoteUp, -0.22 + 0.2 * remoteUp, -0.1 + 0.1 * remoteUp);
  if (raise) led.material.color.set(Math.sin(t * 8) > 0 ? COL.blood : COL.bloodDeep);
  remote.visible = !waiver && Z.at === null && (walkRef.n < 0 || raise === 1);
  updateTape(performance.now());
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
  ["vote", sfx.bell],
  ["countdown", sfx.static],
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
  renderPlaceholders();
  if (S.phase === "gate") return hintText();
  if (T.phase !== S.phase) {
    const was = T.phase;
    T.phase = S.phase;
    T.buf = "";
    if (was === "vote" && S.phase === "countdown") say("Quorum reached. Voting closes soon.", 4200);
    if (S.phase === "bet") T.stake = 1;
    holdEnd();
    PHASE_SOUND.get(S.phase)?.();
  }
  hintText();
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
