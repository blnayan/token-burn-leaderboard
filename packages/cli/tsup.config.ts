import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/postinstall.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  external: ["ccusage", "commander", "zod"],
});
