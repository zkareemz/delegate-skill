# Dispatch and poll

`scripts/relay.mjs` is the dispatch layer. It wraps `opencode run --format json`, runs the brief,
captures the event stream, and writes a structured `result.json`. Your job collapses to: run one
command, then read one file. Everything opencode-specific lives in the helper, which is what keeps the
loop portable across orchestrators.

## Before the first run: check the binary

```bash
opencode --version   # confirm opencode is installed; the relay records the version it ran into result.json
opencode auth list   # confirm a provider is configured and authenticated
opencode models      # (optional) list usable provider/model ids
```

## Dispatching

```bash
# Recommended: pass the brief on stdin (a heredoc). No file is written, so it works under any
# harness's file-permission sandbox and leaves nothing in the repo. Pick a delimiter the brief
# won't contain.
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
| `--cd <dir>` | Working root for opencode (default: current directory). The relay sets the child process's cwd to it. |
| `--model <name>` | Model override in opencode's `provider/model` form (e.g. `anthropic/claude-sonnet-4-6`). Default: opencode's own configured default. |
| `--provider <name>` | Provider prefix. If you pass a bare `--model` (no slash), the relay joins them as `provider/model`; an already-qualified `--model` wins. |
| `--session-id <id>` | Resume this exact opencode session id (the `ses_…` from a previous run's `result.json`). Pair with `--resume`. |
| `--resume` | Continue an existing session; send only the delta brief. |
| `--skip-git-repo-check` | Allow running outside a git repo. |
| `--out-dir <dir>` | Where artifacts go (default: a fresh dir under the system temp dir). |

Artifacts default to the system temp dir on purpose: the repo under review stays clean, so the
touched-files report shows only opencode's edits and nothing of the helper's own.

## The result

`<out-dir>/result.json` is the contract. Fields:

- `schema` — the result-format version (currently `delegate-relay.result.v1`)
- `target` — `"opencode"`
- `status` — `completed` | `failed` | `target_unavailable`
- `exitCode` — mirrors opencode's exit code; `127` if `opencode` isn't on PATH
- `targetVersion` — the opencode binary that actually ran
- `sessionId` — the `ses_…` id opencode minted for this run; feed it to a later `--session-id <id> --resume`
- `finalMessage` — opencode's own final report (the `<structured_output_contract>` you asked for),
  extracted from opencode's last assistant message
- `touchedFiles` — `git status --porcelain` lines in the working root: your review starting point.
  `null` (not `[]`) when git can't report; `[]` means git ran and the tree is clean
- `dirtyBefore` — `true` if the working tree already had uncommitted changes **before** the run, so you
  know `touchedFiles` may include edits that weren't opencode's
- `model` / `provider` — what was requested (null = opencode's default)
- `briefPath` / `eventsPath` — the exact brief relay sent, and the raw JSON event stream
- `workdir`, `resume`, `startedAt`, `finishedAt`
- `stderrTail` — last ~20 stderr lines; present **only** on a failed run
- `error` — present **only** if opencode failed to launch

The helper also prints a summary to stdout and exits with opencode's exit code, so a wrapping script can
branch on success/failure directly.

## Waiting for completion

The helper blocks until opencode finishes. Back it with whatever your orchestrator offers:

- **Claude Code:** run the `Bash` call with `run_in_background: true`; you're notified on completion,
  then read `result.json`.
- **Plain shell / other agents:** foreground for short tasks, or background and poll — a run is done
  when `result.json` exists with a `status`. **But** a pre-run usage error (bad args, empty brief, a
  non-git workdir) exits with code 2 *before* writing any file — so check the exit code too, don't only
  watch for the file. (A missing `opencode` binary exits 127 but *does* write a `result.json` with
  status `target_unavailable`.)

Trust the working tree and the process state over any progress display. A run is finished when the
process has exited and `result.json` is written — not when a status line says so.

## When a run misbehaves

- **`status: target_unavailable` (exit 127):** `opencode` isn't on PATH. Install it and run
  `opencode auth login`, then re-dispatch.
- **`status: failed`:** read `result.json`'s `stderrTail` and the tail of `eventsPath` for the cause.
  Common causes: an auth/provider lapse, an invalid `--model`, or a task opencode couldn't complete. Fix
  the cause and re-dispatch; don't paper over it by doing the work yourself unless that's what the user
  wants.
- **Empty `finalMessage`:** opencode exited before producing a final assistant message. Treat as a
  failed run; the events log usually shows where it stopped.

## What the helper is doing (and the alternatives)

Under the hood the helper runs roughly:

```bash
opencode run --format json [-m provider/model] "<brief text>"        # fresh run (opencode mints a ses_… id)
opencode run --format json --session <ses_id> "<delta brief>"        # resume that session
```

`--format json` makes opencode stream one JSON event per line; the helper captures them, reads the
session id from the events' `sessionID` field and the final report from the last assistant message's
`text` parts, and sets the child's cwd to `--cd`. opencode mints its own session id, so unlike a target
you can pre-assign, the resume id is whatever opencode reported back in `result.json`'s `sessionId`. The
brief is passed as a single argument (via the OS argv array, not a shell string), so even a long
multi-line brief needs no escaping.

Raw `opencode run --format json …` works for one-offs too; you just give up the captured `result.json`,
touched-files summary, and session-id extraction the helper does for you.

## The commit boundary

The helper never commits — by design, not omission. opencode edits the working tree; the orchestrator
reviews and commits. See [review-and-land.md](review-and-land.md).
