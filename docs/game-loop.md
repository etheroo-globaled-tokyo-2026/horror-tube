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
                  closes when video is ready AND 10s done │
                                          │               │
                                          ▼               │
                  FIGHT (video plays) ──▶ SETTLE ─────────┘
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
- While the vote waits, the TV replays the last fight.
- Stage 2+ has no vote. After settle, the next bout opens with the champion and a random living challenger.

### Bet

- Betting opens when voting closes (stage 1) or when the next rotation pair is ready (stage 2+).
- Bets are optional. A fight happens with zero bets. Do not seed a house or robot stake.
- Odds are only meaningful when both sides have stake; do not block the video on an empty pool.
- The story and the video are made during betting. The LLM picks the winner and the damage.
- Betting closes when the video is ready, and never earlier than 10s.
- Winners share the pool in proportion to their bets.
- If either side has no stake at settle, stakes are refunded (BattleBetting claim path).

### Errors

- If the video fails or takes longer than `VIDEO_TIMEOUT_SECONDS`, show the error and refund all bets.
- Do not show a placeholder video (see `.cursor/rules/no-fallbacks.mdc`). The fight plays `RoundState.videoUrl` only.

### Settle

- After betting is closed **and** the fight video duration has elapsed, apply the
  queued ENS writes (winner `injuries` first, then loser `status=dead`). Betting
  closes when the bet phase ends (video ready and `BET_MIN_SECONDS` passed).
  Playback finished means that fight duration elapsed; the server has no separate
  playback callback. The room also shows the in-memory `chars` update (loser dead,
  winner damage). With `SKIP_BATTLE_SETTLEMENT=1`, skip the BattleBetting
  `settleBattle` call and leave that step pending; with `0`, call `settleBattle`
  after the ENS writes. Then start the next bout from the stored rotation opponent
  (or `fightInputFromRotation`). If either signal is missing, stop and name it.
  Do not invent those signals from the settle countdown. A failed ENS write stays
  on the round error and does not start the next bout. `POST /retry-settle`
  runs the pending ENS steps again.
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

| Variable                 | Dev | Prod |
| ------------------------ | --- | ---- |
| `QUORUM_VOTES`           | 1   | 2    |
| `VOTE_COUNTDOWN_SECONDS` | 15  | 15   |
| `BET_MIN_SECONDS`        | 10  | 10   |
| `VIDEO_TIMEOUT_SECONDS`  | 300 | 300  |
| `SETTLE_SECONDS`         | 8   | 8    |
| `SKIP_BATTLE_SETTLEMENT` | 1   | 1    |

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
  votes: Record<number, number>;
  fighters: [number, number] | null;
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  videoUrl: string | null;
  frameUrl: string | null; // last-frame CDN URL; seeds the next image-to-video bout
  error: string | null; // video failed, bets refunded
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
```

Character ids index the roster the client reads from ENS (sorted by label). The server must read the same roster.
`look`, `brief`, `injuries`, `status`, and `icon` come from ENS, not from this state.
`chars[].alive` is the server's holding copy for the current season. Settle updates it when the fight duration
elapses, then writes winner `injuries` and loser `status=dead` from the `battle_results` queue. With
`SKIP_BATTLE_SETTLEMENT=1` the BattleBetting `settleBattle` call is skipped. Do not treat the holding copy as what
pays out. Stakes are not defined here (no stake columns).

**Actions from the client:**

- `POST /vote` with `Authorization: Bearer <waiver session>` and `{ picks }`: stage 1 only; `picks.length` must equal 2. Dead characters are rejected. The server resolves the session to a nullifier (same pepper as `/auth/world-id`). Stage 2+ has no vote.
- `POST /bet` with `{ side, amount }`: allowed only in the `bet` phase. `amount` is a positive integer stake unit (room UI: 1, 3, or 5). The server calls `BattleBetting.placeBet` with `units × minBet` wei, then mirrors the units into the in-memory `pool`. Fails closed if `BATTLE_BETTING_ADDRESS`, `SEPOLIA_RPC_URL`, or `AGENT_PRIVATE_KEY` is missing, or if `openBattle` did not run for this bout. Zero bets is a valid fight (no house/robot seed).

## Client

The web client does not run a self-contained sim of the loop. `connectToServerRound` / `applyRoundState` follow server `RoundState` (SSE `/events` and `GET /round`). Votes and bets go to the server. The fight video is `RoundState.videoUrl`.

## Out of scope

- How the server is hosted.
- The Sui betting contract. Sepolia `BattleBetting.placeBet` is the on-chain bet path for `POST /bet`.
- Season end beyond today's `OVER` screen and reset.
