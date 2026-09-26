const $ = (s) => document.querySelector(s);
const C = Object.fromEntries(
  [
    "bone",
    "blood",
    "blood-deep",
    "cold",
    "cold-deep",
    "rust",
    "rust-deep",
    "sulfur",
    "dim",
    "muted",
    "alive",
    "panel",
    "rule",
  ].map((k) => [k, HT.css("--" + k)]),
);
let seed = 666;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const hex = (n) =>
  "0x" + Array.from({ length: n }, () => "0123456789abcdef"[(rnd() * 16) | 0]).join("");
const eth = (n) => n.toFixed(n < 0.1 ? 3 : 4);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, "0")}`;

const HUES = ["blood", "cold", "rust"];
const CAST = [
  ["Jason Voorhees", "jason", "mask"],
  ["Laurie Strode", "laurie", "hair"],
  ["Freddy Krueger", "freddy", "hat"],
  ["Michael Myers", "michael", "blank"],
  ["Nancy Thompson", "nancy", "pony"],
  ["Leatherface", "leatherface", "leather"],
  ["Chucky", "chucky", "doll"],
  ["Ellen Ripley", "ripley", "short"],
  ["Pinhead", "pinhead", "pins"],
  ["Ghostface", "ghostface", "ghost"],
  ["Ash Williams", "ash", "chin"],
  ["Pennywise", "pennywise", "clown"],
  ["Candyman", "candyman", "hook"],
  ["Sidney Prescott", "sidney", "hair"],
  ["Samara", "samara", "girl"],
  ["Van Helsing", "vanhelsing", "straw"],
  ["Annabelle", "annabelle", "doll"],
  ["Art the Clown", "art", "clown"],
  ["Lorraine Warren", "lorraine", "cross"],
  ["Victor Crowley", "victor", "leather"],
  ["The Creeper", "creeper", "hat"],
  ["Ed Warren", "ed", "cross"],
  ["Kayako", "kayako", "girl"],
  ["Hannibal Lecter", "hannibal", "blank"],
  ["Alice Hardy", "alice", "pony"],
  ["Frankenstein", "frankenstein", "chin"],
  ["Jigsaw", "jigsaw", "doll"],
  ["Tommy Jarvis", "tommy", "short"],
  ["Count Dracula", "dracula", "blank"],
  ["Esther", "esther", "girl"],
  ["Kirsty Cotton", "kirsty", "hair"],
  ["Dr. Loomis", "loomis", "chin"],
];
const CAPS = {
  mask: ["machete", "regrowth", "silence"],
  hat: ["claws", "dream walk", "burns"],
  blank: ["kitchen knife", "patience", "the mask"],
  leather: ["chainsaw", "family", "the house"],
  doll: ["voodoo", "small size", "the voice"],
  pins: ["chains", "the box", "pain"],
  ghost: ["knife", "phone call", "the mask"],
  clown: ["shapeshift", "fear feed", "sewers"],
  hook: ["hook", "bees", "the mirror"],
  girl: ["the tape", "the well", "seven days"],
  hair: ["kitchen knife", "run", "survive"],
  pony: ["traps", "stay awake", "nerve"],
  short: ["flamethrower", "motion tracker", "nerve"],
  chin: ["chainsaw hand", "boomstick", "one-liners"],
  straw: ["stakes", "crossbow", "holy water"],
  cross: ["crucifix", "faith", "research"],
};
const DEMO = {
  a: CAST.findIndex((c) => c[1] === "frankenstein"),
  b: CAST.findIndex((c) => c[1] === "dracula"),
  video: "assets/demo-fight.mp4",
};
const isDemo = (pair) => !!pair && pair.includes(DEMO.a) && pair.includes(DEMO.b);
const DUR = { vote: 15, story: 4, bet: 15, fight: 10, settle: 8 };
const PLACES = ["CAMP", "FARM", "TOYSHOP", "MINE"];
const CHAPTERS = [
  "finds {b} at the old mill.",
  "follows {b} into the cellar.",
  "waits for {b} under the pier.",
  "cuts the power. {b} hears it.",
  "knocks twice. {b} opens the door.",
];

const S = {
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
  lost: "",
  bet: null,
  side: 0,
  amt: 0.03,
  pool: [0, 0],
  result: 0,
  claim: 0,
  credit: 0.1,
  wallet: "",
  focus: 0,
  last: null,
  note: "",
  noteKind: "",
  frame: 0,
  log: [],
};
const col = (ch) => C[ch.hue];
const living = () => S.chars.filter((c) => c.alive);
const caps = (ch) => CAPS[ch.kind].slice(0, 3 - ch.lost);
const deadEns = (ch) => (ch.alive ? ch.ens : ch.ens.replace(".horrortube", ".deadpool.horrortube"));
const pair = () => {
  const sorted = living().sort((a, b) => (S.votes[b.id] || 0) - (S.votes[a.id] || 0));
  return sorted.length > 1 ? [sorted[0].id, sorted[1].id] : null;
};
const place = (round) => PLACES[round % PLACES.length];
const log = (text, cls = "") => {
  S.log.unshift({ round: S.round, text, cls });
  S.log.length = Math.min(S.log.length, 80);
};
const note = (text, kind = "") => {
  if (kind === "bad") log(text, "t-dead");
  S.note = text;
  S.noteKind = kind;
  render();
};

function newSeason() {
  S.chars = CAST.map(([name, handle, kind], id) => ({
    id,
    name,
    short: name.split(" ").at(-1).toUpperCase(),
    ens: handle + ".horrortube.eth",
    hue: HUES[id % 3],
    kind,
    alive: true,
    kills: 0,
    damage: 0,
    lost: 0,
  }));
  Object.assign(S, { round: 1, focus: 0, last: null, view: 1 });
  log("NEW SEASON · every subname reset to status=alive", "t-house");
  startVote();
}
function startVote() {
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
  if (S.round === 1) for (const id of [DEMO.a, DEMO.b]) S.votes[id] += 24;
  log(`ROUND ${S.round} · VOTE OPEN`, "t-house");
  render();
}
function startStory() {
  S.fighters = pair();
  if (!S.fighters) return end();
  const [a, b] = S.fighters.map((i) => S.chars[i]);
  const edge = 0.5 + (a.kills - b.kills) * 0.05 - (a.damage - b.damage) * 0.004;
  S.winner = isDemo(S.fighters) ? S.fighters.indexOf(DEMO.a) : rnd() < edge ? 0 : 1;
  S.dmg = 15 + ((rnd() * 35) | 0);
  S.story = `${a.short} ${CHAPTERS[S.round % CHAPTERS.length].replace("{b}", b.short)}`;
  log(`LOADED ${a.ens} + ${b.ens}`, "t-house");
  log("THE STORY IS BEING WRITTEN", "t-house");
  Object.assign(S, { phase: "story", t: DUR.story, note: "" });
  render();
}
function startBet() {
  log("VOTING CLOSED · BETTING OPEN", "t-house");
  Object.assign(S, {
    phase: "bet",
    t: DUR.bet,
    pool: [0.2 + rnd() * 0.3, 0.2 + rnd() * 0.3],
    side: 0,
    note: "",
  });
  render();
}
function startFight() {
  Object.assign(S, { phase: "fight", t: DUR.fight, frame: 0, note: "" });
  log(`ON AIR · ${S.story}`, "t-yours");
  render();
}
function startSettle() {
  const w = S.chars[S.fighters[S.winner]],
    l = S.chars[S.fighters[1 - S.winner]];
  l.alive = false;
  w.kills++;
  w.damage = Math.min(95, w.damage + S.dmg);
  const lost = (w.damage >= 67 ? 2 : w.damage >= 34 ? 1 : 0) - w.lost;
  S.lost = lost > 0 ? CAPS[w.kind][3 - w.lost - 1] : "";
  w.lost += Math.max(0, lost);
  log(`${w.short} KILLS ${l.short}`, `t-${w.hue}`);
  log(`${deadEns(l)} · status=dead`, "t-house");
  log(`${w.ens} · damage=${w.damage}${S.lost ? ` · lost ${S.lost}` : ""}`, "t-house");
  S.result = 0;
  if (S.bet) {
    const total = S.pool[0] + S.pool[1];
    S.result = S.bet.side === S.winner ? (S.bet.amt * total) / S.pool[S.winner] : -S.bet.amt;
    if (S.result > 0) S.claim += S.result;
    log(
      S.result > 0 ? `CLAIMABLE +${eth(S.result)} Ξ` : `LOST −${eth(S.bet.amt)} Ξ`,
      S.result > 0 ? "t-alive" : "t-lost",
    );
  }
  S.last = { fighters: S.fighters, winner: S.winner, round: S.round };
  S.focus = w.id;
  Object.assign(S, { phase: "settle", t: DUR.settle });
  render();
}
function end() {
  Object.assign(S, { phase: "over", t: 0 });
  log("SEASON OVER", "t-yours");
  render();
}
function next() {
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
  if (S.phase === "gate" || S.phase === "over") return;
  S.t -= 0.25;
  if (S.phase === "vote" && rnd() < 0.8) {
    const l = living(),
      c = l[(rnd() * l.length) | 0];
    S.votes[c.id] = (S.votes[c.id] || 0) + 1 + ((rnd() * 2) | 0);
  }
  if (S.phase === "bet") S.pool[(rnd() * 2) | 0] += rnd() * 0.02;
  if (S.t <= 0) return next();
  tick();
}, 250);

const replaying = () => (S.phase === "vote" || S.phase === "story") && !!S.last;
const rendered = () =>
  S.phase === "bet"
    ? Math.min(1, 1 - S.t / DUR.bet)
    : S.phase === "fight" || S.phase === "settle"
      ? 1
      : 0;
setInterval(() => {
  if (S.phase === "fight" || replaying()) S.frame++;
  if (S.phase !== "gate") paintFilm();
}, 125);

function figure(c, ch, i, f, dead, moving) {
  c.save();
  if (i === 1) {
    c.translate(160, 0);
    c.scale(-1, 1);
  }
  if (dead) {
    c.translate(12, 86);
    c.rotate(-Math.PI / 2);
  } else c.translate(22 + (moving ? (f % 6 < 3 ? 2 : 0) : 0), 20 + (moving ? (f >> 1) % 2 : 0));
  HT.PORTRAITS[ch.kind](c);
  HT.L(c, 16, 33, 16, 48);
  HT.L(c, 16, 48, 10, 63);
  if (ch.damage >= 50) HT.L(c, 16, 48, 20, 56, 18, 63);
  else HT.L(c, 16, 48, 22, 63);
  if (ch.lost < 2) HT.L(c, 16, 38, 29, moving ? 30 + (f % 4 < 2 ? 0 : 3) : 40);
  else HT.L(c, 16, 38, 20, 46);
  c.restore();
}
const tri = (c, ...p) => {
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
};
function paintFilm() {
  const f = S.frame,
    rep = replaying(),
    shot = rep
      ? S.last
      : S.fighters && S.phase !== "vote" && S.phase !== "story"
        ? { fighters: S.fighters, winner: S.winner, round: S.round }
        : null,
    [fill, lamp] = SCENERY[place(shot ? shot.round : S.round)],
    layers = [
      [C.rule, fill],
      [C.panel, (c) => c.fillRect(0, 85, 160, 5)],
      [C["rust-deep"], lamp],
      [
        C["rust-deep"],
        (c) => {
          HT.L(c, 0, 85, 20, 84, 40, 86, 60, 84, 80, 85, 100, 84, 120, 86, 140, 84, 160, 85);
          for (const x of [68, 84, 100]) {
            HT.L(c, x, 84, x, 75);
            HT.L(c, x - 3, 78, x + 3, 78);
          }
          HT.A(c, 132, 16, 7, 0, 2);
        },
      ],
    ];
  if (shot) {
    const loop = f % 80,
      moving = S.phase === "fight" || (rep && loop < 64),
      dead =
        S.phase === "settle" || S.phase === "over" || (rep && loop >= 64) ? 1 - shot.winner : -1;
    shot.fighters.forEach((id, i) =>
      layers.push([col(S.chars[id]), (c) => figure(c, S.chars[id], i, f, dead === i, moving)]),
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
              HT.L(
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
  HT.paint($("#film"), 160, 90, layers);
}

const face = (id, size = 32) =>
  `<canvas data-face="${id}" width="32" height="32" style="width:${size}px;height:${size}px"></canvas>`;
function paintFaces(root) {
  for (const cv of root.querySelectorAll("canvas[data-face]")) {
    const ch = S.chars[+cv.dataset.face];
    HT.portrait(cv, ch.kind, col(ch), { dead: !ch.alive });
  }
}
const odds = (i) => ((S.pool[0] + S.pool[1]) / S.pool[i]).toFixed(2);
const pct = () => `${Math.round(rendered() * 100)}%`;
const stripLabel = () =>
  replaying()
    ? `LAST BATTLE · ROUND ${S.last.round}`
    : {
        vote: "NO BATTLE YET · THE CROWD DECIDES",
        story: `ROUND ${S.round} · THE STORY IS BEING WRITTEN`,
        bet: `ROUND ${S.round} · BETS OPEN · VIDEO ${pct()}`,
        fight: `CHAPTER ${S.round} · ON AIR`,
        settle: `ROUND ${S.round} · RESULT`,
        over: "THE END",
      }[S.phase] || "";
const plates = () => {
  if (!S.fighters || (S.phase !== "bet" && S.phase !== "settle")) return "";
  const state = (i) => (S.phase === "settle" ? (i === S.winner ? " chosen" : " struck") : "");
  const sub = (i) =>
    S.bet && S.bet.side === i ? "YOUR BET" : S.phase === "bet" ? `×${odds(i)}` : "";
  return `<div class="plates">${S.fighters
    .map(
      (id, i) =>
        `<div class="plate ${S.chars[id].hue}${state(i)}"><b>${S.chars[id].short}</b><small data-plate="${i}">${sub(i)}</small></div>`,
    )
    .join("")}</div>`;
};
const redacted = () =>
  `${S.story} <span class="redact">WINNER: ${"█".repeat(8)} · DAMAGE: ██</span>`;
const pipbar = () =>
  `<p class="pipbar">LIVING <b>${living().length}</b> OF ${S.chars.length}<span class="pips-row" aria-hidden="true">${S.chars
    .map((ch) => `<i class="${ch.alive ? ch.hue : "dead"}"></i>`)
    .join("")}</span></p>`;
const recs = (ch) => `<dl class="recs">
  <dt>status</dt><dd class="${ch.alive ? "t-alive" : "t-dead"}">${ch.alive ? "alive" : "dead"}</dd>
  <dt>kills</dt><dd>${ch.kills}</dd>
  <dt>damage</dt><dd class="${ch.damage ? "t-dead" : ""}">${ch.damage}</dd>
  <dt>capabilities</dt><dd>${CAPS[ch.kind].map((cap, i) => (i < 3 - ch.lost ? cap : `<s class="t-dead">${cap}</s>`)).join(", ")}</dd></dl>`;

function gate(step) {
  const g = $("#gate");
  g.hidden = false;
  if (step === "wallet")
    g.innerHTML = `<p class="osd t-alive lit">■ VERIFIED · HUMAN 18+</p><h1 class="lit">CONNECT A WALLET</h1>
    <p>Voting is free. To bet, you need test ETH on Sepolia.</p>
    <div class="row"><button class="btn primary" data-act="wallet">OPEN YOUR WALLET</button><button class="btn" data-act="empty">CONNECT AN EMPTY WALLET</button></div>`;
  if (step === "funds")
    g.innerHTML = `<p class="osd t-alive lit">■ ${S.wallet}</p><h1 class="lit">${S.credit > 0 ? "FUNDS OK" : "NO FUNDS"}</h1>
    <p class="ens">check_funds(${S.wallet}) → ${S.credit.toFixed(2)} USDC on Sui testnet</p>
    <p>${S.credit > 0 ? "You can vote and bet." : "You can vote, but you cannot bet. Send testnet USDC to this address, then open your wallet again."}</p>
    <div class="row"><button class="btn primary" data-act="enter">ENTER</button></div>`;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === "wallet") {
    HT.wallet().then(async (w) => {
      S.wallet = w.address;
      S.credit = Number(await HT.usdcBalance(w)) / 1e6;
      gate("funds");
    });
  } else if (act === "empty") {
    S.wallet = hex(4) + "…" + hex(2).slice(2);
    S.credit = 0;
    gate("funds");
  } else if (act === "enter") {
    $("#gate").hidden = true;
    newSeason();
  } else if (act === "skip") {
    if (S.phase !== "gate") next();
  } else if (act === "view") {
    S.view = +el.dataset.v || (S.view === 1 ? 2 : 1);
    render();
  } else if (act === "reset") newSeason();
  else if (act === "ring") pick(+el.dataset.id);
  else if (act === "cast") {
    S.cast = hex(10);
    log(`VOTE CAST · nullifier ${S.cast}`, "t-alive");
    note("Proof checked on the server.", "good");
  } else if (act === "side") {
    S.side = +el.dataset.i;
    render();
  } else if (act === "amt") {
    S.amt = +el.dataset.a;
    render();
  } else if (act === "bet") {
    if (S.bet || S.phase !== "bet" || S.amt > S.credit) return;
    S.bet = { side: S.side, amt: S.amt };
    S.credit -= S.amt;
    S.pool[S.side] += S.amt;
    log(`BET ${S.amt} Ξ ON ${S.chars[S.fighters[S.side]].short}`, "t-yours");
    render();
  } else if (act === "claim") {
    if (!S.claim) return;
    log(`CLAIMED +${eth(S.claim)} Ξ`, "t-alive");
    S.credit += S.claim;
    S.claim = 0;
    render();
  }
});
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest('[data-act="ring"]');
  if (el && S.focus !== +el.dataset.id) {
    S.focus = +el.dataset.id;
    (window.onFocus || render)();
  }
});
function pick(id) {
  S.focus = id;
  const ch = S.chars[id];
  if (S.phase !== "vote" || S.cast) return render();
  if (!ch.alive) return note(`${ch.short} is dead. Dead characters cannot get votes.`, "bad");
  if (S.picks.includes(id)) {
    S.picks = S.picks.filter((p) => p !== id);
    S.votes[id]--;
    return note("");
  }
  if (S.picks.length === 2) return note("Two picks max. Tap one to drop it.", "bad");
  S.picks.push(id);
  S.votes[id]++;
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
