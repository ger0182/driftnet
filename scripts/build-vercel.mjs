import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(".vercel-generated", { recursive: true });
await mkdir("public", { recursive: true });
await writeFile("public/.vercel-keep", "Driftnet UI is served by the Vercel Function.\n");

await build({
  entryPoints: ["vercel-src/index.ts"],
  outfile: ".vercel-generated/driftnet-handler.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["node:*"],
  define: {
    "import.meta.url": "__DRIFTNET_APP_MODULE_URL__",
  },
  banner: {
    js: `const __DRIFTNET_APP_MODULE_URL__ = new URL("apps/server/src/app.ts", "file://" + process.cwd() + "/").href;`,
  },
});

console.log("Built Vercel handler: .vercel-generated/driftnet-handler.mjs");
