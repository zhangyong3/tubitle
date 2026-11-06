import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "extension");
const outdir = resolve(app, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(app, "public"), outdir, { recursive: true });

// Only ship the regular font faces. The PDF renderer loads the faces it needs from the extension.
const require = createRequire(resolve(app, "package.json"));
const fontCssPath = require.resolve("@fontsource/noto-sans-sc/400.css");
const fontRoot = dirname(fontCssPath);
const fontDirectory = resolve(outdir, "pdf-fonts");
const fontCss = await readFile(fontCssPath, "utf8");
const faces = Array.from(fontCss.matchAll(/@font-face\s*\{([^}]+)\}/g), ([, block]) => ({
  file: block.match(/url\(\.\/files\/([^/)]+\.woff)\)/)?.[1],
  ranges: block.match(/unicode-range:\s*([^;]+)/)?.[1]
})).filter((face) => face.file && face.ranges);
if (!faces.length) throw new Error("Missing Unicode ranges for the PDF font");
await mkdir(fontDirectory, { recursive: true });
await Promise.all([
  ...faces.map(({ file }) => cp(resolve(fontRoot, "files", file), resolve(fontDirectory, file))),
  cp(resolve(fontRoot, "LICENSE"), resolve(fontDirectory, "LICENSE")),
  writeFile(resolve(fontDirectory, "faces.json"), JSON.stringify(faces))
]);

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
