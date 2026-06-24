/**
 * delegate-skill · engine · git helpers
 *
 * The relay never touches `.git` to write — it only *reads* status so the
 * orchestrator has a starting point for review. Committing is the orchestrator's job.
 */

import { execFileSync } from "node:child_process";

/**
 * `git status --porcelain` lines in `cwd`. Returns null (not []) when git can't
 * report — git missing, or a non-repo run — so the caller can tell "git
 * unavailable" apart from "the target changed nothing" ([]).
 */
export function gitTouchedFiles(cwd: string): string[] | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** True if `cwd` is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}
