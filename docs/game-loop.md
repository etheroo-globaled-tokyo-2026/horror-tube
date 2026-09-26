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
- **Stage 2:** the winner of the last fight is the champion and stays on. Each voter picks 1 challenger.

Both stages use one rule: fill the empty slots. Stage 1 has 2 empty slots. Stage 2 has 1.

## Rules

### Vote

- The vote has no timer. It waits until the quorum is reached.
- 1 human = 1 vote. Count World ID nullifiers, not picks. One nullifier votes one time per round.
- A voter picks exactly `slots` characters: 2 in stage 1, 1 in stage 2.
- The champion and dead characters are not on the vote list.
- A vote is final. The voter cannot change their picks.
- When the quorum is reached, a 15s countdown starts. People can still vote during it. Voting closes when it ends.
- **Ties:** the character that got to its vote total first wins the tie.
- While the vote waits, the TV replays the last fight.

### Bet

- Betting opens when voting closes.
- Bets are optional. A fight happens with no bets.
- The story and the video are made during betting. The LLM picks the winner and the damage.
- Betting closes when the video is ready, and never earlier than 10s.
- Winners share the pool in proportion to their bets.
- If nobody bet on the winner, all bets are refunded.

### Errors

- If the video fails or takes longer than `VIDEO_TIMEOUT_SECONDS`, show the error and refund all bets.
- Do not show a placeholder video (see `.cursor/rules/no-fallbacks.mdc`).
- Exception until the video pipeline exists: the client plays `apps/web/assets/demo-fight.mp4` for every fight. Remove it when `videoUrl` is real.

### Settle

- The loser dies. The winner takes damage and becomes the champion.
- If only 1 character is alive, the season is over. The `OVER` screen shows, and the reset button starts a new season.

## Video continuity

- **Stage 1:** text-to-video. The story prompt describes both fighters.
- **After each fight:** save the last frame of the video to Spaces (use `ffmpeg`).
- **Stage 2:** image-to-video. The start image is the last frame. The prompt describes the new challenger and the champion's damage.
- The stage 2 prompt must say that the loser is gone. The last frame can show the loser. If the prompt does not say this, the dead character can come back in the next video.

## Config

Read from `.env`. Add each variable to `.env.example` with an empty value.

| Variable                 | Dev | Prod |
| ------------------------ | --- | ---- |
| `QUORUM_VOTES`           | 1   | 2    |
| `VOTE_COUNTDOWN_SECONDS` | 15  | 15   |
| `BET_MIN_SECONDS`        | 10  | 10   |
| `VIDEO_TIMEOUT_SECONDS`  | 300 | 300  |
| `SETTLE_SECONDS`         | 8   | 8    |

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
  slots: 1 | 2; // picks per voter this round
  voters: number; // humans who voted (quorum check)
  quorum: number;
  votes: Record<number, number>;
  fighters: [number, number] | null;
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  videoUrl: string | null;
  error: string | null; // video failed, bets refunded
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
```

Character ids index the roster the client reads from ENS (sorted by label). The server must read the same roster.
`look`, `brief`, `injuries`, `status`, and `icon` come from ENS, not from this state.

**Actions from the client:**

- `vote(proof, picks)`: `picks.length` must equal `slots`. The champion and dead characters are rejected. The server verifies the World ID proof.
- `bet(side, amount)`: allowed only in the `bet` phase.

## Client changes

Not started. Today the client runs the old local loop: a timer on every phase, top 2 by votes, no champion.

1. In `apps/web/game.ts`, remove the local loop: the `setInterval` timer, the fake votes, the fake pool growth, `next()`, and the `story` phase.
2. In `apps/web/main.ts`, add the `countdown` phase. Make the vote screen use `slots` (1 or 2 picks), and hide the champion from the list.
3. Until the server exists, run a local fake server that follows the contract. When the real server is ready, change one URL.

## Out of scope

- How the server is built and hosted.
- ENS updates and the Sui contract. They connect later at the `SETTLE` step.
- Season end beyond today's `OVER` screen and reset.
