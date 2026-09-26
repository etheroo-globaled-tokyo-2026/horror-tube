# Horror Tube

[![Horror Tube](./docs/banner.png)](./docs/banner.png)

[![Sui](https://img.shields.io/badge/Sui-4DA2FF?style=flat-square&logo=sui&logoColor=white)](https://sui.io)
[![ENS](https://img.shields.io/badge/ENS-5298FF?style=flat-square&logo=ens&logoColor=white)](https://ens.domains)
[![Worldcoin](https://img.shields.io/badge/Worldcoin-000000?style=flat-square&logo=worldcoin&logoColor=white)](https://world.org)
![Horror](https://img.shields.io/badge/Horror-86101A?style=flat-square)

A battle royale of famous horror characters. AI makes each fight as a video. Verified humans watch; the winner stays
on against a living challenger a person picks. Users bet on who wins (paid). ETHGlobal Tokyo 2026.

The banner was generated with FLUX.1 [dev] (`fal-ai/flux/dev`).

## Run

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill `.env` first. The comment above each variable says how. The page needs `ENS_LABEL` and `VITE_SEPOLIA_RPC_URL`. A blank value stops the page and names the variable. `pnpm dev` also starts the game server. That process needs `GAME_PORT`, `DATABASE_URL`, `DATABASE_CA_CERT`, and the other server variables in `.env.example`. A blank value stops the server and names the variable.

### Local round

The game server only connects to Postgres over verified TLS. On a laptop, use a local database, not production:

```bash
pnpm db:local   # postgres:16 in Docker on 127.0.0.1 with a throwaway CA; --reset recreates it
```

1. Put the two printed lines (`DATABASE_URL`, `DATABASE_CA_CERT`) in `.env.local`. The server and Vite read `.env.local` over `.env`, so `.env` keeps its production values.
2. Run `pnpm dev`.
3. Open `http://127.0.0.1:8123`. Vite listens on `127.0.0.1` only. `PORT=<port> pnpm dev` moves the page. The game server stays on `GAME_PORT`, and Vite proxies API calls to it.

A second player is a second browser profile on that same URL. The waiver session lives in `localStorage`, so two profiles are two viewers on one game. `http://localhost:8123` is a different origin, and it reaches this dev server only when the browser connects to `127.0.0.1`. On macOS, `localhost` resolves to `::1` first.

Local rounds still write fight results to the shared ENS roster and settle the shared Sui pool.

## Docs

| File                            | What it is                                                           |
| ------------------------------- | -------------------------------------------------------------------- |
| `docs/PLAN.md`                  | The product plan, the prize targets, and the status of each part.    |
| `docs/game-loop.md`             | The bout and bet loop, and the contract for the game server.         |
| `docs/sui-betting.md`           | Betting on Sui: the Move package, keys, env, deploy and commands.    |
| `docs/broadcast-story.md`       | The announcer, the room's story, and the words the broadcast uses.   |
| `apps/web/DESIGN.md`            | The room, the art direction, the wallet, and how the game reads ENS. |
| `docs/character-card-fields.md` | The ENS text records on each character.                              |
| `docs/roster-json.md`           | Roster JSON and the CLIs that write characters to ENS.               |
| `docs/ens-sepolia-parent.md`    | Registering the parent `.eth` name on Sepolia ENSv2.                 |
| `docs/ens-vendor.md`            | Where ENSv2 is called, the permission flow, and the validation run.  |
