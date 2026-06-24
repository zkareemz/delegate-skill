---
name: delegate-pi
description: >-
  Delegate a coding task to the pi CLI as a background implementer, then review its diff and land it
  yourself. Use this whenever the user wants to hand implementation work to pi — phrasings like "have pi
  do X", "delegate this to pi", "run it through pi", or "use pi to implement/fix/refactor" — or to run a
  queue of coding tasks through pi while staying the reviewer. Reach for it proactively for a separate
  implementation pass on a bounded task — a migration, a mechanical refactor, a removal sweep — where the
  user will review the resulting diff and commit it. DO NOT USE for tasks small enough to do inline, or
  when the user wants the code written directly without delegating.
license: MIT
compatibility: Requires the `pi` CLI installed and authenticated (a provider/model configured), Node 18+, and git. The orchestrating agent must be able to run shell commands and read files. Shell examples assume bash/zsh (macOS/Linux, or Git Bash/WSL on Windows).
metadata:
  version: 0.1.0
---

# Delegate to pi

You are the **orchestrator**. This skill lets you hand a bounded coding task to a separate
**implementer** — the `pi` CLI — then review what it produced and land it yourself. You write the
brief and own the judgment; pi does the typing autonomously in your working tree; you verify and commit.

Nothing here is specific to one orchestrating agent. The loop needs only the ability to run a shell
command and read a file, so it works the same whether you are Claude Code, OpenCode, or any comparable
agent. (It is designed for and verified on Claude Code; treat other orchestrators as designed-for.)

## When NOT to use this

- The task is small enough to just do inline — delegation overhead is not worth it.
- The `pi` CLI is not installed or not authenticated (no provider/model configured).
- You want to write the code yourself, or you only need a review rather than an implementation.

## Prerequisites (check once)

1. `pi --version` succeeds. If not, install pi and configure a provider/model (`pi --list-models`).
2. **You are in (or will point `--cd` at) the target git repository, with a clean-ish working tree.**
   pi edits files in place, and you review the result with `git diff` — so a clean tree before
   dispatch means the diff shows only pi's changes. The relay refuses a non-repo unless you pass
   `--skip-git-repo-check`, and flags a dirty tree in its report.
3. pi reads the repo's `AGENTS.md` / `CLAUDE.md` automatically, so house rules there already apply.

## The loop

Run these five steps per task. Steps 1, 4, and 5 are your judgment; 2 and 3 are mechanical.

### 1. Write the brief

pi runs in a fresh session with **only the text you send** plus what it reads from the working tree —
no memory of this conversation. Everything the task needs goes in the brief: the goal, the current
state, what to change, what to leave untouched, the project's **actual** gate commands (discover them
from the repo's CLAUDE.md/AGENTS.md/Makefile/package.json — do not assume), and a report contract.
Tell pi it will **not** commit (you will). Keep one task per brief. Full guidance and a template:
[references/writing-the-brief.md](references/writing-the-brief.md).

### 2. Dispatch

Send the brief to pi with the bundled helper. It wraps `pi -p --mode json`, captures the run, and
writes a structured `result.json` — so your only job is "run a command, read a file."

`<skill-dir>` below is this skill's installed directory — the folder containing this `SKILL.md`.
Claude Code prints it as "Base directory for this skill" when the skill loads; on other orchestrators
use that same directory (if unsure, run `find ~ -name relay.mjs -path '*delegate-pi*'` and use the
folder above it).

```bash
node "<skill-dir>/scripts/relay.mjs" --cd /path/to/repo <<'DELEGATE_BRIEF'
…your full self-contained brief here…
DELEGATE_BRIEF
# pick a model/provider:                  add --model <name>  and/or  --provider <name>
# continue the previous pi session:       add --session-id <id> --resume   (send only the delta brief)
# see all options:                        node "<skill-dir>/scripts/relay.mjs" --help
```

**Pass the brief on stdin (the heredoc above) — do not write a brief file.** A stdin brief needs no
file write, so it works under any harness's file-permission sandbox (e.g. OpenCode confines edits to
the project directory) and leaves no stray file in the repo. Pick a heredoc delimiter the brief won't
contain. `--brief <file>` still works if your harness allows writing the file somewhere outside the repo.

pi edits the working tree directly and runs its own tools autonomously; the helper writes its
artifacts to a temp dir, so the repo under review stays clean. It **never commits** — see step 5.
Mechanics, flags, and the `result.json` shape: [references/dispatch-and-poll.md](references/dispatch-and-poll.md).

### 3. Wait for completion

The helper blocks until pi finishes, so back it with whatever your orchestrator offers and resume when
it returns:

- **Claude Code:** run the Bash call with `run_in_background: true`; you are notified on completion.
- **Plain shell / other agents:** run it in the foreground for short tasks, or background it and poll
  the result file. The run is done when `result.json` exists with a `status`. (A pre-run usage error —
  bad args or an empty brief — instead exits with code 2 and writes no result file, so check the exit
  code too. A missing `pi` binary exits 127 but *does* write a `result.json` with status
  `target_unavailable`.)

Do not trust progress trackers over reality: a run is finished when `result.json` is written and the
process has exited. Read the working tree, not a status line.

### 4. Review — do not trust the self-report

pi's `result.json` includes its own `finalMessage` summary. **Re-verify, don't accept:**

- **Re-run the project's gates yourself** (the test/lint/build commands from step 1). Never take
  "gates passed" on faith.
- **Read the diff** against the brief: did pi do what was asked, nothing more (scope creep) and nothing
  less? `touchedFiles` in the result is your starting point. If `dirtyBefore` is true, the tree already
  had changes — disentangle them from pi's.
- For schema/migration changes, round-trip them; for removals, grep for dangling references.

Full checklist: [references/review-and-land.md](references/review-and-land.md).

### 5. Land it

Only after the gates pass and the diff holds:

- **Commit the verified work yourself**, with a clear message. The orchestrator commits, never pi.
- If it needs changes, send a delta brief with `--session-id <id> --resume` (don't restate the whole
  task) and review again.

## Non-negotiables

- **Re-run the gates yourself.** The self-report is a claim, not evidence.
- **The orchestrator commits, never pi.** The brief tells pi not to commit; confirm it didn't.
- **One task = one brief = one commit.** Split unrelated work into separate runs.
- **Trust the working tree and process state** over any progress tracker.

## Authorization model

Delegation is something the human opts into. Once they have ("run this", "proceed"), committing
verified, gate-passing work is the agreed contract — that is the point. Two limits on that mandate:
**surface, don't absorb** (report pi's design decisions, defensible-but-unasked turns, and non-blocking
nitpicks rather than silently keeping them) and **stop for scope changes** (if correct completion needs
going beyond the brief, ask — don't expand the mandate yourself). Full treatment in
[references/review-and-land.md](references/review-and-land.md).

## Trust and safety

`scripts/relay.mjs` makes no network calls of its own, reads or writes no credentials, and sends no
telemetry; it has no dependencies (Node built-ins only) and shells out only to `pi` and `git`. The
`pi` process it launches does authenticate — exactly as you do at the terminal. Read the script before
you run it. It is the one executable in this package; everything else is Markdown. It never commits.

## References

- [references/writing-the-brief.md](references/writing-the-brief.md) — how to write a brief pi can
  execute blind: structure, XML blocks, the report contract, embedding the real gate commands.
- [references/dispatch-and-poll.md](references/dispatch-and-poll.md) — `relay.mjs` flags, the
  `result.json` contract, backgrounding per orchestrator, and recovery when a run misbehaves.
- [references/review-and-land.md](references/review-and-land.md) — the review checklist, the commit
  boundary, and the rework cycle via `--session-id --resume`.
- [references/multi-task-queues.md](references/multi-task-queues.md) — running a sequential queue:
  carrying constraints forward, progress tracking, and the end-of-run coherence check.

## What this skill does NOT do

- It does not commit for you — that is deliberate (step 5).
- It does not judge code quality itself — you read the diff and re-run the gates.
- It does not run your tests — you re-run the project's own gates in step 4.
