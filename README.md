# delegate-skill

Skills for **delegating coding work to a separate CLI agent and landing it yourself**. Your agent (the
**orchestrator**) writes a self-contained brief, hands it to an **implementer** CLI, then reviews the
diff and commits — staying the reviewer the whole way.

Two skills ship today: **`delegate-pi`** drives the [`pi`](https://www.npmjs.com/package/pi) CLI, and
**`delegate-opencode`** drives the [`opencode`](https://opencode.ai) CLI. They share one engine; each is
a thin target adapter.

## Install

Install with the [Skills CLI](https://github.com/vercel-labs/skills) — it copies the skill into your
agent's skills directory (`~/.claude/skills/`, etc.):

```bash
# browse first
npx skills@latest add zkareemz/delegate-skill --list

# install (all skills, or just one)
npx skills@latest add zkareemz/delegate-skill
npx skills@latest add zkareemz/delegate-skill --skill delegate-pi
npx skills@latest add zkareemz/delegate-skill --skill delegate-opencode

# target a specific agent, or install globally
npx skills@latest add zkareemz/delegate-skill --agent claude-code
npx skills@latest add zkareemz/delegate-skill --global
```

Works with any orchestrating agent the Skills CLI supports. Verified on Claude Code.

## What it does

The loop is the same for every target (shown for `delegate-pi`; `delegate-opencode` is identical with
`opencode run --format json`):

1. **Write a brief** — a self-contained task spec; the implementer sees only what you send.
2. **Dispatch** it with the bundled `relay.mjs` (a thin `pi -p --mode json` wrapper).
3. **Wait** for completion — the helper writes a structured `result.json`.
4. **Review** the diff — re-run the project's gates yourself.
5. **Land** it — *you* commit, after review. The relay never commits.

```text
Have pi implement the refactor in services/billing/, then review and commit it.
Run this queue of migration tasks through opencode while I review each one.
```

Because the implementer runs in a separate process and only a compact result comes back, your
orchestrator's session stays focused — the implementer's verbose reasoning never enters your context.

## Requirements

- The target CLI installed and authenticated: `pi` (a provider/model configured; check
  `pi --list-models`) for `delegate-pi`, or `opencode` (`opencode auth login`) for `delegate-opencode`.
- Node 18+ and `git`.
- An orchestrating agent that can run shell commands and read files.
- Shell examples assume bash/zsh (macOS/Linux, or Git Bash/WSL on Windows).

## Trust and validation

This package is intentionally inspectable:

- All skill content is Markdown, plus exactly **one** executable per skill:
  `skills/<skill>/scripts/relay.mjs` (the same engine, one per target).
- `relay.mjs` makes no network calls of its own, reads or writes no credentials, sends no telemetry, and
  has no dependencies (Node built-ins only). It shells out only to the target CLI (`pi` / `opencode`)
  and `git`. The target process it launches authenticates exactly as you do at the terminal. Read the
  script before you run it.
- It never commits — committing is always the orchestrator's job, after review.

`relay.mjs` is compiled from the TypeScript in `src/` (see below) and committed so the Skills CLI, which
copies files as-is, can install it without a build step.

## Repository shape

```text
src/                       TypeScript source of truth
├── engine/                target-agnostic relay (shared by every skill)
├── adapters/<name>.ts     one small adapter per target (pi, opencode)
└── entries/<skill>.ts     thin entry: pick an adapter, run the engine
skills/
├── delegate-pi/           built + committed; this is what the Skills CLI installs
│   ├── SKILL.md
│   ├── scripts/relay.mjs  compiled from src/ (single file, zero dependencies)
│   └── references/        loaded only when a task needs them
└── delegate-opencode/     same shape, opencode target
```

The `SKILL.md` stays small so it loads cheaply; the references load only when the task needs them.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # tsup: src/ -> skills/*/scripts/relay.mjs
npm run smoke         # plumbing checks (no model calls)
npm run check-sync    # fail if any committed relay.mjs has drifted from src/
```

After changing anything in `src/`, run `npm run build` and commit the regenerated
`skills/*/scripts/relay.mjs`. `npm run check-sync` enforces that they stay in sync.

## Roadmap

`delegate-pi` and `delegate-opencode` ship today. The engine is built around a small adapter seam, so
sibling skills — `delegate-codex`, `delegate-claude`, `delegate-cursor` — are each mostly a new
`SKILL.md` plus a short adapter, with no engine changes.

## License

MIT — see [LICENSE](LICENSE).
