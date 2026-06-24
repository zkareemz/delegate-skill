#!/usr/bin/env node
/**
 * smoke — plumbing checks for the built relay that need NO model call: the error
 * and exit-code paths. The full pi end-to-end (a real run) is verified separately.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELAY = "skills/delegate-pi/scripts/relay.mjs";
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

function runRelay(args, input) {
  try {
    const stdout = execFileSync("node", [RELAY, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: input ?? "",
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

console.log("relay plumbing smoke:");

check("--help exits 0 and shows usage", () => {
  const r = runRelay(["--help"]);
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (!/Usage:/.test(r.stdout)) throw new Error("help text missing 'Usage:'");
});

check("empty stdin brief exits 2", () => {
  const r = runRelay([], "");
  if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
});

check("missing brief file exits 2", () => {
  const r = runRelay(["--brief", "/no/such/brief-xyz.txt"]);
  if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
});

check("non-git workdir exits 2", () => {
  const d = mkdtempSync(join(tmpdir(), "delegate-nogit-"));
  const brief = join(d, "b.txt");
  writeFileSync(brief, "do something");
  const r = runRelay(["--brief", brief, "--cd", d]);
  rmSync(d, { recursive: true, force: true });
  if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
});

check("unknown option exits 2", () => {
  const r = runRelay(["--nope"]);
  if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
});

if (failures) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nall plumbing smoke checks passed ✓");
