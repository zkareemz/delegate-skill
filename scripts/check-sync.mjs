#!/usr/bin/env node
/**
 * check-sync — rebuild the relay to a temp dir and diff it against the committed
 * skills/delegate-pi/scripts/relay.mjs. Fails if they differ, so the TypeScript
 * source and the shipped artifact (which the `skills` CLI copies as-is) can't drift.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const committedPath = "skills/delegate-pi/scripts/relay.mjs";
const tmp = mkdtempSync(join(tmpdir(), "delegate-checksync-"));

execFileSync("npx", ["tsup", "--out-dir", tmp], { stdio: "inherit" });

const fresh = readFileSync(join(tmp, "relay.mjs"), "utf8");
const committed = readFileSync(committedPath, "utf8");

if (fresh !== committed) {
  console.error(`\ncheck-sync: ${committedPath} is OUT OF SYNC with src/.`);
  console.error("Run `npm run build` and commit the updated relay.mjs.\n");
  process.exit(1);
}
console.log("check-sync: relay.mjs is in sync with src/ ✓");
