import { parsePinAddressesFromMarkdown } from "@horror-tube/ens/scripts/pin.ts";
import pinMarkdown from "@horror-tube/ens/scripts/pin/sepolia-addresses.md?raw";
import { readRosterFromChain } from "@horror-tube/ens/scripts/roster.ts";
import { A, L, css, ctx2d, paint, type Ctx, type Draw, type Layer } from "./sprites.ts";

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
export const DUR = { vote: 15, story: 4, bet: 15, fight: 10, settle: 8 };
const PLACES = ["CAMP", "FARM", "TOYSHOP", "MINE"] as const;
type Place = (typeof PLACES)[number];
const CHAPTERS = [
  "finds {b} at the old mill.",
  "follows {b} into the cellar.",
  "waits for {b} under the pier.",
  "cuts the power. {b} hears it.",
  "knocks twice. {b} opens the door.",
];

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
export type Phase = "gate" | "vote" | "story" | "bet" | "fight" | "settle" | "over";
export type Shot = { fighters: Pair; winner: number; round: number };
export type LogEntry = { round: number; text: string; cls: string };
export type GameState = {
  view: number;
  phase: Phase;
  t: number;
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
  pool: [number, number];
  result: number;
  claim: number;
  credit: number;
  focus: number;
  last: Shot | null;
  note: string;
  noteKind: string;
  frame: number;
  log: LogEntry[];
};

export const S: GameState = {
  view: 1,
  phase: "gate",
  t: 0,
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
  pool: [0, 0],
  result: 0,
  claim: 0,
  credit: 0,
  focus: 0,
  last: null,
  note: "",
  noteKind: "",
  frame: 0,
  log: [],
};
const col = (ch: Character): string => C[ch.hue];
export const living = (): Character[] => S.chars.filter((c) => c.alive);
const deadEns = (ch: Character): string => (ch.alive ? ch.ens : ch.ens.replace(".", ".deadpool."));
const pair = (): Pair | null => {
  const sorted = living().sort((a, b) => (S.votes[b.id] || 0) - (S.votes[a.id] || 0));
  const [a, b] = sorted;
  return a && b ? [a.id, b.id] : null;
};
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
    name: s.display_name,
    short: s.label.toUpperCase(),
    ens: s.name,
    hue: HUES[id % 3],
    brief: s.brief,
    injuries: s.injuries.join(". "),
    icon: s.img,
    fights: 0,
    alive: s.alive,
    kills: 0,
    damage: 0,
  }));
  Object.assign(S, { round: 1, focus: 0, last: null, view: 1 });
  log(`NEW SEASON · ${S.chars.length} subnames read from ${roster.parentName}`, "t-house");
  startVote();
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
function startVote(): void {
  Object.assign(S, {
    phase: "vote",
    t: DUR.vote,
    picks: [],
    cast: null,
    votes: {},
    fighters: null,
    bet: null,
    winner: -1,
    story: "",
    note: "",
  });
  for (const c of living()) S.votes[c.id] = (rnd() * 6) | 0;
  log(`ROUND ${S.round} · VOTE OPEN`, "t-house");
  render();
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

function startStory(): void {
  S.fighters = pair();
  if (!S.fighters) return end();
  const [a, b] = S.fighters.map(char);
  if (!a || !b) return;
  const edge = 0.5 + (a.kills - b.kills) * 0.05 - (a.damage - b.damage) * 0.004;
  S.winner = rnd() < edge ? 0 : 1;
  S.dmg = 15 + ((rnd() * 35) | 0);
  S.story = `${a.short} ${(CHAPTERS[S.round % CHAPTERS.length] ?? "").replace("{b}", b.short)}`;
  log(`LOADED ${a.ens} + ${b.ens}`, "t-house");
  log("THE STORY IS BEING WRITTEN", "t-house");
  Object.assign(S, { phase: "story", t: DUR.story, note: "" });
  render();
}
function startBet(): void {
  log("VOTING CLOSED · BETTING OPEN", "t-house");
  Object.assign(S, {
    phase: "bet",
    t: DUR.bet,
    pool: [20 + rnd() * 30, 20 + rnd() * 30],
    side: 0,
    note: "",
  });
  render();
}
function startFight(): void {
  Object.assign(S, { phase: "fight", t: DUR.fight, frame: 0, note: "" });
  log(`ON AIR · ${S.story}`, "t-yours");
  render();
}
function startSettle(): void {
  const f = fighters();
  const w = char(f[S.winner] ?? -1),
    l = char(f[1 - S.winner] ?? -1);
  l.alive = false;
  w.fights++;
  l.fights++;
  w.kills++;
  w.damage = Math.min(95, w.damage + S.dmg);
  log(`${w.short} KILLS ${l.short}`, `t-${w.hue}`);
  log(`${deadEns(l)} · status=dead`, "t-house");
  log(`${w.ens} · damage=${w.damage}`, "t-house");
  S.result = 0;
  if (S.bet) {
    const total = S.pool[0] + S.pool[1];
    S.result = S.bet.side === S.winner ? (S.bet.amt * total) / (S.pool[S.winner] ?? 0) : -S.bet.amt;
    if (S.result > 0) S.claim += S.result;
    log(
      S.result > 0 ? `CLAIMABLE +${usd(S.result)} USDC` : `LOST −${usd(S.bet.amt)} USDC`,
      S.result > 0 ? "t-alive" : "t-lost",
    );
  }
  S.last = { fighters: f, winner: S.winner, round: S.round };
  S.focus = w.id;
  Object.assign(S, { phase: "settle", t: DUR.settle });
  render();
}
function end(): void {
  Object.assign(S, { phase: "over", t: 0 });
  log("SEASON OVER", "t-yours");
  render();
}
export function next(): void {
  if (S.phase === "vote") startStory();
  else if (S.phase === "story") startBet();
  else if (S.phase === "bet") startFight();
  else if (S.phase === "fight") startSettle();
  else if (S.phase === "settle") {
    S.round++;
    if (living().length > 1) startVote();
    else end();
  }
}

setInterval(() => {
  if (S.phase === "gate" || S.phase === "over" || countdown.hold) return;
  S.t -= 0.25;
  if (S.phase === "vote" && rnd() < 0.8) {
    const l = living(),
      c = l[(rnd() * l.length) | 0];
    if (c) S.votes[c.id] = (S.votes[c.id] || 0) + 1 + ((rnd() * 2) | 0);
  }
  if (S.phase === "bet") S.pool[rnd() < 0.5 ? 0 : 1] += rnd() * 2;
  if (S.t <= 0) next();
}, 250);

export const replaying = (): boolean => (S.phase === "vote" || S.phase === "story") && !!S.last;
setInterval(() => {
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
      : S.fighters && S.phase !== "vote" && S.phase !== "story"
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

export const odds = (i: number): string => ((S.pool[0] + S.pool[1]) / (S.pool[i] ?? 0)).toFixed(2);
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
    if (S.phase !== "gate") next();
  } else if (act === "view") {
    S.view = Number(el.dataset.v) || (S.view === 1 ? 2 : 1);
    render();
  } else if (act === "reset") void newSeason();
  else if (act === "ring") pick(Number(el.dataset.id));
  else if (act === "cast") {
    S.cast = hex(10);
    log(`VOTE CAST · nullifier ${S.cast}`, "t-alive");
    note("Proof checked on the server.", "good");
  } else if (act === "side") {
    S.side = Number(el.dataset.i);
    render();
  } else if (act === "amt") {
    S.amt = Number(el.dataset.a);
    render();
  } else if (act === "bet") {
    if (S.bet || S.phase !== "bet" || S.amt > S.credit) return;
    S.bet = { side: S.side, amt: S.amt };
    S.credit -= S.amt;
    S.pool[S.side ? 1 : 0] += S.amt;
    log(`BET ${S.amt} USDC ON ${char(fighters()[S.side] ?? -1).short}`, "t-yours");
    render();
  } else if (act === "claim") {
    if (!S.claim) return;
    log(`CLAIMED +${usd(S.claim)} USDC`, "t-alive");
    S.credit += S.claim;
    S.claim = 0;
    render();
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
  if (S.phase !== "vote" || S.cast) return render();
  if (!ch.alive) return note(`${ch.short} is dead. Dead characters cannot get votes.`, "bad");
  if (S.picks.includes(id)) {
    S.picks = S.picks.filter((p) => p !== id);
    S.votes[id] = (S.votes[id] ?? 0) - 1;
    return note("");
  }
  if (S.picks.length === 2) return note("Two picks max. Tap one to drop it.", "bad");
  S.picks.push(id);
  S.votes[id] = (S.votes[id] ?? 0) + 1;
  note("");
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (parent !== window && /^([1-9]|ArrowLeft|ArrowRight|r|R)$/.test(e.key))
    parent.document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key }));
  if (S.phase === "gate") return;
  if (e.key === "n" || e.key === "N") next();
  if (e.key === "v" || e.key === "V") {
    S.view = S.view === 1 ? 2 : 1;
    render();
  }
});

paintFilm();
