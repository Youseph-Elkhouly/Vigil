import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/hook.ts", "src/giotto-mcp.ts"],
  format: ["esm"],
  platform: "node",
  removeNodeProtocol: false,
  outDir: "dist",
  clean: false,
  splitting: false,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" }
});
