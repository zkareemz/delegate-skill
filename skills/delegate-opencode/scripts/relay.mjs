#!/usr/bin/env node

// src/engine/index.ts
import { mkdirSync, writeFileSync as writeFileSync2, readFileSync, existsSync } from "fs";
import { join, resolve, basename } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { execFileSync as execFileSync2 } from "child_process";

// src/engine/git.ts
import { execFileSync } from "child_process";
function gitTouchedFiles(cwd) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    return out.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  } catch {
    return null;
  }
}
function isGitRepo(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

// src/engine/result.ts
import { writeFileSync } from "fs";
function makeResultWriter(params) {
  const { opts, targetName, targetVersion: targetVersion2, ctx, startedAt, dirtyBefore } = params;
  return (extra) => {
    const result = {
      schema: "delegate-relay.result.v1",
      target: targetName,
      targetVersion: targetVersion2,
      workdir: opts.cd,
      model: opts.model,
      provider: opts.provider,
      sessionId: ctx.sessionId,
      resume: opts.resume,
      dirtyBefore,
      briefPath: ctx.briefPath,
      eventsPath: ctx.eventsPath,
      startedAt,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...extra
    };
    writeFileSync(ctx.resultPath, `${JSON.stringify(result, null, 2)}
`, "utf8");
    return result;
  };
}
function printSummary(result, resultPath) {
  const lines = [];
  lines.push("");
  lines.push(
    `relay: ${result.status} (exit ${result.exitCode})  \xB7  ${result.target} ${result.targetVersion ?? "?"}`
  );
  if (result.resume) lines.push("mode: resumed session");
  if (result.sessionId) {
    lines.push(
      `session id (resume: --session-id ${result.sessionId} --resume): ${result.sessionId}`
    );
  }
  if (result.dirtyBefore) {
    lines.push(
      "note: the working tree had uncommitted changes BEFORE this run \u2014 touched files may include pre-existing edits."
    );
  }
  const touched = result.touchedFiles;
  if (touched === null) {
    lines.push("touched files: git unavailable \u2014 inspect the working tree directly");
  } else {
    lines.push(`touched files: ${touched.length}`);
    for (const file of touched.slice(0, 40)) lines.push(`  ${file}`);
    if (touched.length > 40) lines.push(`  \u2026 and ${touched.length - 40} more`);
  }
  if (result.stderrTail && result.stderrTail.length) {
    lines.push("last stderr:");
    for (const line of result.stderrTail.slice(-8)) lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push("--- target final report ---");
  lines.push(result.finalMessage || "(no final message captured)");
  lines.push("--- end report ---");
  lines.push("");
  lines.push(`result: ${resultPath}`);
  lines.push(
    "relay does not commit. Review the diff, re-run the project gates yourself, then commit from the orchestrator."
  );
  process.stdout.write(`${lines.join("\n")}
`);
}

// src/engine/run.ts
import { spawn } from "child_process";
import { appendFileSync } from "fs";
function dispatch(adapter, ctx, writeResult) {
  const baseArgv = ctx.opts.resume ? adapter.buildResumeArgv(ctx) : adapter.buildArgv(ctx);
  const argv = adapter.sendBrief === "argv" ? [...baseArgv, ctx.briefText] : baseArgv;
  const child = spawn(adapter.name, argv, {
    cwd: ctx.opts.cd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  let events = "";
  let stdoutBuf = "";
  const stderrTail = [];
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      events += `${line}
`;
      appendFileSync(ctx.eventsPath, `${line}
`, "utf8");
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    for (const line of text.split("\n")) {
      if (line.trim()) stderrTail.push(line.trimEnd());
    }
    while (stderrTail.length > 20) stderrTail.shift();
  });
  child.on("error", (err) => {
    const result = writeResult({
      status: "failed",
      exitCode: 1,
      finalMessage: "",
      touchedFiles: gitTouchedFiles(ctx.opts.cd),
      error: err?.message ?? String(err)
    });
    printSummary(result, ctx.resultPath);
    process.exit(1);
  });
  child.on("close", (code) => {
    if (stdoutBuf.trim()) {
      events += `${stdoutBuf}
`;
      appendFileSync(ctx.eventsPath, `${stdoutBuf}
`, "utf8");
    }
    const finalMessage = adapter.parseFinalMessage(events);
    const sessionId = adapter.parseSessionId(events) ?? ctx.sessionId;
    const result = writeResult({
      status: code === 0 ? "completed" : "failed",
      exitCode: code === null ? 1 : code,
      finalMessage,
      touchedFiles: gitTouchedFiles(ctx.opts.cd),
      sessionId,
      ...code === 0 ? {} : { stderrTail: stderrTail.slice(-20) }
    });
    printSummary(result, ctx.resultPath);
    process.exit(result.exitCode);
  });
  child.stdin.on("error", () => {
  });
  if (adapter.sendBrief === "stdin") {
    child.stdin.write(ctx.briefText);
  }
  child.stdin.end();
}

// src/engine/index.ts
function helpText(adapter) {
  return `delegate-skill relay \u2014 dispatch a brief to the ${adapter.name} CLI and capture the run.

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
function fail(message, code = 2) {
  process.stderr.write(`relay: ${message}
`);
  process.exit(code);
}
function parseArgs(argv, help) {
  const opts = {
    brief: null,
    cd: process.cwd(),
    model: null,
    provider: null,
    sessionId: null,
    resume: false,
    skipGitRepoCheck: false,
    outDir: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === void 0) fail(`${arg} requires a value`);
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
function readBrief(opts) {
  if (opts.brief) {
    if (!existsSync(opts.brief)) fail(`brief file not found: ${opts.brief}`);
    return readFileSync(opts.brief, "utf8");
  }
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function targetVersion(adapter) {
  try {
    return execFileSync2(adapter.name, adapter.versionArgv, {
      encoding: "utf8",
      shell: process.platform === "win32"
    }).trim();
  } catch {
    return null;
  }
}
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
function prepareRunDir(opts, briefText, sessionId) {
  const outDir = opts.outDir || join(tmpdir(), "delegate-relay", `${basename(opts.cd) || "repo"}-${timestamp()}`);
  mkdirSync(outDir, { recursive: true });
  const ctx = {
    opts,
    sessionId,
    briefText,
    outDir,
    eventsPath: join(outDir, "events.jsonl"),
    briefPath: join(outDir, "brief.txt"),
    resultPath: join(outDir, "result.json")
  };
  writeFileSync2(ctx.briefPath, briefText, "utf8");
  writeFileSync2(ctx.eventsPath, "", "utf8");
  return ctx;
}
function main(adapter) {
  const opts = parseArgs(process.argv.slice(2), helpText(adapter));
  const briefText = readBrief(opts);
  if (!briefText.trim()) {
    fail("empty brief (pass --brief <file> or pipe the brief on stdin)");
  }
  if (!opts.skipGitRepoCheck && !isGitRepo(opts.cd)) {
    fail(
      `not a git repository: ${opts.cd}
  delegate reviews work via 'git diff'. Run inside a git repo, or pass --skip-git-repo-check.`
    );
  }
  const before = gitTouchedFiles(opts.cd);
  const dirtyBefore = Array.isArray(before) && before.length > 0;
  const version = targetVersion(adapter);
  const sessionId = opts.sessionId ?? randomUUID();
  const ctx = prepareRunDir(opts, briefText, sessionId);
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const writeResult = makeResultWriter({
    opts,
    targetName: adapter.name,
    targetVersion: version,
    ctx,
    startedAt,
    dirtyBefore
  });
  if (!version) {
    const result = writeResult({
      status: "target_unavailable",
      exitCode: 127,
      finalMessage: "",
      touchedFiles: []
    });
    printSummary(result, ctx.resultPath);
    process.stderr.write(
      `relay: \`${adapter.name}\` not found on PATH. Install it and authenticate, then retry.
`
    );
    process.exit(127);
  }
  dispatch(adapter, ctx, writeResult);
}

// src/adapters/opencode.ts
function parseLines(events) {
  const out = [];
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}
function resolveModel(ctx) {
  const { model, provider } = ctx.opts;
  if (model && provider && !model.includes("/")) return `${provider}/${model}`;
  return model;
}
var opencodeAdapter = {
  name: "opencode",
  versionArgv: ["--version"],
  sendBrief: "argv",
  buildArgv(ctx) {
    const argv = ["run", "--format", "json"];
    const model = resolveModel(ctx);
    if (model) argv.push("-m", model);
    return argv;
  },
  buildResumeArgv(ctx) {
    return ["run", "--format", "json", "--session", ctx.sessionId];
  },
  parseSessionId(events) {
    for (const event of parseLines(events)) {
      if (typeof event.sessionID === "string" && event.sessionID) return event.sessionID;
    }
    return null;
  },
  parseFinalMessage(events) {
    const parts = [];
    for (const event of parseLines(events)) {
      const part = event.part;
      if (event.type === "text" && part && typeof part.text === "string") {
        parts.push({ messageID: part.messageID, text: part.text });
      }
    }
    if (!parts.length) return "";
    const lastId = parts[parts.length - 1].messageID;
    const chosen = lastId ? parts.filter((p) => p.messageID === lastId) : [parts[parts.length - 1]];
    return chosen.map((p) => p.text).join("").trim();
  }
};

// src/entries/delegate-opencode.ts
main(opencodeAdapter);
