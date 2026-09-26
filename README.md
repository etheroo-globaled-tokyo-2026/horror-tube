# Horror Tube

A battle royale of famous horror characters. AI makes each fight as a video. Verified humans vote on who fights
next (free). Users bet on who wins (paid). ETHGlobal Tokyo 2026.

## Run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill `.env` first. The comment above each variable says how. `ENS_LABEL` and `VITE_SEPOLIA_RPC_URL` are required. A blank value stops the page and names the variable.

### Local round

The game server only connects to Postgres over verified TLS. On a laptop, use a local database, not production:

```bash
pnpm db:local   # postgres:16 in Docker on 127.0.0.1 with a throwaway CA; --reset recreates it
```

1. Put the two printed lines (`DATABASE_URL`, `DATABASE_CA_CERT`) in `.env.local`. The server and Vite read `.env.local` over `.env`, so `.env` keeps its production values.
2. Run `pnpm dev`.
3. Open `http://localhost:8123` and `http://127.0.0.1:8123`: two origins, so two players. `PORT=<port> pnpm dev` changes the port if 8123 is taken.

Local rounds still write fight results to the shared ENS roster.

## Docs

| File                            | What it is                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `docs/PLAN.md`                  | The product plan, the prize targets, and the status of each part.    |
| `docs/game-loop.md`             | The vote and bet loop, and the contract for the game server.         |
| `docs/sui-betting.md`           | Betting on Sui: the Move package, keys, env, deploy and commands.    |
| `apps/web/DESIGN.md`            | The room, the art direction, the wallet, and how the game reads ENS. |
| `docs/character-card-fields.md` | The ENS text records on each character.                              |
| `docs/roster-json.md`           | Roster JSON and the CLIs that write characters to ENS.               |
| `docs/ens-sepolia-parent.md`    | Registering the parent `.eth` name on Sepolia ENSv2.                 |
| `docs/ens-vendor.md`            | Where ENSv2 is called, the permission flow, and the validation run.  |
