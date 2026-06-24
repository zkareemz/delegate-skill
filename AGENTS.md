# Working on delegate-skill

This repo is a [Skills CLI](https://github.com/vercel-labs/skills) package of **delegation skills** —
skills that let an orchestrating agent drive a separate CLI coding agent as an implementer, then review
and land the result. Two skills ship today — `delegate-pi` (the `pi` CLI) and `delegate-opencode` (the
`opencode` CLI); siblings like `delegate-codex` can be added later without renaming the repo.

## Architecture

- **TypeScript source of truth lives in `src/`.** `src/engine/` is target-agnostic (arg parsing, spawn
  + capture, blocking, `result.json`, git status, exit codes). `src/adapters/<name>.ts` is the only
  target-specific code — it implements the `Adapter` interface in `src/engine/types.ts`.
- **The skill is built + committed under `skills/<name>/`.** The Skills CLI copies skill folders
  **as-is and never runs a build**, so the compiled `relay.mjs` is committed there. `npm run check-sync`
  fails if the committed artifact has drifted from `src/`.
- **Adding a target = one adapter + one `SKILL.md` + references.** The engine does not change. Design the
  adapter seam against several CLIs before freezing it; implement one at a time.

## Vocabulary

One controlled vocabulary keeps the docs from drifting and stops edits (human or AI) from coining new
jargon. Use these terms; don't invent synonyms.

| Use | For | Not |
| --- | --- | --- |
| **delegate** / **delegation** | the activity, and this skill family | "relay" (as the activity), "hand-off", "offload" |
| **orchestrator** | the driving agent (Claude Code, OpenCode, …) | "controller", "driver" |
| **implementer** | the worker agent (pi) | "worker", "sub-agent", "executor" |
| **target** | the implementer CLI a skill drives, and the engine's adapter for it | — |
| **brief** | the self-contained task spec sent to the implementer | "task file", "the prompt", "the spec" |
| **gates** | the project's test/lint/build commands | "checks", "CI" |
| **dispatch** | sending the brief to the implementer | "fire off", "kick off" |
| **land** | commit the verified work yourself | — |
| **relay** / `relay.mjs` | the dispatch **script** only | never a *category* of skills |

Each target's own terms — pi's (`--mode json`, `--session-id`, `session`/`agent_end` events),
opencode's (`run --format json`, `--session`, `sessionID`/`text` events) — use verbatim; don't
paraphrase them.

Banned on sight: coined umbrella terms in user-facing surfaces (README headings, `skills.sh.json`
titles); any reference to the author's local machine or config; model/version pins where a
version-neutral phrasing works; and claims that can't be verified ("verified" without a run → hedge or
cut). Every CLI flag, field, and command in the docs must match the installed target (`pi` /
`opencode`) and `relay.mjs`.

## Conventions

- **One skill per directory** under `skills/<name>/`, each with a `SKILL.md` plus optional `references/`
  and `scripts/`. The verb is the repo (`delegate`); the target agent is the skill name (`delegate-pi`).
- **`SKILL.md` frontmatter:** `name` (must equal the directory), `description`, and optionally `license`,
  `compatibility`, `metadata.version`. The **`description` is the only triggering signal** — keep it to
  what the skill does and when to use it, phrased to trigger reliably. Keep it **under 1024 characters**.
- **Progressive disclosure:** keep `SKILL.md` lean; push depth into `references/*.md` that load only when
  needed.
- **Executables:** keep them minimal and inspectable. The only ones are the compiled
  `skills/*/scripts/relay.mjs` (one per target, same engine) — Node built-ins only, no dependencies, no
  network calls of their own, no credentials, no telemetry, and they never commit. Edit the TypeScript
  in `src/`, never the compiled `relay.mjs` directly.

## Before publishing a change

- `npm run typecheck && npm run build && npm run check-sync && npm run smoke`.
- Validate the package layout: `npx skills@latest add . --list`.
- If you touched the relay, smoke-test a real target run (`pi` / `opencode`) against a throwaway git repo before relying on it.
- Keep the README's trust section honest — claim only what's been run.

## Local Claude Code config

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. To use this file while working here in Claude Code,
symlink it: `ln -s AGENTS.md CLAUDE.md` (it's gitignored, or add it to `.gitignore`).
