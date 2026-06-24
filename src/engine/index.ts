/**
 * delegate-skill · relay (entry point)
 *
 * Dispatch a self-contained brief to a CLI implementer, capture the run, and
 * write a structured result.json the orchestrating agent reviews. v1 ships one
 * target — the `pi` CLI — wired through the target-agnostic engine.
 *
 * Trust posture: this script makes no network calls of its own, reads or writes
 * no credentials, sends no telemetry, and has no runtime dependencies (Node
 * built-ins only). It shells out only to the target (`pi`) and `git`. The target
 * it launches authenticates exactly as you do at the terminal. It deliberately
 * does NOT commit — committing is the orchestrator's job, after review.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Adapter, RelayOptions, RunContext } from "./types";
import { isGitRepo, gitTouchedFiles } from "./git";
import { makeResultWriter, printSummary } from "./result";
import { dispatch } from "./run";

// The engine is target-agnostic: a thin per-skill entry point picks the adapter and calls
// main(adapter). Adding a target is one adapter + one entry, with no change in here.
function helpText(adapter: Adapter): string {
  return `delegate-skill relay — dispatch a brief to the ${adapter.name} CLI and capture the run.

Usage:
  node relay.mjs --brief <file> [options]
  cat brief.txt | node relay.mjs [options]

Options:
  --brief <file>          Path to the brief. If omitted, the brief is read from stdin.
  --cd <dir>              Working root for the target (default: current directory).
  --model <name>          Model override (default: the target's own configured default).
  --provider <name>       Provider override (default: the target's own configured default).
  --session-id <id>       Use/resume this exact session id (default: a fresh UUID).
  --resume                Continue an existing session; send only the delta brief.
                          Pair with --session-id <id> from a previous run.
  --skip-git-repo-check   Allow running outside a git repository.
  --out-dir <dir>         Where run artifacts go (default: a fresh dir under the system temp dir).
  -h, --help              Show this help.

Result: <out-dir>/result.json plus a summary on stdout. Exit codes: usage error 2
(no file written), target missing 127 (writes result with status target_unavailable),
otherwise the target's own exit code.
`;
}

function fail(message: string, code = 2): never {
  process.stderr.write(`relay: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[], help: string): RelayOptions {
  const opts: RelayOptions = {
    brief: null,
    cd: process.cwd(),
    model: null,
    provider: null,
    sessionId: null,
    resume: false,
    skipGitRepoCheck: false,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(help);
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      case "--brief":
        opts.brief = next();
        break;
      case "--cd":
        opts.cd = resolve(next());
        break;
      case "--model":
        opts.model = next();
        break;
      case "--provider":
        opts.provider = next();
        break;
      case "--session-id":
        opts.sessionId = next();
        break;
      case "--resume":
        opts.resume = true;
        break;
      case "--skip-git-repo-check":
        opts.skipGitRepoCheck = true;
        break;
      case "--out-dir":
        opts.outDir = resolve(next());
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function readBrief(opts: RelayOptions): string {
  if (opts.brief) {
    if (!existsSync(opts.brief)) fail(`brief file not found: ${opts.brief}`);
    return readFileSync(opts.brief, "utf8");
  }
  try {
    return readFileSync(0, "utf8"); // stdin
  } catch {
    return "";
  }
}

function targetVersion(adapter: Adapter): string | null {
  try {
    return execFileSync(adapter.name, adapter.versionArgv, {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return null;
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function prepareRunDir(opts: RelayOptions, briefText: string, sessionId: string): RunContext {
  const outDir =
    opts.outDir ||
    join(tmpdir(), "delegate-relay", `${basename(opts.cd) || "repo"}-${timestamp()}`);
  mkdirSync(outDir, { recursive: true });
  const ctx: RunContext = {
    opts,
    sessionId,
    briefText,
    outDir,
    eventsPath: join(outDir, "events.jsonl"),
    briefPath: join(outDir, "brief.txt"),
    resultPath: join(outDir, "result.json"),
  };
  writeFileSync(ctx.briefPath, briefText, "utf8");
  writeFileSync(ctx.eventsPath, "", "utf8");
  return ctx;
}

export function main(adapter: Adapter): void {
  const opts = parseArgs(process.argv.slice(2), helpText(adapter));
  const briefText = readBrief(opts);
  if (!briefText.trim()) {
    fail("empty brief (pass --brief <file> or pipe the brief on stdin)");
  }

  if (!opts.skipGitRepoCheck && !isGitRepo(opts.cd)) {
    fail(
      `not a git repository: ${opts.cd}\n` +
        "  delegate reviews work via 'git diff'. Run inside a git repo, or pass --skip-git-repo-check.",
    );
  }

  const before = gitTouchedFiles(opts.cd);
  const dirtyBefore = Array.isArray(before) && before.length > 0;
  const version = targetVersion(adapter);
  const sessionId = opts.sessionId ?? randomUUID();
  const ctx = prepareRunDir(opts, briefText, sessionId);
  const startedAt = new Date().toISOString();
  const writeResult = makeResultWriter({
    opts,
    targetName: adapter.name,
    targetVersion: version,
    ctx,
    startedAt,
    dirtyBefore,
  });

  if (!version) {
    const result = writeResult({
      status: "target_unavailable",
      exitCode: 127,
      finalMessage: "",
      touchedFiles: [],
    });
    printSummary(result, ctx.resultPath);
    process.stderr.write(
      `relay: \`${adapter.name}\` not found on PATH. Install it and authenticate, then retry.\n`,
    );
    process.exit(127);
  }

  dispatch(adapter, ctx, writeResult);
}
