# Engineering guidelines

This is a greenfield project. Nothing has launched, there are no users, and
nothing is depended on. Move fast, try things, and break them freely.

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.
- No migrations, deprecation paths, compatibility shims, or feature flags for
  old behavior — delete the old thing and replace it.

# Replies

Write the body of a reply however much the work needs — long, detailed, as much
context as it takes. The reader has ADHD, so that detail is fine, but it must
not be the only way to get the answer.

End every reply with a short block, after a `---` rule, that stands on its own
without the text above it:

- Three to five bullets, one line each, no heading.
- What changed or what it means first, then anything blocked or waiting on a
  decision.
- Plain words. No restating the reasoning, no hedging, no links to chase for
  the basics.
- If there is an action for the reader, it is the last bullet, in bold, starts
  with a verb, and it is one action — not a menu of options.

Skip the block only when the whole reply is already one or two lines.



## Standards

### Banned words

The following words are banned from all comments, code, and conversations. This is because they are all generic and inherently carry multiple meanings, and AI agents use them excessively in place of identifiers and filenames that describe actual operations in the code

| Banned           | Say instead                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **corpus**       | every database has a name or domain it's associated with, use the name of the database instead                                                                                                          |
| **wire**         | Just avoid this word, agents typically use it to mean the payload, response, process of transferring data, and have no consistency in its use. Describe the process and what the function/file is doing |
| **load-bearing** | Again just avoid using it. It's a nonsense generic term that has no meaning and AI usually uses it for verbose fluff instead of describing what they observe                                            |

### Pre merge steps

- Squash commits into a few representative commits and remove accredidation to AI tools

### Post merge

- Once your work in a worktree is complete and merged to main, drop any fully implemented plans, specs, and worktrees related to the merged work
- If there's truly important details and decisions in the spec or plans, that content can be selectively and concisely moved to durable docs, but do deeply think about if it will be useful context for future work before doing so. The general trend should always be to delete

### Tool choice

- Use rg when you need to grep and make sure to avoid gitignored files and try to make rg calls as focused as possible instead of searching whole code base
- Edit files with the Edit and Write tools.
- Always use parallel tool calls when possible, especially important when searching for or editing or reading files

### Error handling

- Don't silently swallow errors. Handle them, or surface them in logs and UI. If there's a compelling reason to absorb one, say why in a comment **and tell the operator you made that call**.
- No silent long-running work either, everything that risks running long should have a timeout system. If the app is request heavy, make sure timeout behaviors are consistent and progress should be reported in logs
- Errors say what failed, why, and which items were affected, and persist for review rather than vanishing as a toast
- The REST API is transparent too — real status codes and machine-readable bodies, and API errors surface in the UI. **An error only the calling client can see is a silent error.**
- **Never truncate data** before the database or a log unless a schema requires it.

### Code health

- **Hard deprecation over soft.** When we change how we do something, don't leave artifacts of the old way behind; it's all in git. No back-compat shims — this is a single-user local app.
- One authoritative implementation per concept. No `manager_v2`, no `enhanced_*`.
- Avoid files over ~2000 lines. A file growing that large usually means it's doing too much; split by responsibility.
- Don't use hot imports inside function bodies without a specific runtime reason.
- Fix minor issues you notice in passing, such as a failing test, a stale comment, a lint error, etc. Only punt when you tried and it turned out to be more involved than expected.
- Always opt out of optional telemetry, including in libraries you add. Don't remove existing telemetry.

### Comments

- Comments explain **why** the code is shaped as it is. They should be durable: no reasoning anchors, journal entries, execution state, research findings or hard numbers, all of which go stale and cause churn.
- Comments should be concise and not bloat the file, only communicate exactly what is necessary in comments and do not bloat it with process and research findings.
- If inline comment blocks exceed 4 lines, you're probably being too verbose and need to summarize or consider if what you're writing is worth writing at all. Inline comments should never exceed 7 lines.
- **No hyperspecific anchors** do not put fragile and transient facts like section numbers, plan task numbers, phase numbers, or "added by P1.3". Say the reason, not where the reason was once written down.
- Avoid prose and preambles in comments, communicate the key information clearly and succinctly

### Testing

Tests should always be meaningful and test the functionality of the code.
Avoid hyperspecific tests or writing tests as a knee jerk reaction. Think about the tests you add to the project because maintenance is not free. You should avoid writing tests that:

- Test for a specific hardcoded values instead of testing functionality
- Tests that were written to guard against a problem that just came up once or were programmed for hyperspecific edge cases that are no longer realistic or that are excessively defensive
- Tests that have redundant and repeating boilerplate that could be extracted into an inline function or into a shared testing library function
- Redundant tests
- Unnecessarily complex tests
- You generally should not be testing deprecation. If you drop some code, drop its tests and don't replace those tests with tests that test that the thing is deprecated
- Unit tests should be thorough, but they are not free to maintain. When designing tests and planning for what tests to write, you should consider what will and will not create worthwhile churn:
  - Avoid hyperspecific tests against hardcoded fragile values; they create churn
  - Avoid granular content and numbers that are apt to go stale, such as file counts, test counts in tests, comments and docs alike
  - Avoid writing research finding journals in tests and comments
  - Avoid writing negative tests for fully deprecated features, generally speaking proper planning and type errors should catch gaps in deprecation
  - Never invent a value a closed schema would reject like error codes it can't through, an enum member, a discriminant. These are caught during compilation.
- When planning a new test suite, try to identify the common boilerplate you need before writing tests.
- If in the prcess of writing tests you see repeating boilerplate, extract it into a function. This becomes mandator if more than 3 tests share the same boilerplate
- **A test that cannot fail is worse than a missing one**, because it reads in review as coverage. If you cannot say what edit would turn a test red, it is not coverage. The way to find out is to make that edit and watch it fail — a catalogue of shapes to pattern-match against was tried here and is deleted: it produced confident findings from regex hits, and its taxonomy got cited in place of running the test.
- **Do not test that a value is a value.** An assertion whose _actual_ side is a configuration constant — or a call that only returns one — restates the declaration and protects nothing; retuning the constant just makes someone edit the test. Assert what the code COMPUTES from it. The exception is a constant that is a contract with something outside this repo (a wire format, an external API's spelling), where nothing in the tree derives the value and getting it wrong is a live failure.
- Don't ignore broken tests unrelated to your work if they're easy to fix.
- Coordinating main agents should run full suites before a merge, but for mid-iteration checks, filter to the tests related to your change rather than running the full suite. Hold the expensive suites — full E2E, Playwright — until you finish a feature or hit a milestone. **Scope is not the only cost; frequency is the other one.** A filtered run you repeat after every read is still the dominant line item in this repo's wall clock. Run tests when you have changed the code they cover, and read the run you already have instead of taking a second one.
- Subagents do not have to run full test suites, instead the agents that coordinate subagents can run them when the feature work and/or a full lane or phase is complete. Subagents should, before reporting complete, run the unit tests that relate to their work and run the `check` script if they modified code (`check` and not `check:full`, `check:full` is what operaor agents run)

### Scripts

- One-shot scripts say so in a comment at the top and are deleted after use — unless you can articulate in that comment why it should be kept, and when it will be safe to delete.
- Reusable maintenance scripts stay tracked, have a package script or clear invocation, default to dry-run when destructive, and document when to run.
- Scripts log what they're doing and their progress, especially long-running ones. Don't silently absorb errors, even in a one-shot.
- If you start a long-running background job, use CronCreate to schedule check-ins.

### Docs

- Keep documentation current after major feature or architecture changes.
- Be direct and concise, so long as it doesn't cost usability, legibility, accuracy or quality.
- Durable docs carry durable detail only, such as structure, architecture, and vocabulary, standards. Fragile content such as hardcoded counts, timings and reasoning logs don't belong in them.
- Durable docs should not be treated as a journal of research findings, they should instead focus on current state. If history/process is necessary context, it should be kept concise.
- When determining if you should document something or not, Ask whether what you're writing is genuinely useful to a future reader.
- **Never expose personal details** — username, absolute home paths, unrelated software — in committed documentation.
- Docs are not free to build and maintain. You should err on the side of creating them when in doubt, but if something isn't going to be useful as a durable record for known work or the near future, it.
- If you see minor errors/issues in a doc you're working on, you can fix it on the fly unless it requires deep research to correct.
- If the user makes a very significant change to the specs for planned work, related work in the associated plan should be reviewed and updated
- Avoid prose and preambles in documentation, communicate the key information clearly and succinctly

### Memory

- Do not store transient numbers, like test counts, file counts, run times, in memory since they go stale frequently and creates churn to maintain.
- Subagent coordination and research logs should be tracked in docs or not at all (depending on the size of the task and the fan out complexity) rather than in memory
- If you see something incorrect in memory, you should ask yourself if it adds durable value and cite where it's been used, and generally lean towards cutting it than fixing it as truly durable memories are rarely incorrect.

### Plans

- Plans are not durable docs. They are written before work starts, updated as it progresses, purged when the work is done.
- You will likely have to iterate on new plans a few times before they're adopted. In this early planning phase on you don't need to record the process behind your research, just update items with the latest facts.
- New plans can be committed directly to main unless you're already on a worktree/branch
- Subagents mark their items complete as their work merges to main and can record major progress and stumbling blocks in plan docs
- When a plan gets to >3k lines while mid execution, consider running a subagent to summarize/purge/update transient comments, research findings, and other bloat that might accumulate as subagents write to the plan to communicate their progress to parents and others. At 5k+, this becomes mandatory, no plan should be that long
- When writing plans directly to main stage **and** commit with explicit pathspecs (`git commit -m "..." -- <paths>`) so you don't sweep unrelated work into your commit
- Specs will usually be read by a human. Implementation plans are usually not read by humans in depth. You should avoid verbosity and prose in both specs and plans, and especially in plans as whatever you write is likely going to be consumed by an agent, and unnecessary text means token churn

### TypeScript

- Don't use `any` or cast to `any` unless explicitly instructed.
- Avoid type casting as a solution to type errors unless it's genuinely necessary.
- Avoid `@ts-expect-error`, `@ts-ignore` and `@ts-nocheck`. Fix the type instead.
- Derive types from Zod schemas with `z.infer<typeof schema>` rather than declaring them separately, so the schema and the type can't drift.

### Architecture

pnpm workspace; Turborepo runs the tasks defined in `turbo.json`.

- `apps/web` — Vite room: `main.ts` (3D room, TV, remote), `game.ts` (RoundState client + ENS roster), wallet/coin box, World ID waiver
- `apps/server` — game loop, World ID verify, wallet API (Shinami), Postgres
- `packages/ens` — Sepolia ENSv2 roster read/write CLIs and dashboard
- `packages/fight` — fight narration and fal video
- `packages/fight-media` — Spaces upload for fight clips
- `packages/world-id` — IDKit env and verification helpers
- `packages/roster` — Fandom → character sheet propose/register
- `packages/contracts` — `BattleBetting` (Foundry)
- `packages/rotoscope` — Python (uv, outside the pnpm workspace): HTTP service that redraws fight videos as FAITH line art on the Mac GPU (SAM 3.1, Apple Vision)

### Toolchain

- Node runtime is **pnpm**
- Tests are **node:test** via `tsx --test` (`pnpm --filter <pkg> test`)
- Monorepo tech is turborepo
- Web room is **Vite** + TypeScript (no React)
- Lint is **oxlint** (`pnpm lint`); format is **oxfmt** (`pnpm format`)
- Root scripts: `dev`, `test`, `typecheck`, `lint`, `format`, `ens:*`, `dashboard`, `contracts:*`

### Git

- Conventional commits — `feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `perf:` — one per completed task in a plan.
- Prefer the superpowers skills for planning.
- After finishing a large batch of work in a worktree, you should squash into a few key representative commits before merge
- Worktrees, local branches, specs and plans can be cleared once merged.
- Interactive git flags (`-i`) aren't supported in this environment.

## Fan out standards

Use subagents when tasks can run in parallel, require isolated context, or involve
independent workstreams that don't need to share state. For simple tasks, sequential
operations, single-file edits, or tasks where you need to maintain context across steps,
work directly rather than delegating.

Parents that spawn subagents should regularly check in on progress, make sure they are on track to complete their work, and keep them up to date with the latest context and developments across the project(s). Subagents should also update checklists in plan files that they own/are participating in.

If a subagent is running for >30m, it's generally a sign that it was given too broad of a task to complete. If it's running for >1h, direct intervention is usually needed. Subagents will regularly create worktrees to isolate their work. Those worktrees should be pruned when they're merged into the parent branch and/or main.

Subagents isn't the only way to optimize fan out, both subagents and parents can also improve speed + reduce costs with parallel tool calls:
<use_parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies between the tool
calls, make all of the independent tool calls in parallel. Prioritize calling tools
simultaneously whenever the actions can be done in parallel rather than sequentially.
For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into
context at the same time. Maximize use of parallel tool calls where possible to increase
speed and efficiency. However, if some tool calls depend on previous calls to inform
dependent values like the parameters, do NOT call these tools in parallel and instead
call them sequentially. Never use placeholders or guess missing parameters in tool
calls.
</use_parallel_tool_calls>

## Additional guidance

- Your context window will be automatically compacted as it approaches its limit, allowing
  you to continue working indefinitely from where you left off. Therefore, do not stop
  tasks early due to token budget concerns. As you approach your token budget limit, save
  your current progress and state to memory before the context window refreshes. Always be
  as persistent and autonomous as possible and complete tasks fully, even if the end of
  your budget is approaching. Never artificially stop any task early regardless of the
  context remaining.

### Verification Before Claiming

- Never state a measured number (timings, disk usage, item counts, magic constants) unless you produced it from a command run in this session. Paste the exact command and its output next to the claim.
- If a constant or threshold cannot be derived, say "unverified guess" explicitly instead of presenting it as calibrated.
- Before concluding a feature/behavior is absent, confirm your search covered non-source files (index.html, bundled/vendored assets, minified dist) — grep excludes are the usual reason for a false negative.


