# Game loop

The game does not run by itself. Players start each fight with their votes.
The winner stays on and fights the next challenger ("winner stays on", or king of the hill).

## The loop

```
            ┌─────────────────────────────────────────────┐
            ▼                                             │
 VOTE (waits, no timer) ──quorum──▶ COUNTDOWN 15s         │
                                          │               │
                                          ▼               │
                  BET (story + video are made now)        │
                  video plays once ready; closes 5s after │
                  a room reports playback start           │
                                          │               │
                                          ▼               │
                  FIGHT (rest of video) ──▶ SETTLE ───────┘
                                             │
                                  1 alive ──▶ OVER
```

## Stages

- **Stage 1:** nobody has fought yet. Each voter picks 2 characters. The top 2 fight.
- **Stage 2+:** the winner of the last fight stays on. The next challenger is a
  **random living** roster character who is not the winner (`nextRotationPair` /
  `fightInputFromRotation`). There is no challenger ballot — do not display or
  collect votes whose result the server would discard. Dead characters are never
  chosen. Narration does not pick a different opponent.

Both stages fill empty fight slots. Stage 1 uses votes for both slots. Stage 2+
fills the challenger slot from rotation after settle.

## Rules

### Vote

- The vote has no timer. It waits until the quorum is reached.
- 1 human = 1 vote. Count World ID nullifiers, not picks. One nullifier votes one time per round.
- House bots also vote and count toward the quorum (see [House bots](#house-bots)).
- Stage 1 only: a voter picks exactly 2 characters.
- Dead characters are not on the vote list.
- A vote is final. The voter cannot change their picks.
- When the quorum is reached, a 15s countdown starts. People can still vote during it. Voting closes when it ends.
- **Ties:** the character that got to its vote total first wins the tie.
- A vote counts only once its `votes` row is stored (Postgres). The round's
  first vote creates its `seasons` and `rounds` rows. The
  `votes_round_nullifier_unique` constraint is the one-vote rule. A failed
  insert rejects the vote with the round and the database error; it is not
  counted.
- When the countdown ends, voting closes, in-flight inserts finish, and the
  server writes `tallies` from the stored `votes` rows (`vote_count`, and
  `reached_at` = the latest vote for that character). `RoundState.tally` carries
  those stored rows before `phase` becomes `bet`, and the fighters are the top
  two of that stored tally. If the tally insert fails, betting never opens: the
  round goes to `over` with an error naming the round and the database error.
- Votes are not on Sui. Sui holds only the betting pools.
- While the vote waits, the TV replays the last fight.
- Stage 2+ has no vote. After settle, the next bout opens with the champion and a random living challenger.

### Bet

- Betting opens when voting closes (stage 1) or when the next rotation pair is ready (stage 2+).
- Bets are optional. A fight happens with zero bets. The only non-human stake is a house bot's (see [House bots](#house-bots)).
- Odds are only meaningful when both sides have stake; do not block the video on an empty pool.
- When betting opens, the server starts `runFightTurn` for the bout pair (stage 1
  vote pair, or stage 2+ champion + random living challenger). On success it
  attaches the agent result, then calls `setOutcome` and `setVideoReady` with the
  CDN video URL, duration, and last-frame URL. A prior `frameUrl` on the round is
  passed as `priorFrameUrl` (image-to-video); the first bout is text-to-video.
  Missing FAL, narration, or Spaces env fails closed and names the variable.
- A ready video is not a closed book. Once `videoUrl` is set the room plays it
  while betting is still open. The first room whose `<video>` fires `playing`
  sends `POST /playback-start`; the server stores `video_started_at` and
  `betting_closes_at = video_started_at + BETTING_CLOSE_AFTER_VIDEO_START_SECONDS`
  on the `battle_results` row, then on `RoundState` (`videoStartedAt`,
  `bettingClosesAt`). If that write fails, nothing is stored and betting stays open.
- No playback report means no deadline: betting stays open and the server does
  not invent a start time.
- A bet (`POST /tx` with a `betting::bet` call) or a vote received at or after
  `betting_closes_at` is rejected with that timestamp, even before the phase
  flips. `/tx` bets must also target the live pool during `bet`.
- At `betting_closes_at` the operator calls `closeBetting` on the Sui pool. Only
  after it succeeds does the round set the betting-closed signal and enter
  `fight`. A failed close stays on `RoundState.error`, keeps betting-closed
  unset, and retries every 2s.
- Entering `bet` assigns the bout's `battleId` and starts the fight job. `openPool`
  for that ID retries from the tick with backoff until it lands; bets are refused
  while `poolId` is null, and betting does not close until the pool exists.
- During `bet` the server reads the Sui pool totals every 2s into `RoundState.pool`.
  Tabs never poll Sui.
- The Sui pool's `closes_at_ms` from `openPool` is only an upper bound the chain
  requires, not a guess of when the video starts.
- Winners share the pool in proportion to their bets.
- If either side has no stake at settle, stakes are refunded (Sui ticket claim path).

### Errors

- If the video fails or takes longer than `VIDEO_TIMEOUT_SECONDS`, show the error, clear the in-memory pool, cancel the Sui pool (ticket refunds; a failed cancel retries from the tick with backoff until it lands), and leave `bet` for `over` so `resetFromOver` can start a new season.
- Do not show a placeholder video (see `.cursor/rules/no-fallbacks.mdc`). The fight plays `RoundState.videoUrl` only.

### Settle

- After betting is closed **and** the fight video duration has elapsed, apply the
  queued ENS writes (winner `injuries` first, then loser `status=dead`). Betting
  closed means `closeBetting` succeeded at `betting_closes_at`. Playback finished
  means the video duration elapsed since `video_started_at`; the server has no
  playback-end callback. `betting_closes_at` does not stand in for playback
  finished. The room also shows the in-memory `chars` update (loser dead,
  winner damage). After the ENS writes, call `operator.settle` on the Sui pool.
  Then start the next bout from the stored rotation opponent
  (or `fightInputFromRotation`). If either signal is missing, stop and name it.
  Do not invent those signals from the settle countdown. A failed ENS write or
  pool settle stays on the round error (with the battle ID, and the pool for a
  settle) and does not start the next bout. `POST /retry-settle` runs the
  pending steps again.
- The loser dies. The winner takes damage and becomes the champion.
- If only 1 character is alive, the season is over. The `OVER` screen shows, and the reset button starts a new season.

## Video continuity

- **Stage 1:** text-to-video (`FAL_MODEL`). The story prompt describes both fighters.
- **After each fight:** extract the last frame with `ffmpeg`, upload it to the fight-media bucket under `frames/<uuid>.jpg`, and store the CDN URL on `RoundState.frameUrl`.
- **Stage 2+:** image-to-video (`FAL_IMAGE_TO_VIDEO_MODEL`) with `image_url` set to the previous `frameUrl`. The prompt describes the new challenger and the champion's damage, and must say the previous loser is gone.
- The stage 2 prompt must say that the loser is gone. The last frame can show the loser. If the prompt does not say this, the dead character can come back in the next video.
- If frame extract or upload fails, stop and surface the error. Do not substitute a still or a fixture. If a prior frame exists and `FAL_IMAGE_TO_VIDEO_MODEL` is blank, fail — do not drop the frame and call text-to-video.

## Config

### House bots

World ID staging has one test identity, so a room with one tester never reaches `QUORUM_VOTES` = 2 and has no one
on the other side of a bet. Each house bot is a server-side participant with its own Sui key, one per entry in
`HOUSE_BOT_SUI_PRIVATE_KEYS`. A second bot is a second key.

- **Identity:** a bot has no World ID. Its vote row has `bot_address` set and `world_id_nullifier` null, so it can
  never collide with a nullifier. `votes_round_bot_unique` is its one-vote-per-round rule.
- **Vote:** only after at least one human has voted in the round, so bots never start a round alone. It picks
  random living, votable characters that nobody has voted for yet, then fills from voted ones if too few are left.
  Its vote counts toward the quorum and the stored tally. Humans vote first, so their picks win a 1–1 tie.
- **Bet:** once per bout, after the pool opens and before `betting_closes_at`. It bets `HOUSE_BOT_STAKE_UNITS`
  against the larger human stake as soon as the pool shows one. With no human stake, it bets a random side once the
  video is ready. It signs with its own key and pays its own gas (no Shinami, no `POST /tx`).
- **Claim:** when the round reaches `settle` without an error, it claims every finished ticket it holds, including
  refunds from cancelled pools.
- **Failures:** bot actions run from the game tick, one at a time, in the background. A failure is logged with the
  battle id and round and shown on `RoundState.bots[].error`, not `RoundState.error`, so it never blocks the round.
  Votes and claims retry with backoff; a failed or timed-out bet is not retried that bout, since it may still land.
- **Room:** the countdown shows humans and house bots separately, the bet screen labels a side the house bot backs,
  and the log names each bot vote and bet.

Read from `.env`. Add each variable to `.env.example` with an empty value.

| Variable                                  | Dev                 | Prod                |
| ----------------------------------------- | ------------------- | ------------------- |
| `QUORUM_VOTES`                            | 1                   | 2                   |
| `VOTE_COUNTDOWN_SECONDS`                  | 15                  | 15                  |
| `BETTING_CLOSE_AFTER_VIDEO_START_SECONDS` | 5                   | 5                   |
| `VIDEO_TIMEOUT_SECONDS`                   | 300                 | 300                 |
| `SETTLE_SECONDS`                          | 8                   | 8                   |
| `HOUSE_BOT_SUI_PRIVATE_KEYS`              | one funded test key | one funded test key |
| `HOUSE_BOT_STAKE_UNITS`                   | 500000              | 500000              |

The fight lasts as long as the video. It needs no variable.

## Server contract

All players share one game, so a server owns the state, the timers, the votes and the bets.
How the server is built is open. The client and the server agree on this contract.

**State pushed to each tab** (SSE or WebSocket):

```ts
type Phase = "vote" | "countdown" | "bet" | "fight" | "settle" | "over";
type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms timestamp; null while vote waits or bet waits for video
  champion: number | null; // character id; null in stage 1
  slots: 1 | 2; // stage 1 vote picks (2); unused in stage 2+ (no challenger ballot)
  voters: number; // humans and house bots who voted (quorum check; stage 1)
  quorum: number;
  votes: Record<number, number>; // counts of stored votes
  tally: { id: number; votes: number; reachedAt: number }[] | null; // stored tallies rows, ranked; set before bet
  fighters: [number, number] | null;
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  battleId: string | null; // Sui pool key while a bout is open
  poolId: string | null;
  videoUrl: string | null;
  videoStartedAt: number | null; // ms; first room's playback-start report
  bettingClosesAt: number | null; // ms; bets and votes at or after it are rejected
  frameUrl: string | null; // last-frame CDN URL; seeds the next image-to-video bout
  error: string | null; // video failed, bets refunded
  bots: {
    address: string; // the bot's Sui address
    picks: number[] | null; // its vote this round
    bet: { side: 0 | 1; units: number; digest: string } | null; // its bet on the live bout
    error: string | null; // last bot failure; does not stop the round
  }[];
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
```

Character ids index the roster the client reads from ENS (sorted by label). The server must read the same roster.
`look`, `brief`, `injuries`, `status`, and `icon` come from ENS, not from this state.
`chars[].alive` is the server's holding copy for the current season. Settle updates it when the fight duration
elapses, then writes winner `injuries` and loser `status=dead` from the `battle_results` queue, then
settles the Sui pool. Do not treat the holding copy as what
pays out. Stakes are not defined here (no stake columns).

**Actions from the client:**

- `POST /vote` with `Authorization: Bearer <waiver session>` and `{ picks }`: stage 1 only; `picks.length` must equal 2. Dead characters are rejected. The server resolves the session to a nullifier (same pepper as `/auth/world-id`). `400` names a refused vote; `500` means the `votes` row could not be stored. Stage 2+ has no vote.
- `POST /playback-start` with `Authorization: Bearer <waiver session>` and `{ battleId }`: the room's fight video started playing. Accepted only in `bet`, for the live battle, once the video is ready; the first report wins. `409` names why a report was refused; `500` means the `battle_results` write failed and betting stays open.
- `GET /betting`: public Sui IDs (`packageId`, `houseId`, `coinType`, `network`, `feeBps`). Players bet through `POST /tx` (Shinami) against the open pool; `RoundState.battleId` / `poolId` / `pool` mirror the Sui pool. Fails closed if `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_PRIVATE_KEY`, `SUI_OPERATOR_CAP_ID`, `HOUSE_BOT_SUI_PRIVATE_KEYS`, or `HOUSE_BOT_STAKE_UNITS` is missing, or if the bot stake is below the House `min_bet`. Zero bets is a valid fight. Pools, keys and payouts: `docs/sui-betting.md`.

## Client

The web client does not run a self-contained sim of the loop. `connectToServerRound` / `applyRoundState` follow server `RoundState` (SSE `/events` and `GET /round`). Votes go to the server; bets go through `/tx`. The fight video is `RoundState.videoUrl`.

Placeholder screens (`apps/web/placeholders.ts`, roots `[data-placeholder="vote"]` and
`[data-placeholder="bet"]`) stand in for the final vote and bet UI. The server phase picks the
screen (`vote`/`countdown`, then `bet`); the client runs no timer. The vote screen shows stored
vote counts and `RoundState.tally`; the bet screen shows the stored `bettingClosesAt`. A rejected
submission stays on the screen that sent it until dismissed. The final UI deletes these roots.

## Out of scope

- How the server is hosted.
- Season end beyond today's `OVER` screen and reset.
