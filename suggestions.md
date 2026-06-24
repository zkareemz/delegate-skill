# Suggestions — delegate-skill

## 5 changes (to existing behavior)

### 1. `parseFinalMessage` (opencode) drops legitimate report text

It keeps only parts matching the *last* `messageID` (`src/adapters/opencode.ts`), but an
implementer's final report often spans multiple messageIDs when a tool call interrupts narration.
Change to join all text parts after the last tool-use boundary, with a tail fallback.

### 2. `events.jsonl` is unbounded

A runaway target (the same failure mode as the missing timeout) writes a giant file via per-line
`appendFileSync` (`src/engine/run.ts`). Change to cap the file (rotate or
truncate-with-marker past N MB) so the artifact stays reviewable and disk-bounded.

### 3. `--skip-git-repo-check` is a negative opt-out flag

Confusing UX and, per spec 001, the guard shouldn't exist. Change to drop the guard entirely
(git becomes an enhancement, not a requirement) and remove the flag; mirrors spec 001's direction
without the full snapshot infra.

### 4. No identity preamble reaches the implementer

The brief is sent verbatim (`src/engine/run.ts`), so the target doesn't know it's relay-driven vs.
a human — it may emit interactive prompts or wait on stdin. Change: inject a minimal
`<delegate_floor>` preamble (you are driven by a relay; no commits; non-interactive; report shape)
before the user brief.

### 5. `smoke.mjs` asserts exit codes only, not the `result.json` shape

A schema regression in `target_unavailable` / `failed` paths ships silently. Change
`scripts/smoke.mjs` to assert the `result.json` fields actually present on the paths that write it
(target-missing → 127, launch-failure simulation).

## 5 new features / additions

### 1. `--dry-run`

Resolve argv, check the target binary + version, validate the brief is non-empty, print what
*would* run — without spawning. Lets the orchestrator confirm plumbing before committing to a long
backgrounded run.

### 2. `result.usage`

Parse tokens/cost/duration from the event stream (`prompt_tokens`, `total_cost`, etc. when the
target emits them) into `result.json`. Lets the orchestrator report what a delegation actually
cost, and the human decide if a rework loop is worth it.

### 3. A `delegate` router skill

Triggers on unqualified "delegate this" requests, runs `command -v pi` / `command -v opencode`,
dispatches to whichever target is installed (or asks if both). Solves the ambiguous dual-trigger
problem without forcing the user to name a target.

### 4. Session index

A small append-only JSON index at a stable path (e.g. `~/.delegate-relay/sessions.json`) mapping
`sessionId → {target, workdir, lastResultPath, finishedAt, status}`. Today the orchestrator hunts
temp dirs to find a prior `result.json` for resume; the index makes "continue that last task" a
lookup.

### 5. `--on-fail rework|abort`

On a non-zero exit, `rework` automatically dispatches a structured delta brief carrying
`stderrTail` + "gates failed, fix and retry" up to `--max-reworks N` (default 0, preserving today's
behavior). Turns the manual review-and-rework loop into an opt-in auto-loop for the boring case
while keeping human review for the judgment case.
