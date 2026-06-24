# Dispatch and poll

`scripts/relay.mjs` is the dispatch layer. It wraps `pi -p --mode json`, runs the brief, captures the
event stream, and writes a structured `result.json`. Your job collapses to: run one command, then read
one file. Everything pi-specific lives in the helper, which is what keeps the loop portable across
orchestrators.

## Before the first run: check the binary

```bash
pi --version          # confirm pi is installed; the relay records the version it ran into result.json
pi --list-models      # confirm a provider/model is configured and reachable
```

## Dispatching

```bash
# Recommended: pass the brief on stdin (a heredoc). No file is written, so it works under any
# harness's file-permission sandbox (e.g. OpenCode confines edits to the project dir) and leaves
# nothing in the repo. Pick a delimiter the brief won't contain.
node "<skill-dir>/scripts/relay.mjs" --cd /path/to/repo <<'DELEGATE_BRIEF'
…your full self-contained brief here…
DELEGATE_BRIEF

# Alternative (only if your harness permits writing the file outside the repo):
node "<skill-dir>/scripts/relay.mjs" --brief brief.txt --cd /path/to/repo
```

(`<skill-dir>` is wherever this skill is installed — the folder containing its `SKILL.md`. On Claude
Code it's the printed "Base directory for this skill"; on other orchestrators substitute that install
path.)

Options:

| Flag | Effect |
| --- | --- |
| `--brief <file>` | Optional brief file. **Omit it to read the brief from stdin** (recommended — heredoc or pipe; no file write, sandbox-safe). |
| `--cd <dir>` | Working root for pi (default: current directory). pi has no `--cd`; the relay sets the child process's cwd. |
| `--model <name>` | Model override (default: pi's own configured default). |
| `--provider <name>` | Provider override (default: pi's own configured default). |
| `--session-id <id>` | Use/resume this exact session id (default: a fresh UUID, reported back for later resume). |
| `--resume` | Continue an existing session; send only the delta brief. Pair with `--session-id <id>`. |
| `--skip-git-repo-check` | Allow running outside a git repo. |
| `--out-dir <dir>` | Where artifacts go (default: a fresh dir under the system temp dir). |

Artifacts default to the system temp dir on purpose: the repo under review stays clean, so the
touched-files report shows only pi's edits and nothing of the helper's own.

## The result

`<out-dir>/result.json` is the contract. Fields:

- `schema` — the result-format version (currently `delegate-relay.result.v1`)
- `target` — `"pi"`
- `status` — `completed` | `failed` | `target_unavailable`
- `exitCode` — mirrors pi's exit code; `127` if `pi` isn't on PATH
- `targetVersion` — the pi binary that actually ran
- `sessionId` — feed this to a later `--session-id <id> --resume`
- `finalMessage` — pi's own final report (the `<structured_output_contract>` you asked for), extracted
  from pi's last assistant message
- `touchedFiles` — `git status --porcelain` lines in the working root: your review starting point.
  `null` (not `[]`) when git can't report; `[]` means git ran and the tree is clean
- `dirtyBefore` — `true` if the working tree already had uncommitted changes **before** the run, so you
  know `touchedFiles` may include edits that weren't pi's
- `model` / `provider` — what was requested (null = pi's default)
- `briefPath` / `eventsPath` — the exact brief relay sent, and the raw JSONL event stream
- `workdir`, `resume`, `startedAt`, `finishedAt`
- `stderrTail` — last ~20 stderr lines; present **only** on a failed run
- `error` — present **only** if pi failed to launch

The helper also prints a summary to stdout and exits with pi's exit code, so a wrapping script can
branch on success/failure directly.

## Waiting for completion

The helper blocks until pi finishes. Back it with whatever your orchestrator offers:

- **Claude Code:** run the `Bash` call with `run_in_background: true`; you're notified on completion,
  then read `result.json`.
- **Plain shell / other agents:** foreground for short tasks, or background and poll — a run is done
  when `result.json` exists with a `status`. **But** a pre-run usage error (bad args, empty brief, a
  non-git workdir) exits with code 2 *before* writing any file — so check the exit code too, don't only
  watch for the file. (A missing `pi` binary exits 127 but *does* write a `result.json` with status
  `target_unavailable`.)

Trust the working tree and the process state over any progress display. A run is finished when the
process has exited and `result.json` is written — not when a status line says so.

## When a run misbehaves

- **`status: target_unavailable` (exit 127):** `pi` isn't on PATH. Install it and configure a
  provider/model, then re-dispatch.
- **`status: failed`:** read `result.json`'s `stderrTail` and the tail of `eventsPath` for the cause.
  Common causes: an auth/provider lapse, an invalid `--model`/`--provider`, or a task pi couldn't
  complete. Fix the cause and re-dispatch; don't paper over it by doing the work yourself unless that's
  what the user wants.
- **Empty `finalMessage`:** pi exited before producing a final assistant message. Treat as a failed
  run; the events log usually shows where it stopped.

## What the helper is doing (and the alternatives)

Under the hood the helper runs roughly:

```bash
pi -p --mode json --session-id <uuid> [-m model] [--provider p] "<brief text>"   # fresh run
pi -p --mode json --session-id <same-uuid> "<delta brief>"                       # resume (same id)
```

`--mode json` makes pi stream JSONL events; the helper captures them, pulls the session id from the
first `session` event and the final report from the terminal `agent_end` / last assistant message, and
sets the child's cwd to `--cd` (pi has no working-dir flag). The brief is passed as a single argument
(via the OS argv array, not a shell string), so even a long multi-line brief needs no escaping.

Raw `pi -p --mode json …` works for one-offs too; you just give up the captured `result.json`,
touched-files summary, and session-id extraction the helper does for you.

## The commit boundary

The helper never commits — by design, not omission. pi edits the working tree; the orchestrator reviews
and commits. See [review-and-land.md](review-and-land.md).
