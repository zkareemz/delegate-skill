/**
 * delegate-skill · engine · dispatch
 *
 * Spawn the target, capture its stdout (the event stream) and stderr (surfaced
 * live), block until it exits, then hand the captured stream to the adapter to
 * extract the final message and session id. Writes result.json on every outcome
 * and exits with the target's exit code.
 */

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { Adapter, RunContext } from "./types";
import { gitTouchedFiles } from "./git";
import { printSummary, type WriteResult } from "./result";

export function dispatch(adapter: Adapter, ctx: RunContext, writeResult: WriteResult): void {
  const baseArgv = ctx.opts.resume ? adapter.buildResumeArgv(ctx) : adapter.buildArgv(ctx);
  // For "argv" delivery the brief is the final positional. spawn passes argv as an
  // array (no shell), so even a long multi-line brief needs no quoting or escaping.
  const argv = adapter.sendBrief === "argv" ? [...baseArgv, ctx.briefText] : baseArgv;

  // shell:true on Windows so an npm `.cmd` shim resolves (Node's CreateProcess only
  // auto-appends .exe). The brief is never in argv on Windows-sensitive paths via a
  // shell string — it's a discrete array element (or stdin) — so there's no injection.
  const child = spawn(adapter.name, argv, {
    cwd: ctx.opts.cd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  let events = ""; // full stdout, accumulated for adapter parsing
  let stdoutBuf = ""; // line buffer
  const stderrTail: string[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      events += `${line}\n`;
      appendFileSync(ctx.eventsPath, `${line}\n`, "utf8");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    process.stderr.write(text); // surface target progress live for the orchestrator
    for (const line of text.split("\n")) {
      if (line.trim()) stderrTail.push(line.trimEnd());
    }
    while (stderrTail.length > 20) stderrTail.shift();
  });

  child.on("error", (err: Error) => {
    const result = writeResult({
      status: "failed",
      exitCode: 1,
      finalMessage: "",
      touchedFiles: gitTouchedFiles(ctx.opts.cd),
      error: err?.message ?? String(err),
    });
    printSummary(result, ctx.resultPath);
    process.exit(1);
  });

  child.on("close", (code: number | null) => {
    if (stdoutBuf.trim()) {
      events += `${stdoutBuf}\n`;
      appendFileSync(ctx.eventsPath, `${stdoutBuf}\n`, "utf8");
    }
    const finalMessage = adapter.parseFinalMessage(events);
    const sessionId = adapter.parseSessionId(events) ?? ctx.sessionId;
    const result = writeResult({
      status: code === 0 ? "completed" : "failed",
      exitCode: code === null ? 1 : code,
      finalMessage,
      touchedFiles: gitTouchedFiles(ctx.opts.cd),
      sessionId,
      ...(code === 0 ? {} : { stderrTail: stderrTail.slice(-20) }),
    });
    printSummary(result, ctx.resultPath);
    process.exit(result.exitCode);
  });

  // Brief delivery. argv delivery already put it in argv above; close stdin so the
  // target doesn't block waiting on it.
  child.stdin.on("error", () => {
    /* if launch failed, writing to the pipe can emit a stray error — 'error' owns it */
  });
  if (adapter.sendBrief === "stdin") {
    child.stdin.write(ctx.briefText);
  }
  child.stdin.end();
}
