import { parsePinAddressesFromMarkdown } from "@horror-tube/ens/scripts/pin.ts";
import pinMarkdown from "@horror-tube/ens/scripts/pin/sepolia-addresses.md?raw";
import { readRosterFromChain } from "@horror-tube/ens/scripts/roster.ts";
import type { Ticket } from "@horror-tube/betting";

import {
  claimAll,
  claimable,
  fetchBettingIds,
  placeBet,
  toContractIds,
  type BettingIds,
} from "./betting.ts";
import {
  connectRoundEvents,
  fetchRoundState,
  postVote,
  type ServerRoundState,
} from "./round-client.ts";
import { formatPoolOdds } from "./odds.ts";
import { A, L, css, ctx2d, paint, type Ctx, type Draw, type Layer } from "./sprites.ts";
import {
  fromUsdcUnits,
  toUsdcUnits,
  type GameWallet,
} from "./wallet.ts";

export const $ = (s: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(s);
  if (!el) throw new Error(`missing element ${s}`);
  return el;
};
export const hooks = { render: (): void => {} };
export const countdown = { hold: false };
const render = (): void => hooks.render();

const C = {
  bone: css("--bone"),
  blood: css("--blood"),
  "blood-deep": css("--blood-deep"),
  cold: css("--cold"),
  "cold-deep": css("--cold-deep"),
  rust: css("--rust"),
  "rust-deep": css("--rust-deep"),
  sulfur: css("--sulfur"),
  dim: css("--dim"),
  muted: css("--muted"),
  alive: css("--alive"),
  panel: css("--panel"),
  rule: css("--rule"),
};
let seed = 666;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
export const hex = (n: number): string =>
  "0x" + Array.from({ length: n }, () => "0123456789abcdef"[(rnd() * 16) | 0]).join("");
export const usd = (n: number): string => n.toFixed(2);
export const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, "0")}`;

const HUES = ["blood", "cold", "rust"] as const;
type Hue = (typeof HUES)[number];
export const DUR = { vote: 15, countdown: 15, bet: 15, fight: 10, settle: 8 };
const PLACES = ["CAMP", "FARM", "TOYSHOP", "MINE"] as const;
type Place = (typeof PLACES)[number];

export type Character = {
  id: number;
  name: string;
  short: string;
  ens: string;
  hue: Hue;
  brief: string;
  injuries: string;
  icon: HTMLImageElement;
  fights: number;
  alive: boolean;
  kills: number;
  damage: number;
};
export type Pair = [number, number];
export type Phase = "gate" | "vote" | "countdown" | "bet" | "fight" | "settle" | "over";
export type Shot = { fighters: Pair; winner: number; round: number };
export type LogEntry = { round: number; text: string; cls: string };
export type GameState = {
  view: number;
  phase: Phase;
  t: number;
  endsAt: number | null;
  round: number;
  chars: Character[];
  picks: number[];
  cast: string | null;
  votes: Record<number, number>;
  fighters: Pair | null;
  story: string;
  winner: number;
  dmg: number;
  bet: { side: number; amt: number } | null;
  side: number;
  amt: number;
  battleId: string | null;
  poolId: string | null;
  pool: [number, number];
  feeBps: number;
  result: number;
  claim: number;
  credit: number;
  focus: number;
  last: Shot | null;
  note: string;
  noteKind: string;
  frame: number;
  log: LogEntry[];
  slots: 1 | 2;
  champion: number | null;
  voters: number;
  quorum: number;
  videoUrl: string | null;
  bettingClosesAt: number | null;
  frameUrl: string | null;
  error: string | null;
};

export const S: GameState = {
  view: 1,
  phase: "gate",
  t: 0,
  endsAt: null,
  round: 1,
  chars: [],
  picks: [],
  cast: null,
  votes: {},
  fighters: null,
  story: "",
  winner: -1,
  dmg: 0,
  bet: null,
  side: 0,
  amt: 0.03,
  battleId: null,
  poolId: null,
  pool: [0, 0],
  feeBps: 0,
  result: 0,
  claim: 0,
  credit: 0,
  focus: 0,
  last: null,
  note: "",
  noteKind: "",
  frame: 0,
  log: [],
  slots: 2,
  champion: null,
  voters: 0,
  quorum: 1,
  videoUrl: null,
  bettingClosesAt: null,
  frameUrl: null,
  error: null,
};

let gameWallet: GameWallet | null = null;
let bettingIds: BettingIds | null = null;
let pendingClaimTickets: Ticket[] = [];

export function setWallet(wallet: GameWallet): void {
  gameWallet = wallet;
}

export function setBettingIds(ids: BettingIds): void {
  bettingIds = ids;
  S.feeBps = ids.feeBps;
}

export async function refreshClaimable(): Promise<void> {
  if (gameWallet === null || bettingIds === null) return;
  const ids = toContractIds(bettingIds);
  const result = await claimable(gameWallet, ids);
  pendingClaimTickets = result.tickets;
  S.claim = fromUsdcUnits(result.units);
  if (result.units === 0n && result.lost > 0n) {
    S.result = -fromUsdcUnits(result.lost);
  } else if (result.units > 0n) {
    S.result = fromUsdcUnits(result.units);
  }
  render();
}

export async function loadBettingIds(
  fetchImpl: typeof fetch = fetch,
): Promise<BettingIds> {
  const ids = await fetchBettingIds(fetchImpl);
  setBettingIds(ids);
  return ids;
}
const col = (ch: Character): string => C[ch.hue];
export const living = (): Character[] => S.chars.filter((c) => c.alive);
const place = (round: number): Place => PLACES[round % PLACES.length];
export const log = (text: string, cls = ""): void => {
  S.log.unshift({ round: S.round, text, cls });
  S.log.length = Math.min(S.log.length, 80);
};
export const note = (text: string, kind = ""): void => {
  if (kind === "bad") log(text, "t-dead");
  S.note = text;
  S.noteKind = kind;
  render();
};

export function refreshTimer(now = Date.now()): void {
  if (S.endsAt === null) {
    S.t = 0;
    return;
  }
  S.t = Math.max(0, (S.endsAt - now) / 1000);
}

let stopRoundStream: (() => void) | null = null;

export function applyRoundState(state: ServerRoundState): void {
  const prevPhase = S.phase;
  const prevRound = S.round;
  S.round = state.round;
  S.phase = state.phase;
  S.endsAt = state.endsAt;
  S.champion = state.champion;
  S.slots = state.slots;
  S.voters = state.voters;
  S.quorum = state.quorum;
  S.votes = { ...state.votes };
  S.fighters = state.fighters;
  S.battleId = state.battleId;
  S.poolId = state.poolId;
  S.pool = [...state.pool] as [number, number];
  S.winner = state.winner === null ? -1 : state.winner;
  S.videoUrl = state.videoUrl;
  S.bettingClosesAt = state.bettingClosesAt;
  S.frameUrl = state.frameUrl;
  S.error = state.error;
  // #114: a new bout must accept a fresh hold; do not keep the prior round's bet.
  if (state.round !== prevRound) {
    S.bet = null;
  }
  refreshTimer();
  for (const remote of state.chars) {
    const local = S.chars[remote.id];
    if (local === undefined) continue;
    local.alive = remote.alive;
    local.kills = remote.kills;
    local.damage = remote.damage;
  }
  if (state.error) {
    note(state.error, "bad");
  }
  if (
    state.phase === "settle" &&
    prevPhase === "fight" &&
    state.fighters &&
    state.winner !== null
  ) {
    const f = state.fighters;
    const w = S.chars[f[state.winner] ?? -1];
    const l = S.chars[f[1 - state.winner] ?? -1];
    if (w && l) {
      log(`${w.short} KILLS ${l.short}`, `t-${w.hue}`);
      log(`${l.ens} · status=dead`, "t-house");
      log(`${w.ens} · damage=${w.damage}`, "t-house");
      S.last = { fighters: f, winner: state.winner, round: state.round };
      S.focus = w.id;
    }
    void refreshClaimable().catch((error: unknown) => {
      note(
        `CLAIM LOOKUP FAILED. ${error instanceof Error ? error.message : String(error)}`,
        "bad",
      );
    });
  }
  if (state.phase === "vote" || state.phase === "countdown") {
    // New voting window: clear local picks if we have not cast this round yet.
    if (prevPhase !== "vote" && prevPhase !== "countdown") {
      S.picks = [];
      S.cast = null;
      S.bet = null;
    }
  }
  render();
}

export async function connectToServerRound(): Promise<void> {
  if (stopRoundStream) {
    stopRoundStream();
    stopRoundStream = null;
  }
  const initial = await fetchRoundState();
  applyRoundState(initial);
  stopRoundStream = connectRoundEvents(applyRoundState);
  log(
    `SERVER ROUND · phase=${initial.phase} quorum=${String(initial.quorum)} slots=${String(initial.slots)}`,
    "t-house",
  );
}

const env = (name: string): string => {
  const value = String(import.meta.env[name] ?? "").trim();
  if (!value)
    throw new Error(`${name} is required. Set it in the repo-root .env. See .env.example.`);
  return value;
};
async function loadIcon(name: string, url: string): Promise<HTMLImageElement> {
  if (!url.startsWith("https://"))
    throw new Error(
      `${name} has no https icon record (got ${JSON.stringify(url)}). Run: python -m roster icons-chain`,
    );
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    throw new Error(
      `${name} icon failed to load from ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return img;
}
const isAlive = (name: string, status: string): boolean => {
  if (status === "alive" || status === "") return true;
  if (status === "dead") return false;
  throw new Error(
    `${name} has unknown status ${JSON.stringify(status)}. Expected alive, dead, or "".`,
  );
};
const ROSTER = (async () => {
  const ethRegistry = parsePinAddressesFromMarkdown(pinMarkdown).ETHRegistry;
  const { parentName, sheets } = await readRosterFromChain(
    env("ENS_LABEL"),
    env("VITE_SEPOLIA_RPC_URL"),
    ethRegistry,
  );
  return {
    parentName,
    sheets: await Promise.all(
      sheets.map(async (s) => ({
        ...s,
        alive: isAlive(s.name, s.status),
        img: await loadIcon(s.name, s.icon),
      })),
    ),
  };
})();
export async function newSeason(): Promise<void> {
  let roster: Awaited<typeof ROSTER>;
  try {
    roster = await ROSTER;
  } catch (error) {
    note(`ENS READ FAILED. ${error instanceof Error ? error.message : String(error)}`, "bad");
    throw error;
  }
  S.chars = roster.sheets.map((s, id) => ({
    id,
    name: s.label.toUpperCase(),
    short: s.label.toUpperCase(),
    ens: s.name,
    hue: HUES[id % 3],
    brief: s.brief,
    injuries: s.injuries.join(", "),
    icon: s.img,
    fights: 0,
    alive: s.alive,
    kills: 0,
    damage: 0,
  }));
  Object.assign(S, { round: 1, focus: 0, last: null, view: 1, picks: [], cast: null, bet: null });
  log(`NEW SEASON · ${S.chars.length} subnames read from ${roster.parentName}`, "t-house");
  await connectToServerRound();
}
const faces = new Map<string, HTMLCanvasElement>();
export function face(ch: Character): HTMLCanvasElement {
  const key = ch.ens + (ch.alive ? "" : "x");
  let cv = faces.get(key);
  if (cv) return cv;
  cv = document.createElement("canvas");
  cv.width = cv.height = 100;
  const g = ctx2d(cv, { willReadFrequently: true });
  g.fillStyle = C[ch.hue];
  g.fillRect(0, 0, 100, 100);
  g.drawImage(ch.icon, 0, 0, 100, 100);
  if (!ch.alive) {
    const img = g.getImageData(0, 0, 100, 100),
      d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.3 * (d[i] ?? 0) + 0.59 * (d[i + 1] ?? 0) + 0.11 * (d[i + 2] ?? 0);
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    g.putImageData(img, 0, 0);
  }
  faces.set(key, cv);
  return cv;
}

const char = (id: number): Character => {
  const ch = S.chars[id];
  if (!ch) throw new Error(`no character ${id}`);
  return ch;
};
const fighters = (): Pair => {
  if (!S.fighters) throw new Error("no fighters");
  return S.fighters;
};
export { char, fighters };

export const replaying = (): boolean =>
  (S.phase === "vote" || S.phase === "countdown") && !!S.last && !!S.videoUrl;

setInterval(() => {
  refreshTimer();
  if (S.phase === "fight" || replaying()) S.frame++;
  if (S.phase !== "gate") paintFilm();
}, 125);

function pose(c: Ctx, i: number, f: number, dead: boolean, moving: boolean): void {
  if (i === 1) {
    c.translate(160, 0);
    c.scale(-1, 1);
  }
  if (dead) {
    c.translate(12, 86);
    c.rotate(-Math.PI / 2);
  } else c.translate(22 + (moving ? (f % 6 < 3 ? 2 : 0) : 0), 20 + (moving ? (f >> 1) % 2 : 0));
}
function figure(c: Ctx, ch: Character, i: number, f: number, dead: boolean, moving: boolean): void {
  c.save();
  pose(c, i, f, dead, moving);
  A(c, 16, 37, 13, 1.12, 1.88);
  L(c, 16, 33, 16, 48);
  L(c, 16, 48, 10, 63);
  if (ch.damage >= 50) L(c, 16, 48, 20, 56, 18, 63);
  else L(c, 16, 48, 22, 63);
  L(c, 16, 38, 29, moving ? 30 + (f % 4 < 2 ? 0 : 3) : 40);
  c.restore();
}
const tri = (c: Ctx, ...p: number[]): void => {
  c.beginPath();
  c.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.fill();
};
const SCENERY = {
  CAMP: [
    (c) => {
      c.fillRect(96, 52, 34, 33);
      tri(c, 91, 53, 113, 38, 135, 53);
      for (const x of [8, 24, 146]) tri(c, x, 38, x - 8, 85, x + 8, 85);
    },
    (c) => {
      c.fillRect(102, 60, 5, 5);
      c.fillRect(119, 60, 5, 5);
    },
  ],
  FARM: [
    (c) => {
      c.fillRect(94, 50, 40, 35);
      tri(c, 90, 51, 114, 36, 138, 51);
      c.fillRect(140, 28, 12, 57);
      for (let x = 0; x < 60; x += 6) c.fillRect(x, 74, 2, 11);
      c.fillRect(0, 77, 60, 2);
    },
    (c) => c.fillRect(110, 58, 6, 6),
  ],
  TOYSHOP: [
    (c) => {
      for (const y of [30, 48, 66]) {
        c.fillRect(0, y, 34, 3);
        c.fillRect(126, y, 34, 3);
        for (const x of [4, 14, 24, 130, 140, 150]) c.fillRect(x, y - 7, 6, 7);
      }
    },
    (c) => c.fillRect(74, 20, 12, 3),
  ],
  MINE: [
    (c) => {
      c.fillRect(0, 22, 160, 6);
      for (const x of [0, 150]) c.fillRect(x, 22, 10, 63);
      tri(c, 60, 28, 80, 40, 100, 28);
    },
    (c) => c.fillRect(78, 30, 4, 4),
  ],
} satisfies Record<Place, [fill: Draw, lamp: Draw]>;
function paintFilm(): void {
  const f = S.frame,
    rep = replaying(),
    shot = rep
      ? S.last
      : S.fighters && S.phase !== "vote" && S.phase !== "countdown"
        ? { fighters: S.fighters, winner: S.winner, round: S.round }
        : null,
    [fill, lamp] = SCENERY[place(shot ? shot.round : S.round)],
    layers: Layer[] = [
      [C.rule, fill],
      [C.panel, (c) => c.fillRect(0, 85, 160, 5)],
      [C["rust-deep"], lamp],
      [
        C["rust-deep"],
        (c) => {
          L(c, 0, 85, 20, 84, 40, 86, 60, 84, 80, 85, 100, 84, 120, 86, 140, 84, 160, 85);
          for (const x of [68, 84, 100]) {
            L(c, x, 84, x, 75);
            L(c, x - 3, 78, x + 3, 78);
          }
          A(c, 132, 16, 7, 0, 2);
        },
      ],
    ];
  const loop = f % 80,
    moving = S.phase === "fight" || (rep && loop < 64),
    dead =
      S.phase === "settle" || S.phase === "over" || (rep && loop >= 64)
        ? 1 - (shot?.winner ?? 0)
        : -1;
  if (shot) {
    shot.fighters.forEach((id, i) =>
      layers.push([col(char(id)), (c) => figure(c, char(id), i, f, dead === i, moving)]),
    );
    if (moving) {
      layers.push([
        C.bone,
        (c) => {
          for (const k of [0, 2.1]) {
            c.beginPath();
            for (let x = 52; x <= 108; x += 2)
              c.lineTo(x, 52 + Math.sin(x * 0.3 + f * 1.3 + k) * 4 + (rnd() - 0.5) * 3);
            c.stroke();
          }
          if (f % 12 > 8) {
            const x = (f / 12) % 2 < 1 ? 120 : 40;
            for (let a = 0; a < 8; a++)
              L(
                c,
                x + Math.cos(a) * 5,
                48 + Math.sin(a) * 5,
                x + Math.cos(a) * 11,
                48 + Math.sin(a) * 11,
              );
          }
        },
      ]);
    }
  }
  paint(film(), 160, 90, layers);
  if (!shot) return;
  const g = ctx2d(film());
  g.imageSmoothingEnabled = false;
  shot.fighters.forEach((id, i) => {
    g.save();
    pose(g, i, f, dead === i, moving);
    g.drawImage(face(char(id)), 6, 2, 20, 20);
    g.restore();
  });
}

export { formatPoolOdds } from "./odds.ts";

export const odds = (i: number): string => formatPoolOdds(S.pool, i, S.feeBps);
export const film = (): HTMLCanvasElement => {
  const el = $("#film");
  if (!(el instanceof HTMLCanvasElement)) throw new Error("#film is not a canvas");
  return el;
};

document.addEventListener("click", (e) => {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]") : null;
  if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
  const act = el.dataset.act;
  if (act === "skip") {
    note("Skip is disabled. The shared server owns the phase clock.", "bad");
  } else if (act === "view") {
    S.view = Number(el.dataset.v) || (S.view === 1 ? 2 : 1);
    render();
  } else if (act === "reset") void newSeason();
  else if (act === "ring") pick(Number(el.dataset.id));
  else if (act === "cast") {
    void (async () => {
      if (S.cast) return;
      if (S.picks.length !== S.slots) {
        note(`Pick exactly ${String(S.slots)} character(s) before casting.`, "bad");
        return;
      }
      try {
        const state = await postVote(S.picks);
        S.cast = "submitted";
        applyRoundState(state);
        log("VOTE SUBMITTED · waiting on server RoundState", "t-alive");
      } catch (error) {
        note(
          `VOTE REJECTED. ${error instanceof Error ? error.message : String(error)}`,
          "bad",
        );
      }
    })();
  } else if (act === "side") {
    S.side = Number(el.dataset.i);
    render();
  } else if (act === "amt") {
    S.amt = Number(el.dataset.a);
    render();
  } else if (act === "bet") {
    void (async () => {
      if (S.bet) return;
      if (S.poolId === null || S.poolId.trim() === "") {
        note("BET REJECTED. Pool is not open yet.", "bad");
        return;
      }
      if (gameWallet === null) {
        note("BET REJECTED. Wallet is not ready.", "bad");
        return;
      }
      if (bettingIds === null) {
        note("BET REJECTED. Betting IDs are not loaded.", "bad");
        return;
      }
      if (S.side !== 0 && S.side !== 1) {
        note(`BET REJECTED. Side must be 0 or 1. Got ${String(S.side)}.`, "bad");
        return;
      }
      const side = S.side as 0 | 1;
      const amt = S.amt;
      try {
        const digest = await placeBet(
          gameWallet,
          toContractIds(bettingIds),
          S.poolId,
          side,
          toUsdcUnits(amt),
        );
        S.bet = { side, amt };
        log(`BET ${usd(amt)} ON ${side === 0 ? "A" : "B"} · ${digest.slice(0, 8)}`, "t-alive");
        render();
      } catch (error) {
        note(
          `BET REJECTED. ${error instanceof Error ? error.message : String(error)}`,
          "bad",
        );
      }
    })();
  } else if (act === "claim") {
    void (async () => {
      if (!S.claim) return;
      if (gameWallet === null || bettingIds === null) {
        note("CLAIM REJECTED. Wallet or betting IDs are not ready.", "bad");
        return;
      }
      if (pendingClaimTickets.length === 0) {
        note("CLAIM REJECTED. No finished tickets to claim.", "bad");
        return;
      }
      try {
        const digest = await claimAll(
          gameWallet,
          toContractIds(bettingIds),
          pendingClaimTickets,
        );
        log(`CLAIMED +${usd(S.claim)} USDC · ${digest.slice(0, 8)}`, "t-alive");
        S.claim = 0;
        pendingClaimTickets = [];
        render();
      } catch (error) {
        note(
          `CLAIM REJECTED. ${error instanceof Error ? error.message : String(error)}`,
          "bad",
        );
      }
    })();
  }
});
document.addEventListener("mouseover", (e) => {
  const el =
    e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act="ring"]') : null;
  if (el && S.focus !== Number(el.dataset.id)) {
    S.focus = Number(el.dataset.id);
    render();
  }
});
export function pick(id: number): void {
  S.focus = id;
  const ch = char(id);
  if ((S.phase !== "vote" && S.phase !== "countdown") || S.cast) return render();
  if (!ch.alive) return note(`${ch.short} is dead. Dead characters cannot get votes.`, "bad");
  if (S.champion !== null && id === S.champion) {
    return note(`${ch.short} is the champion and stays on. Pick a challenger.`, "bad");
  }
  if (S.picks.includes(id)) {
    S.picks = S.picks.filter((p) => p !== id);
    return note("");
  }
  if (S.picks.length >= S.slots) {
    return note(
      S.slots === 1
        ? "One pick this round. Tap it to drop it."
        : `Two picks max. Tap one to drop it.`,
      "bad",
    );
  }
  S.picks.push(id);
  note("");
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (parent !== window && /^([1-9]|ArrowLeft|ArrowRight|r|R)$/.test(e.key))
    parent.document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key }));
  if (S.phase === "gate") return;
  if (e.key === "v" || e.key === "V") {
    S.view = S.view === 1 ? 2 : 1;
    render();
  }
});

paintFilm();
