# Horror Tube

A battle royale of famous horror characters. AI makes each fight as a video. Verified humans vote on who fights
next (free). Users bet on who wins (paid). ETHGlobal Tokyo 2026.

## Run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill `.env` first. The comment above each variable says how. The web game runs with no `.env`: `apps/web/env.ts`
validates `ENS_LABEL` and `VITE_SEPOLIA_RPC_URL` and defaults both to the public Sepolia values.

## Docs

| File                            | What it is                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `docs/PLAN.md`                  | The product plan, the prize targets, and the status of each part.    |
| `docs/game-loop.md`             | The vote and bet loop, and the contract for the game server.         |
| `apps/web/DESIGN.md`            | The room, the art direction, the wallet, and how the game reads ENS. |
| `docs/character-card-fields.md` | The ENS text records on each character.                              |
| `docs/roster-json.md`           | Roster JSON and the CLIs that write characters to ENS.               |
| `docs/ens-sepolia-parent.md`    | Registering the parent `.eth` name on Sepolia ENSv2.                 |
