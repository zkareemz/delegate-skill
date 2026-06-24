# takeoff.md — handoff for adding new delegate targets

Read this first when resuming work on this repo (e.g. "implement delegate-codex"). It tells you what
exists, how it's built, the contract a new target must satisfy, and the exact steps to add one.

---

## 1. What this repo is

`delegate-skill` is a [Skills CLI](https://github.com/vercel-labs/skills) package. Each skill lets an
**orchestrator** (the agent you're talking to, e.g. Claude Code) hand a bounded coding task to an
**implementer** CLI (the "target"), wait for it, then **review the diff and commit it yourself**
("review-then-land"). The point is to keep the orchestrator's session clean: the target's verbose work
happens in a subprocess and only a compact `result.json` + the git diff come back.

**v1 ships one target: `delegate-pi`** (the `pi` CLI). The engine is built around a small adapter seam,
so a new target = one adapter + one `SKILL.md` (+ references), with no engine rewrite.

> ⚠️ **Two repos exist — don't conflate them.** This is `zkareemz/delegate-skill` (clean v1). The user
> also has `zkareemz/skills`, an older/richer parallel project (skill `pi-delegate`, script
> `pidelegate.cjs`, modules `supervisor`/`store`/`worktree`/`verify`, vitest). They are not reconciled.

---

## 2. Architecture (what's implemented)

```
src/
  engine/                  TARGET-AGNOSTIC. Never needs target-specific changes.
    types.ts               Adapter interface (the seam) + RelayOptions + RelayResult
    index.ts               entry: arg parse, git guard, version check, orchestrate, exit codes, --help
    run.ts                 spawn target, capture stdout (events) + stderr, block, write result, exit
    result.ts              result.json writer + stdout summary
    git.ts                 isGitRepo() + gitTouchedFiles() (porcelain; null when git can't report)
  adapters/
    pi.ts                  THE only target so far — implements Adapter for `pi`
skills/
  delegate-pi/             BUILT + COMMITTED — this is what `npx skills add` copies (CLI runs no build)
    SKILL.md               frontmatter (name MUST equal dir) + the loop + non-negotiables
    scripts/relay.mjs      tsup output of src/ (single file, zero deps, shebang) — DO NOT edit by hand
    references/*.md        writing-the-brief, dispatch-and-poll, review-and-land, multi-task-queues
scripts/check-sync.mjs     rebuild to temp + diff vs committed relay.mjs (fails on drift)
scripts/smoke.mjs          plumbing checks for the built relay (no model calls)
tsup.config.ts             bundles src/engine/index.ts -> skills/delegate-pi/scripts/relay.mjs
skills.sh.json             skills.sh display metadata (lists the skills)
```

**Flow:** `node relay.mjs --brief b.txt --cd /repo` → spawns the target → target edits the working tree
autonomously → relay writes `result.json` to a temp dir → orchestrator reads it, reviews the diff,
re-runs the project's gates, and **commits**. The relay **never commits**.

**`result.json` contract** (`schema: delegate-relay.result.v1`): `target`, `status`
(`completed|failed|target_unavailable`), `exitCode`, `targetVersion`, `sessionId`, `finalMessage`,
`touchedFiles` (porcelain lines; `null` if git unavailable), `dirtyBefore`, `model`, `provider`,
`briefPath`, `eventsPath`, `startedAt`, `finishedAt`, plus `stderrTail`/`error` on failure. Exit codes:
usage error `2` (no file written), target missing `127` (writes `target_unavailable`), else the
target's own code.

**Verified for pi:** real run (file created, left uncommitted), resume/rework, all error/exit paths,
single-file zero-dep build, check-sync, and Skills CLI discovery (local + public GitHub clone).
NOT yet proven: the live in-Claude-Code skill trigger end-to-end.

---

## 3. The Adapter contract (the seam)

A target supplies exactly this (`src/engine/types.ts`). Everything else is the engine.

```ts
interface Adapter {
  name: string;                              // binary name, e.g. "codex"
  versionArgv: string[];                     // e.g. ["--version"]
  sendBrief: "argv" | "stdin";               // how the brief reaches the CLI
  buildArgv(ctx: RunContext): string[];      // fresh dispatch (WITHOUT the brief payload)
  buildResumeArgv(ctx: RunContext): string[];// continue a session (WITHOUT the delta brief)
  parseFinalMessage(events: string): string; // pull the target's final report from captured stdout
  parseSessionId(events: string): string | null; // pull a resumable id from captured stdout
}
```

How **pi** implements it (your worked example): `sendBrief: "argv"` (brief is the last positional);
`buildArgv` = `pi -p --mode json --session-id <ctx.sessionId> [-m model] [--provider p]`; resume reuses
the same `--session-id`; `parseSessionId` reads the first `{"type":"session","id":...}` JSONL event;
`parseFinalMessage` joins the `text` parts of the last assistant message from the terminal `agent_end`
(or last `turn_end`) event, dropping `thinking`.

**The seam already accommodates very different targets** — that's the design's whole point:
- `sendBrief: "stdin"` (codex reads the prompt from stdin via a trailing `-`).
- A target that assigns its OWN session id (codex's `thread_id`): `buildArgv` ignores `ctx.sessionId`,
  `parseSessionId` extracts the real id from events, and the engine overrides `result.sessionId` with it
  (the generated UUID is a harmless fallback).
- A different resume verb (codex uses `exec resume`), handled in `buildResumeArgv`.

---

## 4. Playbook: add `delegate-codex`

Reference implementation to crib from: **github.com/amElnagdy/delegate-skills** →
`skills/codex-delegate/` (its `SKILL.md`, 4 references, and `scripts/relay.mjs`). Codex's exact flags
live there; re-read that `relay.mjs` before writing the adapter.

### Step 0 — read
This file, `src/engine/types.ts`, `src/adapters/pi.ts`, and the codex-delegate reference above.

### Step 1 — smoke-test the real `codex` CLI (the one true unknown each time)
Confirm flags + the `--json` event shape + where the final message lives, exactly like we did for pi.
```bash
command -v codex && codex --version
# capture the event stream from a trivial, side-effect-free run:
d=$(mktemp -d); ( cd "$d" && git init -q && \
  printf 'Create FOO.txt containing exactly: bar . No other files. Do not commit.' \
  | codex exec --json -s workspace-write - ) | tee /tmp/codex-events.jsonl
# then inspect: which event type carries the final agent message? where's thread_id?
```
Decide `parseFinalMessage`: prefer pulling the final agent message from the `--json` events (keeps the
engine unchanged, like pi). Only if that's unreliable, fall back to codex's `-o <file>` — which needs a
small engine extension (an adapter-declared output file passed to `parseFinalMessage`).

### Step 2 — generalize the build from 1 target to N (one-time)
Currently the engine hardcodes pi and tsup builds one relay. Do this refactor once:
1. `src/engine/index.ts`: change the bottom from `main()` to `export function main(adapter: Adapter)`,
   remove the hardcoded `piAdapter` import and the module-level `main()` call. (HELP already uses
   `adapter.name`.)
2. Add thin per-skill entry points:
   - `src/entries/delegate-pi.ts`: `import { main } from "../engine"; import { piAdapter } from "../adapters/pi"; main(piAdapter);`
   - `src/entries/delegate-codex.ts`: same with `codexAdapter`.
3. `tsup.config.ts`: switch to `outDir: "skills"` and per-skill entries whose keys carry the path:
   ```ts
   entry: {
     "delegate-pi/scripts/relay": "src/entries/delegate-pi.ts",
     "delegate-codex/scripts/relay": "src/entries/codex.ts",
   }
   ```
   (Output lands at `skills/<name>/scripts/relay.mjs`. Keep `clean: false`.)
4. `scripts/check-sync.mjs`: build to a temp `outDir` and diff **every** `skills/*/scripts/relay.mjs`,
   not just delegate-pi.
5. (Only if codex needs a sandbox flag) add an optional `sandbox?: string` to `RelayOptions` + a
   `--sandbox`/`--read-only` flag in `index.ts`; pi ignores it, codex uses it.

### Step 3 — write `src/adapters/codex.ts`
Implement `Adapter`. Likely shape (verify against Step 1):
`name: "codex"`, `versionArgv: ["--version"]`, `sendBrief: "stdin"`;
`buildArgv` ≈ `["exec","--json","-s",sandbox, ...(model?["-m",model]:[]), "-"]`;
`buildResumeArgv` ≈ `["exec","resume","--last","--json","-"]` (no `-s`/`-m`; inherits session);
`parseSessionId` = extract `thread_id`/`threadId` from events; `parseFinalMessage` = final agent
message from events. Remember `shell:true` on Windows is already handled by the engine.

### Step 4 — write `skills/delegate-codex/`
Copy `skills/delegate-pi/SKILL.md` + the 4 references; swap pi→codex specifics (flags, prerequisites:
`codex` installed + `codex login`; `--session-id --resume` → codex's resume; result fields are the
same). Set frontmatter `name: delegate-codex` (MUST equal the dir).

### Step 5 — build + verify
```bash
npm run typecheck && npm run build && npm run check-sync && npm run smoke
# real end-to-end against codex in a throwaway git repo (see Step 1 pattern), assert result.json
```

### Step 6 — register + ship
Add `"delegate-codex"` to `skills.sh.json` groupings. Then commit + push:
```bash
git add -A && git commit -m "Add delegate-codex" && git push
```

---

## 5. Commands cheat-sheet
```bash
npm install                 # dev deps (tsup, typescript) — only for building; end users don't need this
npm run typecheck           # tsc --noEmit
npm run build               # tsup -> committed relay.mjs(s)
npm run check-sync          # fail if committed relay.mjs drifted from src/
npm run smoke               # plumbing checks (no model calls)
npx skills@latest add . --list                          # validate package layout locally
npx skills@latest add zkareemz/delegate-skill --list    # validate the published path
```

## 6. Gotchas
- The compiled `skills/*/scripts/relay.mjs` is **committed** (the Skills CLI runs no build). After any
  `src/` change: `npm run build` and commit the regenerated file. `check-sync` enforces this.
- Edit TypeScript in `src/`, never the bundled `relay.mjs`.
- Keep `relay.mjs` zero-dependency (Node built-ins only) and never let it commit — it's the trust story.
- The repo is **public**. No secrets in commits.
- Each adapter's flags must match the **installed** target binary; re-smoke-test on version bumps.
- Env note seen during pi work: the user's `pi` default provider resolved to `deepseek/deepseek-v4-pro`,
  not `google` — adapters pin nothing, they pass `--model`/`--provider` through.
