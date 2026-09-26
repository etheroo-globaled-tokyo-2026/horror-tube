# Game loop

The server boots in `waiting` and opens no bout until a verified human starts one. The pairing model picks both
fighters for the first bout, and every later bout is the winner plus a new living challenger the model picks. Before
betting, humans and house bots vote for who they think will win. The winner stays on until one fighter is left.

## The loop

```
 WAITING ──human books one──▶ model picks opponent ──▶ VOTE (waits for quorum) ──▶ COUNTDOWN
                                         after settle, human picks the next fighter, then VOTE again
                                                                            │
                                                                            ▼
                  BET (story + video are made now)
                  video plays once ready; closes 5s after
                  a room reports playback start
                                          │
                                          ▼
                  FIGHT (rest of video) ──▶ SETTLE ──▶ next pair, or OVER
```

## Stages

- **Waiting:** a fresh process holds no bout. No model call, no Sui pool, and no video until a verified human asks
  (`POST /start`), so a deploy or restart spends nothing.
- **Opening bout:** a verified human picks one living fighter (`POST /start` `{ fighter }`). The other fighter is a
  random living character, drawn with the injected `randomInt` (production `cryptoRandomInt`). Dead characters are
  never drawn.
- **Next fighter:** after a bout, while more than one fighter is alive, the phase is `pick`. The panel lists the
  living fighters except the champion. A verified human picks the next one (`POST /next-fighter` `{ fighter }`). The
  model is not called. A dead fighter, the champion, or an unknown id is refused by name.
- **Vote:** each human (one World ID nullifier per round) and each house bot picks which of the two will win. Bots
  vote only after a human has voted, and their votes count toward `QUORUM_VOTES`. Voting stays open with no
  time limit until quorum, then closes `VOTE_COUNTDOWN_SECONDS` later. The tally is stored in Postgres before `bet` and shown
  on `RoundState`.
- **After settle:** the winner stays on. The next bout is that champion plus a living challenger from the pairing
  model, then another vote. One living fighter ends the season.

## Rules

### Start

- `POST /start` needs the waiver session. It pairs and opens the vote only from `waiting` or `over`. While a bout is
  open, or while another start is still opening one, it answers `409` with `code: "bout_open"` and logs the refusal.
- The pair is chosen before any season row is written. A pairing failure answers `500` with `code: "start_failed"`
  and leaves the game where it was.
- Before the new season, every season a previous process left open in Postgres is ended (`ended_at`, no champion)
  and logged by id.
- A season ends when one character is left (champion recorded) or when a video failure leaves `over`. A failed end
  write is logged and the next start ends that season as a leftover.

### Bet

- Betting opens when the vote closes, on the same two fighters.
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
- A ready video is not a closed book. Once `videoUrl` is set the room plays it while betting is still open. The
  first room whose `<video>` fires `playing` sends `POST /playback-start`; the server stores `video_started_at` and
  `betting_closes_at = video_started_at + BETTING_CLOSE_AFTER_VIDEO_START_SECONDS` on the `battle_results` row, then
  on `RoundState` (`videoStartedAt`, `bettingClosesAt`). If that write fails, nothing is stored and betting stays
  open.
- No playback report means no deadline: betting stays open and the server does not invent a start time.
- A bet (`POST /tx` with a `betting::bet` call) received at or after `betting_closes_at` is rejected with that
  timestamp, even before the phase flips. `/tx` bets must also target the live pool during `bet`.
- At `betting_closes_at` the operator calls `closeBetting` on the Sui pool. Only after it succeeds does the round
  set the betting-closed signal and enter `fight`. A failed close stays on `RoundState.error`, keeps betting-closed
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
  `over`, and end the season. A verified `POST /start` opens a new season.
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
- If only 1 character is alive, the season is over. The `OVER` screen shows, and OK starts a new season through
  `POST /start`. A failed video also ends at `over`; it does not start another season by itself.

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
is a second key. A bot never starts a bout; it acts only once a human's `POST /start` opened one.

- **Vote:** only after at least one human has voted in the round. It picks one of the two fighters at random. The
  vote row has `bot_address` set and `world_id_nullifier` null, counts toward quorum and the stored tally, and a
  human's pick wins a tie because the human voted first.
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

| Variable                                  | Dev                 | Prod                |
| ----------------------------------------- | ------------------- | ------------------- |
| `QUORUM_VOTES`                            | 1                   | 2                   |
| `VOTE_COUNTDOWN_SECONDS`                  | 10                  | 10                  |
| `PAIRING_MAX_ATTEMPTS`                    | 3                   | 3                   |
| `PAIRING_TIMEOUT_SECONDS`                 | 30                  | 30                  |
| `BETTING_CLOSE_AFTER_VIDEO_START_SECONDS` | 5                   | 5                   |
| `VIDEO_TIMEOUT_SECONDS`                   | 300                 | 300                 |
| `SETTLE_SECONDS`                          | 8                   | 8                   |
| `HOUSE_BOT_SUI_PRIVATE_KEYS`              | one funded test key | one funded test key |
| `HOUSE_BOT_STAKE_UNITS`                   | 500000              | 500000              |

The fight lasts as long as the video. It needs no variable.

## Server contract

All players share one game, so a server owns the state, the timers, and the bets. How the server is built is open.
The client and the server agree on this contract.

**State pushed to each tab** (SSE or WebSocket):

```ts
type Phase = "waiting" | "pick" | "vote" | "countdown" | "bet" | "fight" | "settle" | "over";
type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms; vote close, or null while bet waits for video
  champion: number | null; // character id; null during the fresh bout
  voters: number;
  quorum: number;
  votes: [number, number]; // live counts for the two fighters, before the stored tally
  tally: [number, number] | null; // stored when voting closes, shown through betting
  fighters: [number, number] | null;
  selectable: number[]; // ids the panel may book or send as the next fighter
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  battleId: string | null; // Sui pool key while a bout is open
  poolId: string | null;
  videoUrl: string | null;
  videoStartedAt: number | null; // ms; first room's playback-start report
  bettingClosesAt: number | null; // ms; bets at or after it are rejected
  frameUrl: string | null; // last-frame CDN URL; seeds the next image-to-video bout
  error: string | null; // video failed, bets refunded
  bots: {
    address: string; // the bot's Sui address
    pick: number | null; // character id it voted for this round
    bet: { side: 0 | 1; units: number; digest: string } | null; // its bet on the live bout
    error: string | null; // last bot failure; does not stop the round
  }[];
  chars: { id: number; label: string; alive: boolean; kills: number; damage: number }[];
};
```

Character ids are the server's: the index into `ROSTER_ENS_LABELS` sorted by label. `chars[].label` is each id's ENS label. The room keys the roster it reads from ENS by that label, so every id it shows or sends is the server's. `look`, `brief`, `injuries`, `status`, and `icon` come from ENS, not from this state. `chars[].alive` is the server's holding copy for the current season. Settle updates it when the fight duration elapses, then writes winner `injuries` and loser `status=dead` from the `battle_results` queue, then settles the Sui pool. Do not treat the holding copy as what pays out. Stakes are not defined here (no stake columns).

**Actions from the client:**

- `POST /start` with `Authorization: Bearer <waiver session>` and `{ fighter }`: that living fighter is booked for the opening bout, a random living opponent is drawn, and the vote opens. From `waiting` or `over`. `400` names a refused fighter. `409` with `code: "bout_open"` means a bout is open or already opening. `500` with `code: "start_failed"` names why the start failed, and the game stays where it was.
- `POST /next-fighter` with the same session and `{ fighter }`: only in `pick`. Sets the champion against that living fighter and opens the vote. `400` names a dead fighter, the champion, or an unknown id.
- `POST /vote` with `Authorization: Bearer <waiver session>` and `{ pick }`: `pick` is the character id of one of the two fighters. `400` names a refused vote; `500` means the vote row could not be stored.
- `POST /playback-start` with `Authorization: Bearer <waiver session>` and `{ battleId }`: the room's fight video started playing. Accepted only in `bet`, for the live battle, once the video is ready; the first report wins. `409` names why a report was refused; `500` means the `battle_results` write failed and betting stays open.
- `GET /betting`: public Sui IDs (`packageId`, `houseId`, `coinType`, `network`, `feeBps`). Players bet through `POST /tx` (Shinami) against the open pool; `RoundState.battleId` / `poolId` / `pool` mirror the Sui pool. Fails closed if `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_PRIVATE_KEY`, `SUI_OPERATOR_CAP_ID`, `HOUSE_BOT_SUI_PRIVATE_KEYS`, or `HOUSE_BOT_STAKE_UNITS` is missing, or if the bot stake is below the House `min_bet`. Zero bets is a valid fight. Pools, keys and payouts: `docs/sui-betting.md`.

## Client

The web client does not run a self-contained sim of the loop. `connectToServerRound` / `applyRoundState` follow
server `RoundState` (SSE `/events` and `GET /round`). The panel lists `selectable`. Booking one sends `POST /start`; picking the next fighter sends `POST /next-fighter`. A failed booking stays on the panel with the server's reason. Bets go through `/tx`. The fight video is `RoundState.videoUrl`.

The placeholder panels (`[data-placeholder="pick"]` and `[data-placeholder="bet"]`) stand in for the final pick and bet
UI. The server phase picks the screen; the client runs no timer. The bet screen shows the stored
`bettingClosesAt`. A rejected submission stays on the screen until dismissed. The final UI deletes this root.

## Out of scope

- How the server is hosted.
- Season end beyond today's `OVER` screen and restart.
