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
- Bets are optional. A fight happens with zero bets. Do not seed a house or robot stake.
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
- During `bet` the server reads the Sui pool totals every 2s into `RoundState.pool`.
  Tabs never poll Sui.
- The Sui pool's `closes_at_ms` from `openPool` is only an upper bound the chain
  requires, not a guess of when the video starts.
- Winners share the pool in proportion to their bets.
- If either side has no stake at settle, stakes are refunded (Sui ticket claim path).

### Errors

- If the video fails or takes longer than `VIDEO_TIMEOUT_SECONDS`, show the error, clear the in-memory pool, cancel the Sui pool (ticket refunds), and leave `bet` for `over` so `resetFromOver` can start a new season.
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

Read from `.env`. Add each variable to `.env.example` with an empty value.

| Variable                                  | Dev | Prod |
| ----------------------------------------- | --- | ---- |
| `QUORUM_VOTES`                            | 1   | 2    |
| `VOTE_COUNTDOWN_SECONDS`                  | 15  | 15   |
| `BETTING_CLOSE_AFTER_VIDEO_START_SECONDS` | 5   | 5    |
| `VIDEO_TIMEOUT_SECONDS`                   | 300 | 300  |
| `SETTLE_SECONDS`                          | 8   | 8    |

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
  voters: number; // humans who voted (quorum check; stage 1)
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
- `GET /betting`: public Sui IDs (`packageId`, `houseId`, `coinType`, `network`, `feeBps`). Players bet through `POST /tx` (Shinami) against the open pool; `RoundState.battleId` / `poolId` / `pool` mirror the Sui pool. Fails closed if `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_PRIVATE_KEY`, or `SUI_OPERATOR_CAP_ID` is missing. Zero bets is a valid fight.

## Client

The web client does not run a self-contained sim of the loop. `connectToServerRound` / `applyRoundState` follow server `RoundState` (SSE `/events` and `GET /round`). Votes go to the server; bets go through `/tx`. The fight video is `RoundState.videoUrl`.

Placeholder screens (`apps/web/placeholders.ts`, roots `[data-placeholder="vote"]` and
`[data-placeholder="bet"]`) stand in for the final vote and bet UI. The server phase picks the
screen (`vote`/`countdown`, then `bet`); the client runs no timer. The vote screen shows stored
vote counts and `RoundState.tally`; the bet screen shows the stored `bettingClosesAt`. A rejected
submission stays on the screen that sent it until dismissed. The final UI deletes these roots.

## Out of scope

- How the server is hosted.
- Web bet/claim UI kinds (plan 4). Pool open/close/settle is the server operator.
- Season end beyond today's `OVER` screen and reset.
