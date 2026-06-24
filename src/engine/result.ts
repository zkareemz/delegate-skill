/**
 * delegate-skill · engine · result writer + summary
 *
 * result.json is the contract the orchestrator reads. The writer merges
 * per-outcome fields onto the run's standing metadata and persists it on every
 * outcome (completed, failed, target_unavailable). A summary is also printed to
 * stdout so a wrapping script can read it directly.
 */

import { writeFileSync } from "node:fs";
import type { RelayOptions, RelayResult, RunContext } from "./types";

/** The per-outcome fields a caller supplies; the rest is standing metadata. */
export type ResultExtra = Pick<
  RelayResult,
  "status" | "exitCode" | "finalMessage" | "touchedFiles"
> &
  Partial<Pick<RelayResult, "sessionId" | "stderrTail" | "error">>;

export type WriteResult = (extra: ResultExtra) => RelayResult;

export function makeResultWriter(params: {
  opts: RelayOptions;
  targetName: string;
  targetVersion: string | null;
  ctx: RunContext;
  startedAt: string;
  dirtyBefore: boolean;
}): WriteResult {
  const { opts, targetName, targetVersion, ctx, startedAt, dirtyBefore } = params;
  return (extra) => {
    const result: RelayResult = {
      schema: "delegate-relay.result.v1",
      target: targetName,
      targetVersion,
      workdir: opts.cd,
      model: opts.model,
      provider: opts.provider,
      sessionId: ctx.sessionId,
      resume: opts.resume,
      dirtyBefore,
      briefPath: ctx.briefPath,
      eventsPath: ctx.eventsPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...extra,
    };
    writeFileSync(ctx.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  };
}

export function printSummary(result: RelayResult, resultPath: string): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `relay: ${result.status} (exit ${result.exitCode})  ·  ${result.target} ${result.targetVersion ?? "?"}`,
  );
  if (result.resume) lines.push("mode: resumed session");
  if (result.sessionId) {
    lines.push(
      `session id (resume: --session-id ${result.sessionId} --resume): ${result.sessionId}`,
    );
  }
  if (result.dirtyBefore) {
    lines.push(
      "note: the working tree had uncommitted changes BEFORE this run — touched files may include pre-existing edits.",
    );
  }
  const touched = result.touchedFiles;
  if (touched === null) {
    lines.push("touched files: git unavailable — inspect the working tree directly");
  } else {
    lines.push(`touched files: ${touched.length}`);
    for (const file of touched.slice(0, 40)) lines.push(`  ${file}`);
    if (touched.length > 40) lines.push(`  … and ${touched.length - 40} more`);
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
    "relay does not commit. Review the diff, re-run the project gates yourself, then commit from the orchestrator.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}
