import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "extension");
const outdir = resolve(app, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(app, "public"), outdir, { recursive: true });

const options = {
  entryPoints: {
    background: resolve(app, "src/background.ts"),
    content: resolve(app, "src/content/index.ts"),
    "page-bridge": resolve(app, "src/page-bridge.ts"),
    popup: resolve(app, "src/popup.tsx"),
    options: resolve(app, "src/options.tsx"),
    sidepanel: resolve(app, "src/sidepanel.tsx")
  },
  bundle: true,
  outdir,
  entryNames: "[name]",
  format: "iife",
  target: "chrome120",
  sourcemap: watch,
  minify: !watch,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") }
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Watching ${app}`);
} else {
  await build(options);
}
