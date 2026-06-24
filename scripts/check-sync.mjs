#!/usr/bin/env node
/**
 * check-sync — rebuild every relay to a temp dir and diff each against its committed
 * skills/<skill>/scripts/relay.mjs. Fails if any differ, so the TypeScript source and the
 * shipped artifacts (which the `skills` CLI copies as-is) can't drift.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skillsDir = "skills";
const tmp = mkdtempSync(join(tmpdir(), "delegate-checksync-"));

execFileSync("npx", ["tsup", "--out-dir", tmp], { stdio: "inherit" });

let drift = 0;
for (const name of readdirSync(skillsDir)) {
  const rel = join(name, "scripts", "relay.mjs");
  const committedPath = join(skillsDir, rel);
  let committed;
  try {
    committed = readFileSync(committedPath, "utf8");
  } catch {
    continue; // not a relay-bearing skill dir (or a stray file like .DS_Store)
  }
  let fresh;
  try {
    fresh = readFileSync(join(tmp, rel), "utf8");
  } catch {
    console.error(`check-sync: ${committedPath} has no freshly-built counterpart (missing tsup entry?).`);
    drift += 1;
    continue;
  }
  if (fresh !== committed) {
    console.error(`check-sync: ${committedPath} is OUT OF SYNC with src/.`);
    drift += 1;
  }
}

if (drift) {
  console.error("\nRun `npm run build` and commit the updated relay.mjs file(s).\n");
  process.exit(1);
}
console.log("check-sync: all skills/*/scripts/relay.mjs are in sync with src/ ✓");
