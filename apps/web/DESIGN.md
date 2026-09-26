# Horror Tube design system

A horror battle royale that people watch and bet on. The goal is **dread**: the viewer is complicit, the tone is calm
about death, and the house already knows the winner. The flow is `docs/PLAN.md`.

You sit alone in a rusty room in front of an old TV, with a TV remote in your hand.

| File              | What it is                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `main.ts`         | The 3D room (Three.js from npm), the TV picture and the remote.                                             |
| `game.ts`         | Applies server `RoundState` (`applyRoundState` / `connectToServerRound`). Characters come from ENS (below). |
| `round-client.ts` | Same-origin `GET /round`, SSE `/events`, `POST /vote`.                                                      |
| `wallet.ts`       | The Sui burner wallet: `getGameWallet()`, USDC balance and transfers.                                       |
| `coinbox.ts`      | The slot meter: credit window, coin dial, PAY BY PHONE sticker, padlocked drawer.                           |
| `sfx.ts`          | Every sound, made live with Web Audio. No sound files.                                                      |
| `sprites.ts`      | `paint` (pixel art) and the line helpers.                                                                   |
| `logo.ts`         | The logo on a canvas: `drawLogo` (two lines) and `drawLogoLine` (one line).                                 |
| `brand.html`      | Store art: the 512 × 512 logo and the 1280 × 720 cover. Click an image to save it.                          |
| `ht.css`          | Tokens, the cursors, and the wallet modal theme.                                                            |

Run `pnpm dev` at the repo root and open `http://localhost:8123/`.

## Characters (ENS)

At page load, `game.ts` reads every subname under `<ENS_LABEL>.eth` on Sepolia with
`packages/ens/scripts/roster.ts` (the same reader as the dashboard). It needs `ENS_LABEL` and
`VITE_SEPOLIA_RPC_URL` in the repo-root `.env`. The RPC URL ships in the page, so use a public keyless one.

- Name: the `display_name` record. A blank `display_name` stops the page load.
- Face: the `icon` PNG, everywhere (tape, spine, guide, fight figures).
- Case file: `brief` and current `injuries`. `injury_places` is the list of places that character can be injured. `look` is for the video model only.
- `status=dead` shows the character crossed off and in black and white. It cannot get votes.
- `status` is `alive` or `""` (alive), or `dead`. Any other value, or an empty or broken icon, stops the game with an
  error on the TV that names the character. There is no fallback face.
- A new season starts from chain state. During a season the room shows server `RoundState` `chars`. After the fight duration, the server writes winner `injuries` and loser `status=dead`, then settles the Sui pool.
- **Limit:** the shelf has 10 slots and the guide has 10 rows. Characters after the tenth do not show. The layout must
  change before the roster batches (issues 11–13) go on chain.

## The flow (game.ts)

World ID (Orb, 18+) → the TV (the coin box holds your USDC; empty means vote only) → **vote** (free; server tallies; stage 1 picks the top two) → **countdown** → **bet** (while the video is made; hold A/B builds a Sui `betting::bet` kind and sends it through `/tx`; OK claims finished tickets the same way) → **fight** (`RoundState.videoUrl` plays) → **settle** (server marks loser dead and winner damage, then writes winner `injuries` and loser `status=dead`, then calls `settleBattle` on the Sui pool) → next bout, until one is left.

House bots play too (`RoundState.bots`, rules in `docs/game-loop.md`). A bot votes after the first human, so one
tester reaches the quorum, and bets against the human stake. The room never hides it: the countdown reads
`1 human + house bot voted`, the bet screen prints `HOUSE BOT 0.50 USDC` under the side it backs, the log names each
bot vote and bet, and a bot failure shows in the hint bar without stopping the round.

## The wallet

Chain: **Sui testnet** (Sui is a sponsor: "DeFi & Payments", $5k). Money: **USDC**. Researched 2026-09-26.

**Now:** `wallet.ts` is a Sui burner. `getGameWallet()` returns `{ address, signer, client }`, and `getUsdcBalance()`
reads the meter:

- `Ed25519Keypair` from `@mysten/sui` (v2). Keep `getSecretKey()` (`suiprivkey…`) in `localStorage` (`horror-tube.sui-burner-key`), load with
  `Ed25519Keypair.fromSecretKey`. Talk to the chain with `SuiGrpcClient` (`@mysten/sui/grpc`). The old `SuiClient` is
  gone, and JSON-RPC is already off on public testnet nodes.
- Bets and claims: `betting.ts` builds kinds with `@horror-tube/betting` (`betTx` / `claimTx`) and sends them through
  `runKind` → `POST /tx`. `runKind` waits for the digest and throws the chain's error when the transaction failed
  (a bet that lands after `close_betting` aborts with `EBettingClosed`). IDs come from `GET /betting`. Odds use
  `RoundState.pool` and `feeBps`.
- Winnings: `game.ts` reads the wallet's tickets on every phase change and on every update during settle, because
  the server announces settle before the Sui pool is settled. Tickets in open pools wait. `YOU LOST` counts only the
  stake lost in this round's pool (`RoundState.poolId`), and the result and the claim reset when voting starts.
- One money move at a time: a bet or a collect sets `S.pending` before it is sent and clears it when it lands or
  fails. Meanwhile A/B and OK do nothing, and the TV and the hint say `PLACING YOUR BET…` or `COLLECTING…`. Bets,
  claims and winnings reads run in order, never side by side.
- A rejected bet, collect, vote or winnings read stays in the hint bar, escaped, until the phase changes or the next
  bet or collect lands. `Collected.` and the coins sound only after the claim lands on chain.
- The coin: the live game bets in the repo's own test USDC (`packages/test-usdc`, 6 decimals, no value), not Circle's
  testnet USDC. The web has no coin type of its own: it uses `coinType` from `GET /betting` (the server's
  `SUI_USDC_TYPE`) for the meter, deposits and withdrawals, and the coin box does not mount if that call fails.
- Funding a demo player: `pnpm test-usdc:send <account-index> <to-address> <units>` moves test USDC from one of the
  20 funded wallets into the player's in-game address balance (the PAY BY PHONE QR encodes that address).
- **USDsui** (Sui's own dollar, issued by Bridge) is the coin for mainnet:
  `0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI`, 6 decimals. It is **not on
  testnet** (checked 2026-09-26: no coin metadata there). Moving to it means a new house for that `SUI_USDC_TYPE`.
- Gas: the burner needs a little SUI to send anything. **Not built:** a faucet that sends testnet SUI and the first
  USDC after World ID, one time per nullifier (needs a backend). Later: our backend sponsors gas with `@mysten-incubation/sponsor` (the client builds, the backend checks and
  co-signs), so users hold only USDC.
- The game only calls one function that returns the signer and the client. Only that function changes later.

**Deposits (the coin box):**

- Coin slot: `@mysten/dapp-kit-core` (no React), `createDAppKit` with `SuiGrpcClient`. Clicking the slot opens the
  INSERT A COIN panel. After a coin is picked: if no wallet is connected, `<mysten-dapp-kit-connect-modal>` opens; the game
  checks that the paying wallet has SUI for gas; then `dAppKit.signAndExecuteTransaction({ transaction })`. Pass the
  `Transaction`, not built bytes: the wallet picks the gas. Do not call the Wallet Standard directly. It signs one
  `0x2::coin::send_funds<USDC>` on a `coinWithBalance({ type: USDC, balance })` coin (`usdcDeposit`), so the USDC lands in
  the in-game wallet's address balance. Bets and the coin return spend only that balance; `POST /tx` rejects coin
  objects. Use Slush.
  Phantom dropped Sui on 2026-09-24.
- The connect modal is themed from our tokens: `ht.css` sets the shadcn names dApp Kit reads (all of them, because
  our `--muted` is a text colour and would leak in), and `coinbox.ts` adds the title font and backdrop to its shadow root.
- PAY BY PHONE: a QR code of the in-game address. Mysten Payment Kit has a `sui:pay?receiver=…&amount=…&coinType=…` URI,
  but we did not confirm that Slush mobile opens it. Plain address first.
- The meter: `client.core.getBalance` for the USDC type. After our own transaction, `waitForTransaction` first, then
  read. For deposits from outside: poll every few seconds now, gRPC streaming later. Websocket subscriptions are gone. The public node allows 100
  requests per 30 seconds, so keep a spare RPC URL for the demo.
- Coin return: the in-game wallet sends its whole address balance back through `POST /tx` (`coinWithBalance` +
  `transferObjects`, built with `assumeSufficientAddressBalances`) to the wallet that last paid in
  (`horror-tube.payout-address`), or to the connected wallet.
- **Not tested on testnet yet:** a `send_funds` deposit from Slush followed by the coin return.

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

- **Read:** the camera looks down at a paper waiver on a low stool in front of the TV. The TV shows static above it.
  No remote yet.
- **Sign:** ENTER, or click the paper. A signature draws on the line. The TV asks for proof of life with a World ID QR code. The hint names World App and offers COPY LINK.
- **Opening the wallet:** once the proof verifies, the QR goes away and the TV says VERIFIED · OPENING YOUR WALLET
  while the game wallet session and the coin box open. If that fails, the TV and hint say which step failed and the
  server's reason; the player stays out.
- **Verified:** the TV says VERIFIED, the paper gets a red VERIFIED stamp. Hard cut to the room.
- **Walkthrough** (after every signing, like CloverPit): the camera moves to one thing at a time and the hint bar
  says one line. Click, `ENTER` or `SPACE` moves on, `ESC` skips. The cast keeps loading.
  1. The TV: `THE TV. EVERYTHING AIRS HERE.`
  2. The shelf: `THE RESIDENTS. PULL A TAPE.`
  3. The remote rises, LED blinking: `THE REMOTE. VOTE FOR TWO. THEY FIGHT.`
  4. The meter: `THE METER. FEED IT TO BET.`
  5. The remote again: `HOLD A OR B. BET ON WHO WALKS OUT.`
- **Fail (no Orb):** the TV switches off, the lights go out, the waiver burns from the bottom up. Then only
  NOT ELIGIBLE stays in the dark. ENTER cuts back to a new waiver.
- **Returning user:** a verified user skips the waiver and starts at the TV. The cast loads from ENS (3 to 4 s on
  the public RPC, which also rate-limits: scan log chunks one at a time and stop early; new users never see it, it loads while they read the waiver). Until it lands, the TV shows a warm
  test card with the logo, PLEASE STAND BY, and the hint says the TV is warming up. If the read fails, the TV says NO SIGNAL,
  the hint shows the first lines of the real error, and the full error is in the console. No cache, no fallback cast.
- **Demo:** `X` or DEMO · NO ORB runs the fail path. DEMO · FORGET ME clears the verified flag.
- The waiver text is also in the page for screen readers. With reduced motion, the burn and the cuts are instant.

There is no wallet step: the burner wallet is made in the background.
Money lives on the coin box (below). Vote and bet stay on the remote.

## The room

- **The room:** real 3D, low-poly, rusty textures with hard pixels, fog, one flickering bulb. Warm surfaces only.
  - All textures are drawn in code from the tokens (no image files): stained wallpaper over a wood wainscot, floor
    boards, a low stool with cracked, torn vinyl. Each texture is also its own bump map.
  - The TV is a 1960s UK rental set (reference: Getty Images 3065599, 1963): a yellowed ivory mask with a rounded
    screen, a perforated speaker grille, knobs and a channel dial, rabbit ears. It is worn, not clean: nicotine
    yellowing, grime around the screen, cracks, rusty screws, cigarette burns, drag marks, fingerprints and a
    hairline crack on the glass, a missing knob, foil on an antenna, and a tape note: DON'T TURN IT OFF. It stands on
    its own four splayed, tapered dull-chrome legs with brass tips and an H-frame, like the reference. The legs
    are light so they read against the dark floor, and the camera looks low enough to show them. Wear is
    drawn with the helpers in `sprites.ts` (`blotch`, `drip`, `crack`, `scratches`, `screw`, `burn`).
  - Texels stay small (about 1 cm, 2 to 3 screen pixels) and clean: flowing grain lines, flat shapes, no random
    speckle. Big noisy texels are what made the room look like mush. Textures use nearest filtering up close and
    mipmaps plus anisotropic filtering far away, so surfaces seen at an angle do not sparkle. The TV picture has
    mipmaps too, so small text stays whole.
  - Depth comes from light, not from more props. The bulb hangs low in front of the TV and is the key light: it makes
    a pool of light on the TV and the stool, and the wall falls into the dark. Ambient light stays low, because flat
    light makes the room look flat.
  - The bulb casts hard shadows (`BasicShadowMap`). Ambient occlusion (`GTAOPass`) darkens the places where things
    touch. Exponential fog makes far things darker. The TV picture has no fog.
  - The tapes are real VHS cases (6 × 25 cm spines) in the room palette, never the resident's hue: black plastic,
    a `--sulfur` number sticker (the same colour as the numbers in the TV guide), an aged paper label with the short
    name, and the face at the bottom, tinted with the same warm ramp as the fight video. Plain dark tapes fill the
    rest of the shelf. A dead resident's tape stays, with a grey sticker and label and the name struck out. The
    spines are lit, with a little glow to stay readable.
  - The tape in your hand is the case: a black frame, a faint plastic shine, a `--rust` header, and the spine on its
    side.
  - The camera moves a little with the mouse (parallax).
  - The TV light is cool (`--body`). Dust drifts in the light. The screen glass bulges and catches a soft
    glare. The room has a soft vignette.
- **The TV:** the only thing that shows the game. It is **never clickable**.
  - Vote: a TV-guide channel. Last night's fight on top with **REC**, the residents below (number and name, 2 pages).
    Before the first fight of a season, the top flips through the cast instead: face, `CH 05`, name, `ALIVE` or
    `DEAD`, with a static cut between cards.
  - Typing a number: the resident's case file, the same data as their tape: face, name, kills and damage, `brief`,
    injuries. Typing never lifts a tape, so the TV stays in view. The name shows again after OK.
  - Bet: A and B with the odds and your stake. Fight: the video, with a warm, low-res filter. Settle: "WE INTERRUPT THIS
    PROGRAM", the loser, and OK to collect.
- **The remote:** the only thing you use for the game. Digits and OK to vote, VOL ± for the stake (and to flip the guide while
  voting), hold A or B to bet, OK to collect.
- **The coin box:** the only thing you use for money. See "The coin box" below.
- **Keyboard:** digits, Enter = OK, Backspace = CLR, ↑/↓ = VOL, hold A/B. `N` moves to the next phase (phases never end on their own; ENTER steps the waiver the same way, except the World ID scan, which waits for the proof), `V` shows the records, `M` mutes.

Rules from review:

- **The TV is never interactive.** You act with the remote (the game) or the coin box (money).
- **Picking must not feel like a treat.** No glamour, no vote races, no faces before you choose.
- **Copy is short and human**, not technical, like CloverPit: a few words, then the key. Hover hints name things;
  they do not explain how to click (`PICK TWO · NUMBER OK`, `STAKE VOL ± · BET HOLD A / B`, `COLLECT OK`).
- **Readable first.** The room renders at full window size (CSS pixels) and the TV picture at 640×480, with
  big type. The pixel look comes from the textures, not from a low render size. Remote key labels are drawn at 3×.

## The coin box

A 1960s UK rental TV took coins through a slot meter bolted to its side: pay to keep watching. Ours copies the Smith
Meters "Prepayment TV Switch" (6d, early 1960s; reference photos and notes from eBay UK, the Science Museum Group and
rental-trade memories). It is bolted flush to the TV's left side, top level with the TV top, with a cable down to the
TV. Real proportions (23 × 8 × 7 cm), scaled with our oversized TV. The money is USDC on Sui testnet.

From top to bottom: a peaked cap, the credit window, the rating plate (`T.V. SWITCH`, an invented maker), the drum
counter, the coin dial with its wing handle, a padlock on a staple, and the cash drawer with the instruction plate and
the rental sticker. Ivory enamel front, soot hammertone shell, chipped and rust-stained.

- **The meter:** the in-game wallet's real USDC balance on Sui testnet, read every 4 seconds. The needle in the
  `USDC PAID FOR` window moves from 0 to `FULL` (20). The drum counter shows the exact number (`05.00`); real meters
  had their counter on the side, but the game needs the number in view. Bets are simulated today, so the meter does not
  move when you bet; the TV credit (`… LEFT · 5.00 USDC`) is the real balance plus simulated wins and losses.
- **No popups.** Clicking the meter zooms the camera onto it, like CloverPit. Up close, the hint bar at the bottom
  names what is under the cursor (`COIN DIAL`, `PADLOCK 5.00 USDC inside`, `PAY BY PHONE`), with no instructions.
  `ESC`, Backspace or right-click steps back: coin choice → meter → room. From the room, the hint on hover is
  `COIN METER 5.00 USDC`.
- **The coin dial:** deposit from a browser wallet. Click the dial or the wing handle: the hint bar offers the coins
  (`1` 5 USDC, `2` 10 USDC, `3` 20 USDC, clickable). The handle turns, your wallet extension opens once to approve,
  and the needle rises.
- **The rental sticker, PAY BY PHONE:** deposit from a phone wallet. Click it and the camera leans in until the QR is
  big enough to scan from the screen; the hint bar shows the address, selectable to copy. Send USDC. The meter counts
  up when the money lands.
- **The padlock and the drawer:** withdraw. Real meters had no coin return: the collector unlocked the drawer and paid
  back a rebate. Click the padlock or the drawer: the lock swings, the drawer slides out, and the credit goes back to
  the wallet that paid in.
- **Empty:** the needle rests at 0 and the drums read `00.00`. You can vote. A and B on the remote do nothing, the TV
  says `NO STAKE. FEED THE COIN BOX.`, and the hint names the keys.
- A wallet popup at deposit time is fine: real money should feel serious. Bets and claims never open a popup. The
  in-game wallet signs them.
- Keys: `D` zooms in and offers the coins, `P` leans in on the sticker, `W` opens the padlock, `1`–`3` pick a coin.
  While zoomed, the remote and the held tape are out of view and the remote keys are off. Stakes are 1, 3 and 5 USDC.
- **Gas today:** the paying wallet needs testnet SUI for a deposit. The coin return goes through `POST /tx`, which
  Shinami sponsors, so the in-game wallet holds no SUI.
  Errors zoom onto the meter and stay in the hint bar (`THE BOX SPAT IT OUT …`) until you step back.
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
- The phases: a church bell opens the vote, a typewriter writes the story, a heartbeat while the bet is open,
  hits on the fight, the emergency-broadcast tone and a boom at "WE INTERRUPT THIS PROGRAM" (a tape stop if you lost),
  a 1 kHz test tone at END OF PROGRAMMING. The fight video plays its own sound.
- The coin box: a coin drops in, the meter ticks, the padlock ratchets open, coins pour out, a buzz when the box
  spits it out.
- The browser keeps sound off until the first click or key. `M` or SOUND ON · M mutes and remembers it.
- Any sound can be swapped for an ElevenLabs file later, one at a time.

## Logo

The name on a bad signal: Silkscreen 700 in `--blood`, a `--cold` ghost to the left, and one scan band torn to the
right. `logo.ts` draws it.

- Two lines, HORROR over TUBE at the same width: the warm test card on the TV.
- One line: the waiver header.
- Favicon: `assets/favicon.svg`, HT in the same colours at 16 px. It has hex values, like the cursors, because a
  favicon cannot read `ht.css`.
- Store art: `brand.html`. The saved files are in `docs/brand/`. Make them again when the logo changes.

## Colour

Only the tokens in `ht.css`. No hex values anywhere else.

Every surface in the room uses the warm set, but no two neighbours share a brightness step. From dark to light: the
floor and the legs (`--soot`), the wall (`--char`, a faint `--sulfur` pattern), the stool (`--rust-deep` vinyl) and
the shelf (`--rust-deep`), the TV cabinet and the meter (yellowed ivory), then the paper, the tape labels and the TV
picture. The inside of the shelf is `--soot`, so the tapes pop. Keep the grain sparse and
drop random speckle: noise at the same brightness makes things run together.

The light is split by temperature. The bulb is warm. The TV light (`--body`) and the ambient light (`--cold-deep`) are
cool, so shadows and lit sides do not look alike.

The warm set:

| Token                         | Job                                                 |
| ----------------------------- | --------------------------------------------------- |
| `--soot`, `--char`, `--grime` | The room: darkness, surfaces, dirt.                 |
| `--rust`, `--rust-deep`       | Rust, wood, metal, the OK key.                      |
| `--blood`, `--blood-deep`     | Death, REC, the remote's LED.                       |
| `--sulfur`                    | Light, numbers on the guide, the B key, highlights. |
| `--bone`                      | Text on the TV, the A key.                          |

`--cold` is only for the ghost in the logo.

## Type

- Silkscreen: labels, numbers, titles. Always caps.
- DotGothic16: names, hints, sentences.
- On the TV picture (640×480), 18px is the smallest size.
