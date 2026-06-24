#!/usr/bin/env node
/**
 * smoke — plumbing checks for the built relays that need NO model call: the error and
 * exit-code paths. Runs against every committed skills/<skill>/scripts/relay.mjs (the
 * engine is shared, so each target's relay must behave identically here). The full
 * end-to-end (a real target run) is verified separately.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELAYS = readdirSync("skills")
  .map((name) => join("skills", name, "scripts", "relay.mjs"))
  .filter((p) => existsSync(p));

if (!RELAYS.length) {
  console.error("smoke: no skills/*/scripts/relay.mjs found — run `npm run build` first.");
  process.exit(1);
}

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

function runRelay(relay, args, input) {
  try {
    const stdout = execFileSync("node", [relay, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: input ?? "",
    });
    return { code: 0, stdout };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

for (const RELAY of RELAYS) {
  console.log(`\nrelay plumbing smoke: ${RELAY}`);

  check("--help exits 0 and shows usage", () => {
    const r = runRelay(RELAY, ["--help"]);
    if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
    if (!/Usage:/.test(r.stdout)) throw new Error("help text missing 'Usage:'");
  });

  check("empty stdin brief exits 2", () => {
    const r = runRelay(RELAY, [], "");
    if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
  });

  check("missing brief file exits 2", () => {
    const r = runRelay(RELAY, ["--brief", "/no/such/brief-xyz.txt"]);
    if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
  });

  check("non-git workdir exits 2", () => {
    const d = mkdtempSync(join(tmpdir(), "delegate-nogit-"));
    const brief = join(d, "b.txt");
    writeFileSync(brief, "do something");
    const r = runRelay(RELAY, ["--brief", brief, "--cd", d]);
    rmSync(d, { recursive: true, force: true });
    if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
  });

  check("unknown option exits 2", () => {
    const r = runRelay(RELAY, ["--nope"]);
    if (r.code !== 2) throw new Error(`expected exit 2, got ${r.code}`);
  });
}

if (failures) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nall plumbing smoke checks passed ✓");
