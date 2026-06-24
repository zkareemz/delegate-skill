# Spec 001 — git-optional + scripted (deterministic) checks

Status: **proposed** (not yet implemented). Target version: relay v0.2 / `result.schema v2`.

## Why

Two corrections from real use of `delegate-pi`:

1. **git must not be required.** The skill should work identically with or without a git repo. The
   current relay *refuses* a non-git dir unless `--skip-git-repo-check` is passed, and its
   change-review depends on `git status`/`git diff`. That makes git a hard dependency. It shouldn't be.
2. **Deterministic checks belong in the script, not the agent.** In the first live run the agent
   re-ran `pi --version`, `ls`'d the tree, and hex-dumped a file to figure out what changed — all
   deterministic work an LLM shouldn't be spending tokens/latency on, and which a script does more
   reliably (a script can't hallucinate "tests passed"). Push these into `relay.mjs`; leave the agent
   only the judgment.

## Principles

- **git is an optional enhancement, never a requirement.** No code path may fail because git is absent.
- **Deterministic → script. Judgment → agent.** The relay observes and reports facts; the agent decides
  what they mean.
- **Keep the relay auditable.** It stays observational by default. Anything that *executes* project
  commands (gates) is explicit and opt-in, not silent.

## Split of responsibilities (target state)

| Work | Owner after this change |
| --- | --- |
| target availability/version | relay (already) — agent must stop re-checking |
| **which files changed** (added/modified/deleted) | **relay, git-free** (tree snapshot before/after) |
| a reviewable **diff** | relay: `git diff` when git present; opt-in content-snapshot diff otherwise |
| **running the gates** (test/lint/build) | relay, **opt-in** via `--gates` (agent supplies the command) |
| writing the brief | agent (judgment) |
| judging the diff *against the brief* | agent (judgment) |
| choosing which gates are the real ones | agent (judgment) |
| deciding to land + commit message | agent (judgment; git only) |

## Changes

### A. Relay: stop requiring git
- `src/engine/index.ts`: **remove** the `isGitRepo` guard that calls `fail(...)`. The relay runs
  regardless of vcs.
- **Remove `--skip-git-repo-check`** (no longer meaningful). Decision D3 below.
- Record `vcs: "git" | "none"` in the result so the agent knows whether a diff/commit is even possible.

### B. Relay: git-free change detection (the core new capability)
- New `src/engine/snapshot.ts`:
  - `snapshotTree(cwd, ignore): Map<relPath, {size, mtimeMs}>` — recursive walk. `mtime` change alone
    reliably flags a modified file (any write bumps mtime), so size+mtime is enough for the file list;
    no hashing needed for detection.
  - `diffSnapshots(before, after): { added: string[]; modified: string[]; deleted: string[] }`.
  - Default ignore set: `.git`, `node_modules`, `.DS_Store` (Decision D4).
- `src/engine/run.ts` / `index.ts`: snapshot **before** spawning the target and **after** it exits;
  compute `changes` from the snapshots. This is the authoritative changed-file list, git or not.
- **Source of `changes`:** when git is present, derive it from `git status --porcelain` (respects
  `.gitignore`/renames); when git is absent, derive it from the snapshot diff. Either way it populates
  the same `changes` field — the snapshot is what makes git optional. (When git is present, the
  before/after content snapshot can be skipped.)

### C. Relay: diff artifact
- `src/engine/git.ts`: add `gitDiff(cwd): string | null`.
- After the run, write a unified diff to `<out-dir>/diff.patch` and put its path in `result.diffPath`:
  - git present → `git diff` (working tree).
  - git absent → **automatically** snapshot file *contents* before the run (per-file cap ≤ 1 MB + a
    total budget) and produce a git-free unified diff for changed files. If the budget is exceeded,
    `diffPath` is `null`, the result notes the fallback, and the agent reviews `changes` + the files
    directly. No flag — it's automatic whenever git is absent.

### D. Relay: opt-in gates execution
- Add `--gates "<command>"` (a shell command string; the agent supplies it after discovering the real
  gates). New `src/engine/gates.ts`: `runGates(command, cwd) → { command, exitCode, passed, outputTail }`.
- Run it in `--cd` *after* the target finishes; record under `result.gates` (or `null` if not passed).
- This executes project commands — same trust level as the target editing files — so it is explicit and
  opt-in, never automatic.

### E. result.json — bump to `delegate-relay.result.v2`
```jsonc
{
  "schema": "delegate-relay.result.v2",
  "target": "pi",
  "status": "completed | failed | target_unavailable",
  "exitCode": 0,
  "targetVersion": "0.79.8",
  "workdir": "/abs/path",
  "model": null, "provider": null,
  "sessionId": "…", "resume": false,
  "vcs": "git | none",                 // NEW
  "changes": {                         // NEW — git-free, always populated; replaces touchedFiles
    "added": [], "modified": [], "deleted": []
  },
  "changedCount": 0,                    // NEW — convenience
  "diffPath": "/tmp/…/diff.patch",      // NEW — null when unavailable
  "gates": null,                        // NEW — {command,exitCode,passed,outputTail} when --gates given
  "finalMessage": "…",
  "briefPath": "…", "eventsPath": "…",
  "startedAt": "…", "finishedAt": "…",
  "stderrTail": ["…"],                  // failed runs only
  "error": "…"                          // launch failure only
}
```
Removed: `touchedFiles` (→ `changes`), `dirtyBefore` (a git-only notion; the agent infers pre-existing
state from `changes` and `vcs`). Update `src/engine/types.ts` (`RelayResult`, `RelayOptions` += `gates`)
and `src/engine/result.ts` (writer + the stdout summary). (No `snapshotContents` option — content
snapshotting is automatic when git is absent, per D1.)

### F. SKILL.md + references
- Drop "you must be in a git repo" from prerequisites; state the skill works anywhere, and that **git
  adds two things when present: a `diff.patch` and the option to commit (land)**.
- Reframe **step 4 (review)** around `result.json`: read `changes`, `diffPath`, and `gates` — **do not
  re-run `pi --version`, do not `ls`/hexdump to discover changes.** Judge `changes`/diff against the brief.
- Reframe **step 5 (land)** as git-only and optional: with git, commit the verified work; without git,
  "land" is just confirming the changes are what you wanted — there's nothing to commit.
- Remove all `--skip-git-repo-check` mentions; document `--gates`. Note that without git the agent
  still gets a `diff.patch` automatically (no flag needed).
- Files: `skills/delegate-pi/SKILL.md`, `references/dispatch-and-poll.md` (flags table + result fields),
  `references/review-and-land.md` (git-optional review/land), `references/writing-the-brief.md`
  (unchanged except wording).

### G. Dev scripts
- `scripts/smoke.mjs`: the `non-git workdir exits 2` check is now **wrong** — non-git must be accepted.
  Replace it with a check that a non-git run is *not* rejected at the arg stage (e.g. assert the
  git-guard error message no longer appears). Keep the other exit-2 plumbing checks (empty brief,
  missing file, unknown flag, `--help`).
- `scripts/check-sync.mjs`: unchanged (still diffs the committed `relay.mjs`).

### H. takeoff.md
- Note v2: git-optional, snapshot-based `changes`, `diffPath`, opt-in `--gates`/`--snapshot-contents`,
  `result.schema v2`. Update the `result.json` contract summary and the Adapter notes (adapters are
  unchanged — this is all engine-level).

## Decisions (chosen)

- **D1 — git-free line diffs:** **automatic when git is absent** (no flag). git present → diff from
  `git diff` (no snapshot cost). git absent → capture before-contents (per-file cap ≤ 1 MB + a total
  budget) and emit a git-free `diff.patch`; if the budget is exceeded, fall back to the `changes` list
  only and say so. *Rationale: the goal is to work well without git — a bare file list is a weaker
  review than git users get, so give no-git users a real diff by default, with the budget as the safety
  valve.*
- **D2 — gates in the relay:** **opt-in flag**, not automatic. *Keeps the core relay observational and
  auditable; determinism is still gained when the agent uses it.*
- **D3 — `--skip-git-repo-check`:** **remove** it (meaningless once git isn't enforced).
- **D4 — change source + ignore set:** when git is present, take `changes`/`diffPath` from git
  (`git status`/`git diff`) — it respects `.gitignore` and renames for free. When git is absent, use the
  snapshot with a hardcoded ignore set (`.git`, `node_modules`, `.DS_Store`). Honoring `.gitignore`
  without git, and a `--ignore <glob>` flag, are deferred.

## Implementation checklist (ordered)

1. `src/engine/snapshot.ts` — `snapshotTree` + `diffSnapshots` + automatic content capture (D1, used
   when git is absent), with the per-file cap and total budget.
2. `src/engine/git.ts` — add `gitDiff`.
3. `src/engine/gates.ts` — `runGates`.
4. `src/engine/types.ts` — v2 `RelayResult`, `RelayOptions` (`gates`), `vcs`.
5. `src/engine/index.ts` — remove git guard + `--skip-git-repo-check`; parse `--gates`; take the
   before-snapshot only when git is absent.
6. `src/engine/run.ts` — after-snapshot, compute `changes`, write `diff.patch`, run gates, v2 result.
7. `src/engine/result.ts` — v2 writer + summary.
8. SKILL.md + 3 references reworded (Section F).
9. `scripts/smoke.mjs` updated (Section G).
10. `npm run build` (regenerate committed `relay.mjs`) + update `takeoff.md`.

## Verification

- `npm run typecheck && npm run build && npm run check-sync && npm run smoke` all green.
- **Non-git run:** in a fresh non-git temp dir, dispatch a real pi brief → `vcs: "none"`, `changes`
  correctly lists the new file, exit 0, **no** git-guard failure.
- **git run:** in a temp git repo → `vcs: "git"`, `changes` matches, `diff.patch` written and non-empty.
- **Gates:** pass `--gates "false"` → `gates.passed === false`, `exitCode` captured; `--gates "true"` →
  `passed === true`.
- **Non-git diff (automatic):** in a non-git temp dir, a real run produces a non-empty `diff.patch`
  showing the changed lines (no flag passed).
