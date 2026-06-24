import { defineConfig } from "tsup";

// Bundle the TypeScript engine + each target's adapter into ONE self-contained,
// zero-runtime-dependency Node script per skill. Each entry key carries the output path, so
// the bundle lands directly in the skill folder the `skills` CLI copies as-is:
//   skills/delegate-pi/scripts/relay.mjs
//   skills/delegate-opencode/scripts/relay.mjs
// (The `skills` CLI never runs a build, so the compiled artifacts are committed there.)
export default defineConfig({
  entry: {
    "delegate-pi/scripts/relay": "src/entries/delegate-pi.ts",
    "delegate-opencode/scripts/relay": "src/entries/delegate-opencode.ts",
  },
  outDir: "skills",
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  splitting: false,
  // Do NOT clean: outDir ("skills") holds every skill's SKILL.md/references; only the
  // per-skill relay.mjs files are generated here.
  clean: false,
  minify: false,
  dts: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  outExtension() {
    return { js: ".mjs" };
  },
});
