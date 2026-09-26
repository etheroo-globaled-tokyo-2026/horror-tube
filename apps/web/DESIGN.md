# Horror Tube design system

A horror battle royale that people watch and bet on. The goal is **dread**: the viewer is complicit, the tone is calm
about death, and the house already knows the winner. The flow is `docs/PLAN.md`.

You sit alone in a rusty room in front of an old TV, with a TV remote in your hand.

| File                    | What it is                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `main.ts`               | The 3D room (Three.js from npm), the TV picture and the remote.       |
| `game.ts`               | The simulated game from `docs/PLAN.md`. No layout.                    |
| `wallet.ts`             | The Sui burner wallet: `getGameWallet()`, USDC balance and transfers. |
| `coinbox.ts`            | The coin box: meter, coin slot, PAY BY PHONE sticker, coin return.    |
| `sfx.ts`                | Every sound, made live with Web Audio. No sound files.                |
| `sprites.ts`            | `paint` (pixel art) and `portrait` (the 16 head sprites).             |
| `ht.css`                | Tokens, plus the World ID gate and coin box panel styles.             |
| `system.html`           | The specimen page for the tokens.                                     |
| `assets/demo-fight.mp4` | The demo fight: Frankenstein vs Dracula. Frankenstein wins.           |

Run `pnpm dev` at the repo root and open `http://localhost:8123/`.

## The flow (game.ts)

World ID (Orb, 18+) → the TV (the coin box holds your USDC; empty means vote only) → **vote** (free, top two living
fight) → **story** (the LLM writes the fight; the winner and damage are known from here) → **bet** (while the video
renders) → **fight** (the video plays) → **settle** (loser `status=dead`, winner takes damage and may lose a capability,
winners **claim**) → vote again, until one is left.

Demo: round 1 favours Frankenstein (26) and Dracula (29), and when they fight, Frankenstein wins, to match the video.

## The wallet

Chain: **Sui testnet** (Sui is a sponsor: "DeFi & Payments", $5k). Money: **USDC**. Researched 2026-09-26.

**Now:** `wallet.ts` is a Sui burner. `getGameWallet()` returns `{ address, signer, client }`, and `getUsdcBalance()`
reads the meter:

- `Ed25519Keypair` from `@mysten/sui` (v2). Keep `getSecretKey()` (`suiprivkey…`) in `localStorage` (`horror-tube.sui-burner-key`), load with
  `Ed25519Keypair.fromSecretKey`. Talk to the chain with `SuiGrpcClient` (`@mysten/sui/grpc`). The old `SuiClient` is
  gone, and JSON-RPC is already off on public testnet nodes.
- Bets and claims (**not built**: no Move contract yet, bets are simulated in `game.ts`): the plan is
  `client.signAndExecuteTransaction({ transaction, signer: keypair })` with `tx.coin({ type: USDC })`. No popup. Check `result.$kind === 'FailedTransaction'`. Send one transaction at a time (two at once fight over the gas
  coin).
- USDC on Sui testnet: `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`, 6 decimals.
  Circle faucet: `faucet.circle.com`, 20 USDC per address every 2 hours.
- **USDsui** (Sui's own dollar, issued by Bridge) is the coin for mainnet:
  `0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI`, 6 decimals. It is **not on
  testnet** (checked 2026-09-26: no coin metadata there). So testnet uses Circle USDC. Moving to USDsui changes one
  constant, `USDC_TYPE`.
- Gas: the burner needs a little SUI to send anything. **Not built:** a faucet that sends testnet SUI and the first
  USDC after World ID, one time per nullifier (needs a backend). Later: our backend sponsors gas with `@mysten-incubation/sponsor` (the client builds, the backend checks and
  co-signs), so users hold only USDC.
- The game only calls one function that returns the signer and the client. Only that function changes later.

**Deposits (the coin box):**

- Coin slot: `@mysten/dapp-kit-core` (no React), `createDAppKit` with `SuiGrpcClient`. Clicking the slot opens the
  INSERT A COIN panel. After a coin is picked: if no wallet is connected, `<mysten-dapp-kit-connect-modal>` opens; the game
  checks that the paying wallet has SUI for gas; then `dAppKit.signAndExecuteTransaction({ transaction })`. Pass the
  `Transaction`, not built bytes: the wallet picks the gas. Do not call the Wallet Standard directly. It signs one transfer: `coinWithBalance({ type: USDC, balance })` to the in-game address. Use Slush.
  Phantom dropped Sui on 2026-09-24.
- PAY BY PHONE: a QR code of the in-game address. Mysten Payment Kit has a `sui:pay?receiver=…&amount=…&coinType=…` URI,
  but we did not confirm that Slush mobile opens it. Plain address first.
- The meter: `client.core.getBalance` for the USDC type. After our own transaction, `waitForTransaction` first, then
  read. For deposits from outside: poll every few seconds now, gRPC streaming later. Websocket subscriptions are gone. The public node allows 100
  requests per 30 seconds, so keep a spare RPC URL for the demo.
- Coin return: the in-game wallet sends all its USDC back (`coinWithBalance` + `transferObjects`) to the wallet that
  last paid in (`horror-tube.payout-address`), or to the connected wallet.
- **Tested 2026-09-26:** a 5 USDC deposit from a Slush wallet landed on Sui testnet and the meter showed it. The coin
  return is not tested yet (the in-game wallet has no SUI).

**Known limit:** if the user clears the browser, or an XSS bug reads the key, the funds are lost. The Sui skills say
never keep keys in the browser. We break that rule on purpose, for testnet only. The server wallet fixes it.

**Later: a wallet that follows the human, not the browser.** World ID must stay the only login, with no popups.
Researched 2026-09-26:

- **Next step (when our backend exists):** move the key to the server. One Ed25519 key per World ID nullifier, encrypted
  with a Worker secret, kept in a Durable Object. The same human gets the same wallet on any device. We hold the keys
  (custodial): OK for testnet.
- **Later pick: Shinami Invisible Wallets + Gas Station.** Sui-native, backend-only, the wallet id is our nullifier,
  gas sponsorship built in. Almost the same flow as our own server keys, so the move is small. Not confirmed: free
  testnet limits.
- **Privy (was the pick):** custom JWT login is free, but needs a "Request access" approval, also for test apps. Sui is
  server-only raw signing, and the browser SDK without React has no Sui. Too much friction for Sui.
- **Not usable:** zkLogin / Enoki (fixed OAuth providers only), Crossmint (no Sui), Dynamic (own login is enterprise
  only). **Costly:** Turnkey (25 free signatures a month), Web3Auth (custom JWT is $69/mo), Para (custom OIDC server).

**Options we did not pick:** blink.cash (ignored). World App wallet (a confirm screen per transaction). Enoki gas
sponsorship (paid tiers only; testnet pricing unclear).

## Onboarding: the waiver

Onboarding happens in the room, not on a form page. It takes from Buckshot Roulette (you sign a waiver) and Paratopic
(hard cuts, no loading screens).

- **Read:** the camera looks down at a paper waiver on the table, below the TV. The TV shows static. No remote yet.
- **Sign:** ENTER, or click the paper. A signature draws on the line. The TV shows the World ID QR code (Orb only).
- **Verified:** the TV says VERIFIED, the paper gets a red VERIFIED stamp. Hard cut to the TV.
- **Fail (no Orb):** the TV switches off, the lights go out, the waiver burns from the bottom up. Then only
  NOT ELIGIBLE stays in the dark. ENTER cuts back to a new waiver.
- **Returning user:** a verified user skips the waiver and starts at the TV.
- **Demo:** `X` or DEMO · NO ORB runs the fail path. DEMO · FORGET ME clears the verified flag.
- The waiver text is also in the page for screen readers. With reduced motion, the burn and the cuts are instant.

There is no wallet step: the burner wallet is made in the background.
Money lives on the coin box (below). Vote and bet stay on the remote.

## The room

- **The room:** real 3D, low-poly, rusty textures with hard pixels, fog, one flickering bulb. Warm colours only.
- **The TV:** the only thing that shows the game. It is **never clickable**.
  - Vote: a TV-guide channel. Last night's fight on top with **REC**, the residents below (number and name, 2 pages).
  - Typing a number: the number and a one-line hint, never a face. The name shows after OK.
  - Bet: A and B with the odds and your stake. Fight: the video, with a warm, low-res filter. Settle: "WE INTERRUPT THIS
    PROGRAM", the loser, and OK to collect.
- **The remote:** the only thing you use for the game. Digits and OK to vote, VOL ± for the stake (and to flip the guide while
  voting), hold A or B to bet, OK to collect.
- **The coin box:** the only thing you use for money. See "The coin box" below.
- **Keyboard:** digits, Enter = OK, Backspace = CLR, ↑/↓ = VOL, hold A/B. `N` skips the phase, `V` shows the records, `M` mutes.

Rules from review:

- **The TV is never interactive.** You act with the remote (the game) or the coin box (money).
- **Picking must not feel like a treat.** No glamour, no vote races, no faces before you choose.
- **Copy is short and human**, not technical.
- **Readable first.** The room renders at 1/1.6 resolution and the TV picture at 640×480, with big type.

## The coin box

Old motel TVs took coins: pay to keep watching, pull the lever to get your coins back. Ours sits on the table, next to
the TV. Everyone knows how it works, so it needs no explanation. The money is USDC on Sui testnet.

- **The meter:** the in-game wallet's real USDC balance on Sui testnet, `CREDIT 5.00`, read every 4 seconds. It counts
  up when money lands. Bets are simulated today, so the meter does not move when you bet; the TV credit
  (`… LEFT · 5.00 USDC`) is the real balance plus simulated wins and losses.
- **The coin slot:** deposit from a browser wallet. Click the slot, pick a coin (5 / 10 / 20 USDC). Your wallet extension
  opens once to approve, and the meter counts up.
- **The sticker, PAY BY PHONE:** deposit from a phone wallet. A QR code on a peeling sticker. Scan it and send USDC. The
  meter counts up when the money lands.
- **The coin return lever:** withdraw. The credit goes back to the wallet that paid in.
- **Empty:** the meter reads `CREDIT 0.00`. You can vote. A and B on the remote do nothing, the TV says
  `NO STAKE. FEED THE COIN BOX.`, and the hint names the keys.
- A wallet popup at deposit time is fine: real money should feel serious. Bets and claims never open a popup. The
  in-game wallet signs them.
- Keys: `D` the coin slot, `P` the sticker, `W` the coin return. Stakes are 1, 3 and 5 USDC.
- **Gas today:** the paying wallet needs testnet SUI for a deposit, and the in-game wallet needs SUI for the coin
  return. Errors stay in a panel ("THE BOX SPAT IT OUT") until closed.
- **Gas later (planned):** a sponsor server pays all gas (Sui sponsored transactions), so players need only USDC.
  Gasless stablecoin transfers would also cover deposits, but they are mainnet only.
- Demo (not built yet): the house drops the first coin, one time per World ID human (the faucet).

## Sound

All sound is made in code with Web Audio (`sfx.ts`): no files, no AI, no cost. The room has a low rumble, the bulb hums
and buzzes when it flickers, and the TV hisses as loud as its static. Something creaks, drips or knocks far away every
15 to 45 seconds.

- The waiver: a pen scratch, the VERIFIED stamp, and on the fail path the TV clicks off, the paper burns, a deep boom.
- The remote: a plastic click per key, a buzz when the TV says no, a ratchet while you hold A or B, a clunk when the bet
  locks.
- The phases: a church bell opens the vote, a typewriter writes the story, a heartbeat speeds up while the bet closes,
  hits on the fight, the emergency-broadcast tone and a boom at "WE INTERRUPT THIS PROGRAM" (a tape stop if you lost),
  a 1 kHz test tone at END OF PROGRAMMING. The demo fight video plays its own sound.
- The coin box: a coin drops in, the meter ticks, the lever ratchets, coins pour out, a buzz when the box spits it out.
- The browser keeps sound off until the first click or key. `M` or SOUND ON · M mutes and remembers it.
- Any sound can be swapped for an ElevenLabs file later, one at a time.

## Colour

Only the tokens in `ht.css`. No hex values anywhere else. The room uses the warm set:

| Token                         | Job                                                 |
| ----------------------------- | --------------------------------------------------- |
| `--soot`, `--char`, `--grime` | The room: darkness, surfaces, dirt.                 |
| `--rust`, `--rust-deep`       | Rust, wood, metal, the OK key.                      |
| `--blood`, `--blood-deep`     | Death, REC, the remote's LED.                       |
| `--sulfur`                    | Light, numbers on the guide, the B key, highlights. |
| `--bone`                      | Text on the TV, the A key.                          |

## Type

- Silkscreen: labels, numbers, titles. Always caps.
- DotGothic16: names, hints, sentences.
- On the TV picture (640×480), 18px is the smallest size.
