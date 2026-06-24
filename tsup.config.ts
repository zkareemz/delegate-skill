import { defineConfig } from "tsup";

// Bundle the TypeScript engine + the pi adapter into ONE self-contained, zero-runtime-dependency
// Node script. The output lands directly in the skill folder the `skills` CLI copies as-is:
//   skills/delegate-pi/scripts/relay.mjs
// (The `skills` CLI never runs a build, so the compiled artifact is committed there.)
export default defineConfig({
  entry: { relay: "src/engine/index.ts" },
  outDir: "skills/delegate-pi/scripts",
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  splitting: false,
  // Do NOT clean: outDir's parent holds SKILL.md/references; only relay.mjs is generated here.
  clean: false,
  minify: false,
  dts: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  outExtension() {
    return { js: ".mjs" };
  },
});
