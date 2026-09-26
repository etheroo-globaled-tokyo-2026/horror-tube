# Horror Tube design system

A horror battle royale that people watch and bet on. The goal is **dread**: the viewer is complicit, the tone is calm
about death, and the house already knows the winner. The flow is `docs/PLAN.md`.

You sit alone in a rusty room in front of an old TV, with a TV remote in your hand.

| File                    | What it is                                                           |
| ----------------------- | -------------------------------------------------------------------- |
| `index.html`            | The 3D room (Three.js from jsDelivr), the TV picture and the remote. |
| `game.js`               | The simulated game from `docs/PLAN.md`. No layout.                   |
| `sprites.js`            | `HT.paint` (pixel art) and `HT.portrait` (the 16 head sprites).      |
| `ht.css`                | Tokens, plus the World ID and wallet gate styles.                    |
| `system.html`           | The specimen page for the tokens.                                    |
| `assets/demo-fight.mp4` | The demo fight: Frankenstein vs Dracula. Frankenstein wins.          |

Run `python3 -m http.server 8766` in `design/` and open `http://localhost:8766/`.

## The flow (game.js)

World ID (Orb, 18+) → connect wallet (`check_funds`, with an empty-wallet path: vote only) → **vote** (free, top two living
fight) → **story** (the LLM writes the fight; the winner and damage are known from here) → **bet** (while the video
renders) → **fight** (the video plays) → **settle** (loser `status=dead`, winner takes damage and may lose a capability,
winners **claim**) → vote again, until one is left.

Demo: round 1 favours Frankenstein (26) and Dracula (29), and when they fight, Frankenstein wins, to match the video.

## The room

- **The room:** real 3D, low-poly, rusty textures with hard pixels, fog, one flickering bulb. Warm colours only.
- **The TV:** the only thing that shows the game. It is **never clickable**.
  - Vote: a TV-guide channel. Last night's fight on top with **REC**, the residents below (number and name, 2 pages).
  - Typing a number: the number and a one-line hint, never a face. The name shows after OK.
  - Bet: A and B with the odds and your stake. Fight: the video, with a warm, low-res filter. Settle: "WE INTERRUPT THIS
    PROGRAM", the loser, and OK to collect.
- **The remote:** the only thing you use. Digits and OK to vote, VOL ± for the stake (and to flip the guide while
  voting), hold A or B to bet, OK to collect.
- **Keyboard:** digits, Enter = OK, Backspace = CLR, ↑/↓ = VOL, hold A/B. `N` skips the phase, `V` shows the records.

Rules from review:

- **The TV is never interactive.** You act with the remote.
- **Picking must not feel like a treat.** No glamour, no vote races, no faces before you choose.
- **Copy is short and human**, not technical.
- **Readable first.** The room renders at 1/1.6 resolution and the TV picture at 640×480, with big type.

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
