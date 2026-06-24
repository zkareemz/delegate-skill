# Improvements — delegate-skill

Findings from reading the engine, both adapters, both skills' full reference sets
(diffed against each other), the compiled `relay.mjs`, and `specs/001`. Each item is tagged
by lens and goal: **(A)** AI engineering, **(H)** harness engineering, **(P)** prompt
engineering → solid / consistent / performant.

The top tier is all engine-level — adapters barely move, so both skills benefit at once.

---

## Top tier — high leverage, do soon

### 1. File attribution is muddy and only half-stored — solid/consistent

`src/engine/index.ts` snapshots `git status --porcelain` before the run but keeps only a
boolean `dirtyBefore` (see `RelayResult.dirtyBefore` in `src/engine/types.ts`); `touchedFiles`
is the *after-only* state. So a dirty tree forces the orchestrator to "disentangle manually"
— exactly the judgment-work `specs/001` says belongs in the script.

Incremental fix (no snapshot infra needed): store `dirtyBeforeFiles: string[]` and compute
`changes = {added, modified, deleted}` by diffing before-vs-after porcelain. The orchestrator
then gets the implementer's *actual* delta deterministically.

### 2. `finalMessage` is printed in full to stdout — unbounded and duplicated — performant

`src/engine/result.ts` (`printSummary`) dumps the whole report to stdout, which the
orchestrator's Bash tool captures on completion. It is also in `result.json`. For a long report
this pollutes the orchestrator's context — the very thing the README says delegation avoids.

Fix: add `--summary brief|full|none` (default `brief`: truncate to ~500 chars + "…N more in
result.json"); keep `result.json` authoritative. **(A)**

### 3. No timeout / runaway protection — solid

`src/engine/run.ts` blocks on `child.on("close")` with no ceiling. A stuck implementer (tool
loop, hidden prompt) hangs the relay forever and the orchestrator's backgrounded call never
notifies — catastrophic for unattended queues.

Fix: `--timeout <sec>` (default e.g. 1800, `0` = off) → SIGTERM → grace → SIGKILL, write
`status: failed` + `error: "timeout after Xs"`, exit 124. **(H)**

### 4. The parsers — the most version-sensitive code — have zero tests — solid

`scripts/smoke.mjs` covers arg/exit paths only; `parseFinalMessage` / `parseSessionId`
(`src/adapters/pi.ts`, `src/adapters/opencode.ts`) are uncovered pure functions. A target
event-schema change silently yields an empty `finalMessage` and a confusing "success".

Fix: a fixture-based parser test (JSONL captures from real runs) asserting extraction.
Cheapest highest-value solid win; `takeoff.md` notes a sibling repo already has vitest. **(A)**

### 5. The event stream has rich action data the relay throws away — solid/performant

`events.jsonl` records every tool call / command / file edit, but `result.json` exposes only
porcelain + the implementer's prose. So (per `specs/001`'s own observation) the orchestrator
"re-ran `pi --version`, `ls`'d the tree, hex-dumped a file" to figure out what happened.

Fix: adapter method `parseActions(events) → {commandsRun:[{cmd,exit}], filesEdited:[…],
filesRead:[…]}` surfaced as `result.actions`. Turns the "don't trust" review deterministic. **(A)**

### 6. No guaranteed brief floor — the non-negotiables depend on the agent writing them — consistent

The skill *teaches* the `<action_safety>` / `<structured_output_contract>` blocks, but the relay
passes the brief verbatim (`src/engine/run.ts`); a sloppy brief reaches the implementer with no
"don't commit", no report contract.

Fix: optional `--envelope` (default on) where the relay prepends a target-tuned floor
(`<delegate_floor>…</delegate_floor>`): identity, "do NOT git add/commit", report shape, gates.
Target-aware (pi loads `CLAUDE.md` + `AGENTS.md`; opencode loads `AGENTS.md` only). `--no-envelope`
to disable. **(P)**

---

## Second tier

### 7. `model`/`provider` echo the request, not what ran — solid

`src/engine/result.ts` stores `opts.model` / `opts.provider`; a failed run with defaults shows
`null`. Adapters should extract the resolved model from events → `result.resolvedModel`.
Debugging flaky delegation needs this. **(A)**

### 8. `--gates` opt-in (spec 001 D) — solid/performant

Endorse it. Run after the target in `--cd`, capture `{command, exitCode, passed, outputTail}`.
Keeps the relay observational-by-default while removing the agent's gate-rerun tax. **(H)**

### 9. `appendFileSync` per stdout line in the hot path — performant

`src/engine/run.ts` does a sync disk write on *every* event line; for a chatty implementer that
blocks the event loop and can backpressure the child's stdout pipe.

Fix: `createWriteStream` + async writes, or buffer-and-flush. **(H)**

### 10. No version-range guard — solid

Adapters are "confirmed against" a version in comments only (`src/adapters/pi.ts`,
`src/adapters/opencode.ts`); `targetVersion()` records but never compares.

Fix: `Adapter.supportedRange` (semver) → warn (not fail) in the summary when outside. Public
package, real maintenance risk. **(A)**

### 11. `status: completed` means "exit 0", not "task done" — consistent

`src/engine/run.ts`. A wrapping script will mistake it for success. Either rename
(`target_exited_clean`) or document crisply; with `--gates` (#8), introduce a real `outcome`
only when gates run. **(H)**

### 12. No target-flag passthrough — solid

`--model` / `--provider` are special-cased; there's no way to pass `pi --safe-mode` or an
opencode permission flag without forking.

Fix: `-- <args>` passthrough, adapter-denylisting flags that clash with resume (`--session-id` /
`--session`). **(H)**

### 13. `resultPath` is buried in a multi-line human summary — solid

A backgrounded run that the orchestrator only reunites with via exit code can't find
`result.json`.

Fix: a `--machine` mode printing one JSON line `{resultPath, status, exitCode, sessionId}` to
stdout; human summary to stderr. **(H)**

### 14. Windows argv-brief + `shell:true` is an unaudited quoting path — solid

`src/engine/run.ts` sets `shell:true` on win32 to resolve `.cmd` shims; with `sendBrief:"argv"`
Node re-stringifies the argv, and a brief containing `%VAR%` / `&` / `<` could break or inject.

Fix: on Windows prefer stdin delivery, or `execFile` without shell + manual `.cmd` resolution.
Needs a real Windows test. **(H)**

### 15. Failure is quiet in the brief contract — consistent

The `<verification_loop>` says "fix anything", but a stuck implementer may exit 0 with a hopeful
half-fix.

Fix (envelope/template): "If you cannot make gates pass, do NOT exit 0 silently — first line of
your report must be `BLOCKED: <reason>`." Pairs with a `parseOutcome` that surfaces
`result.blocked`. **(P)**

### 16. Generic "delegate this" matches both skills ambiguously — consistent

Descriptions differ only by target name.

Fix: a thin router skill `delegate` that triggers on unqualified requests and dispatches to
whichever of `pi` / `opencode` is installed (`command -v`); per-target skills remain for explicit
asks. **(P)**

---

## Caveat on spec 001 itself

Section B says "git present → derive `changes` from `git status --porcelain`". That's an
*after-only* snapshot and **reintroduces the attribution conflation** the spec claims to solve —
pre-existing dirty files get reported as the target's work, and `dirtyBefore` is dropped.

The before/after tree snapshot should be the **single source of truth for `changes` regardless of
vcs**; git only adds `diff.patch` + commit capability. Worth correcting before implementing it.

---

## Suggested sequencing

The top tier is where "solid, consistent, performant" lands hardest.

- **PR 1:** #1 (attribution) + #3 (timeout) + #4 (parser tests) — pure engine, no behavior change
  for well-behaved runs.
- **PR 2:** #2 (summary truncation) + #5 (actions) + #6 (envelope) — observable surface changes;
  benefit compounds with #1.
