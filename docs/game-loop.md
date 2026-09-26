# Game loop

The server boots in `waiting` and opens no bout until verified humans vote for a fighter. The vote books one fighter
for the first bout and the other is random. Every later bout is the winner plus a living challenger the vote picks.
That vote is the room's only choice before betting. The winner stays on until one fighter is left.

## The loop

```
 WAITING ──vote books one──▶ random opponent ──┐
 PICK ──vote picks the next fighter────────────┤
   (quorum, then VOTE_COUNTDOWN_SECONDS)       ▼
                  BET (story + video are made now)
                  closes BETTING_WINDOW_SECONDS after
                  the video is ready
                                          │
                                          ▼
                  FIGHT (video plays) ──▶ SETTLE ──▶ next pair, or OVER
```

## Stages

- **Waiting:** a fresh process holds no bout. No model call, no Sui pool, and no video until the fighter vote
  closes, so a deploy or restart spends nothing.
- **Fighter vote:** in `waiting`, `over` and `pick`, each verified human (`POST /vote` `{ fighter }`, one ballot per
  World ID nullifier) and each house bot casts one ballot for a `selectable` fighter. Once `QUORUM_VOTES` ballots are
  in, the vote stays open `VOTE_COUNTDOWN_SECONDS` more (`RoundState.endsAt`) for late voters. Then the most-voted
  fighter is booked; a tie goes to the fighter that reached the top count first. Ballots live in memory only; a
  restart starts a fresh vote.
- **Opening bout:** the vote books one living fighter. The other fighter is a random living character, drawn with
  the injected `randomInt` (production `cryptoRandomInt`). Dead characters are never drawn.
- **Next fighter:** after a bout, while more than one fighter is alive, the phase is `pick`. The panel lists the
  living fighters except the champion, and the vote picks the challenger. The model is not called.
- **After settle:** the winner stays on. The next bout is that champion plus the voted challenger, then betting.
  One living fighter ends the season.

## Rules

### Start

- The vote books only from `waiting`, `over` or `pick`. A booking failure (for example a store write) is logged,
  shown on `RoundState.bookError`, and leaves the phase so the room can vote again.
- Before the new season, every season a previous process left open in Postgres is ended (`ended_at`, no champion)
  and logged by id.
- A season ends when one character is left (champion recorded) or when a video failure leaves `over`. A failed end
  write is logged and the next start ends that season as a leftover.
- Deaths carry over between seasons while two or more characters are alive on ENS. With fewer than two, the programme
  is finished: every character is offered, and the server writes `status=alive` for each dead one before the new
  season opens. It starts the revival as the last season ends, after that bout's `status=dead` write lands, and
  `POST /start` waits on it. A failed revival write fails the start by name and the next start tries again.

### Bet

- Betting opens as soon as the vote books the pair.
- Bets are optional. A fight happens with zero bets. The only non-human stake is a house bot's (see
  [House bots](#house-bots)).
- Odds are only meaningful when both sides have stake; do not block the video on an empty pool.
- When betting opens, the server starts `runFightTurn` for the bout pair. On success it attaches the agent result,
  then calls `setOutcome` and `setVideoReady` with the CDN video URL, duration, and last-frame URL. A prior
  `frameUrl` on the round is passed as `priorFrameUrl` (image-to-video); the first bout is text-to-video. Missing
  FAL, narration, or Spaces env fails closed and names the variable.
- Narration is checked before any video is made: each `winner_injuries` phrase must appear in the shot text (case
  and punctuation ignored), and the list must keep every injury on the winner's ENS card. A rejected answer is
  logged and asked again with the reason, up to `NARRATION_MAX_ATTEMPTS` (`packages/fight/src/narrate.ts`); then the
  fight job fails naming both fighters.
- Betting stays open while the video is made, with no deadline. When the video is ready the server stores
  `betting_closes_at = ready time + BETTING_WINDOW_SECONDS` with the video URL on the `battle_results` row, then on
  `RoundState.bettingClosesAt`. If that write fails, the video is not marked ready.
- The video never plays while bets are open. Rooms load it during `bet` and play it only in `fight`.
- A bet (`POST /tx` with a `betting::bet` call) received at or after `betting_closes_at` is rejected with that
  timestamp, even before the phase flips. `/tx` bets must also target the live pool during `bet`.
- At `betting_closes_at` the operator calls `closeBetting` on the Sui pool. Only after it succeeds does the round
  set the betting-closed signal, store `video_started_at` (that moment), and enter `fight`. A failed
  `video_started_at` write is logged and the fight still starts, since the chain already closed betting. A failed close stays on `RoundState.error`, keeps betting-closed
  unset, and retries every 2s.
- Entering `bet` assigns the bout's `battleId` and starts the fight job. `openPool` for that ID retries from the
  tick with backoff until it lands; bets are refused while `poolId` is null, and betting does not close until the
  pool exists.
- During `bet` the server reads the Sui pool totals every 2s into `RoundState.pool`. Tabs never poll Sui.
- The Sui pool's `closes_at_ms` from `openPool` is only an upper bound the chain requires, not a guess of when the
  video starts.
- Winners share the pool in proportion to their bets.
- If either side has no stake at settle, stakes are refunded (Sui ticket claim path).

### Errors

- If the video fails or takes longer than `VIDEO_TIMEOUT_SECONDS`, show the error, clear the in-memory pool, cancel
  the Sui pool (ticket refunds; a failed cancel retries from the tick with backoff until it lands), leave `bet` for
  `over`, and end the season. The next fighter vote opens a new season.
- Do not show a placeholder video (see `.cursor/rules/no-fallbacks.mdc`). The fight plays `RoundState.videoUrl`
  only.

### Settle

- After betting is closed **and** the fight video duration has elapsed, the room shows the in-memory `chars`
  update (loser dead, winner damage) and the settle screen. Betting closed means `closeBetting` succeeded at
  `betting_closes_at`. Playback finished means the video duration elapsed since `video_started_at`; the server has
  no playback-end callback. `betting_closes_at` does not stand in for playback finished. The server starts the
  queued ENS writes (winner `injuries`, then loser `status=dead`) and then `operator.settle` beside that screen.
  If either signal is missing, stop and name it. Do not invent those signals from the settle timer. A failed ENS
  write, or a pool settle that fails or has not finished, is logged and is not put on the round error. The settle
  screen still ends on its timer and the next bout opens. `POST /retry-settle` reruns a settle that is still on
  fight or settle with an error.
- The loser dies. The winner takes damage and becomes the champion.
- If only 1 character is alive, the season is over. The `OVER` screen shows, and the fighter vote starts a new
  season with every character revived. A failed video also ends at `over`; it does not start another season by itself.

## Video continuity

- **Stage 1:** text-to-video (`FAL_MODEL`). The story prompt describes both fighters.
- **After each fight:** extract the last frame with `ffmpeg`, upload it to the fight-media bucket under
  `frames/<uuid>.jpg`, and store the CDN URL on `RoundState.frameUrl`.
- **Stage 2+:** image-to-video (`FAL_IMAGE_TO_VIDEO_MODEL`) with `image_url` set to the previous `frameUrl`. The
  prompt describes the new challenger and the champion's damage, and must say the previous loser is gone.
- The stage 2 prompt must say that the loser is gone. The last frame can show the loser. If the prompt does not say
  this, the dead character can come back in the next video.
- If frame extract or upload fails, stop and surface the error. Do not substitute a still or a fixture. If a prior
  frame exists and `FAL_IMAGE_TO_VIDEO_MODEL` is blank, fail — do not drop the frame and call text-to-video.

## Config

### House bots

World ID staging has one test identity, so a room with one tester has no one on the other side of a bet. Each house
bot is a server-side participant with its own Sui key, one per entry in `HOUSE_BOT_SUI_PRIVATE_KEYS`. A second bot
is a second key. Bots stand in for other viewers while testing.

- **Vote:** only after a human voted in the current fighter vote. It votes a random `selectable` fighter, and its
  ballot counts toward `QUORUM_VOTES`.

- **Bet:** once per bout, after the pool opens and before `betting_closes_at`. It bets `HOUSE_BOT_STAKE_UNITS`
  against the larger human stake as soon as the pool shows one. With no human stake, it bets a random side once the
  video is ready. It signs with its own key and pays its own gas (no Shinami, no `POST /tx`).
- **Claim:** when the round reaches `settle` without an error, it claims every finished ticket it holds, including
  refunds from cancelled pools.
- **Failures:** bot actions run from the game tick, one at a time, in the background. A failure is logged with the
  battle id and round and shown on `RoundState.bots[].error`, not `RoundState.error`, so it never blocks the round.
  Claims retry with backoff; a failed or timed-out bet is not retried that bout, since it may still land.
- **Room:** the bet screen labels a side the house bot backs, and the log names each bot bet.

Read from `.env`. Add each variable to `.env.example` with an empty value.

| Variable                     | Dev                 | Prod                |
| ---------------------------- | ------------------- | ------------------- |
| `QUORUM_VOTES`               | 2                   | 2                   |
| `VOTE_COUNTDOWN_SECONDS`     | 5                   | 5                   |
| `PAIRING_MAX_ATTEMPTS`       | 3                   | 3                   |
| `PAIRING_TIMEOUT_SECONDS`    | 30                  | 30                  |
| `BETTING_WINDOW_SECONDS`     | 15                  | 15                  |
| `VIDEO_TIMEOUT_SECONDS`      | 300                 | 300                 |
| `SETTLE_SECONDS`             | 8                   | 8                   |
| `HOUSE_BOT_SUI_PRIVATE_KEYS` | one funded test key | one funded test key |
| `HOUSE_BOT_STAKE_UNITS`      | 500000              | 500000              |

The fight lasts as long as the video. It needs no variable.

## Server contract

All players share one game, so `apps/server` owns the state, the timers, and the bets.
The client and the server agree on this contract.

**State pushed to each tab** (SSE `GET /events`):

```ts
type Phase = "waiting" | "pick" | "bet" | "fight" | "settle" | "over";
type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms; fighter vote close, fight end or settle end; null during bet
  champion: number | null; // character id; null during the fresh bout
  votes: number[]; // fighter vote ballots per character id
  voters: number;
  quorum: number;
  bookError: string | null; // why the voted fighter could not be booked; cleared by the next ballot
  fighters: [number, number] | null;
  selectable: number[]; // ids the panel may book or send as the next fighter
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  battleId: string | null; // Sui pool key while a bout is open
  poolId: string | null;
  videoUrl: string | null;
  videoStartedAt: number | null; // ms; fight start, when betting closed; null during bet
  bettingClosesAt: number | null; // ms; bets at or after it are rejected
  frameUrl: string | null; // last-frame CDN URL; seeds the next image-to-video bout
  error: string | null; // video failed, bets refunded
  bots: {
    address: string; // the bot's Sui address
    bet: { side: 0 | 1; units: number; digest: string } | null; // its bet on the live bout
    error: string | null; // last bot failure; does not stop the round
  }[];
  chars: { id: number; label: string; alive: boolean; kills: number; damage: number }[];
};
```

Character ids are the server's: the index into `ROSTER_ENS_LABELS` sorted by label. `chars[].label` is each id's ENS label. The room keys the roster it reads from ENS by that label, so every id it shows or sends is the server's. `look`, `brief`, `injuries`, `status`, and `icon` come from ENS, not from this state. `chars[].alive` is the server's holding copy for the current season. Settle updates it when the fight duration elapses, then writes winner `injuries` and loser `status=dead` from the `battle_results` queue, then settles the Sui pool. Do not treat the holding copy as what pays out. Stakes are not defined here (no stake columns).

**Actions from the client:**

- `POST /vote` with `Authorization: Bearer <waiver session>` and `{ fighter }`: one ballot for a `selectable` fighter in `waiting`, `over` or `pick`. `400` names a refused fighter. `409` with `code: "already_voted"` or `code: "not_voting"`. `500` names a server failure.
- `GET /betting`: public Sui IDs (`packageId`, `houseId`, `coinType`, `network`, `feeBps`). Players bet through `POST /tx` (Shinami) against the open pool; `RoundState.battleId` / `poolId` / `pool` mirror the Sui pool. Fails closed if `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_PRIVATE_KEY`, `SUI_OPERATOR_CAP_ID`, `HOUSE_BOT_SUI_PRIVATE_KEYS`, or `HOUSE_BOT_STAKE_UNITS` is missing, or if the bot stake is below the House `min_bet`. Zero bets is a valid fight. Pools, keys and payouts: `docs/sui-betting.md`.

## Client

The web client does not run a self-contained sim of the loop. `connectToServerRound` / `applyRoundState` follow
server `RoundState` (SSE `/events` and `GET /round`). The panel lists `selectable`. Voting for one sends `POST /vote`. A failed booking stays on the panel with the server's `bookError`. Bets go through `/tx`. The fight video is `RoundState.videoUrl`.

The server phase picks the screen. The client runs no timer. The bet screen shows the stored
`bettingClosesAt`. A rejected submission stays on the screen until dismissed.

## Out of scope

- How the server is hosted.
- Season end beyond today's `OVER` screen and restart.
