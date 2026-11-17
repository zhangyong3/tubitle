import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { copyPdfFontAssets } from "./pdf-font-assets.mjs";

const root = resolve(import.meta.dirname, "..");
const app = resolve(root, "extension");
const outdir = resolve(app, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(app, "public"), outdir, { recursive: true });
const site = new URL(process.env.TUBITLE_SITE_URL || 'http://127.0.0.1:3100');
if ((site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(site.hostname))) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('TUBITLE_SITE_URL must be an HTTPS origin (loopback HTTP allowed for development)');
const { readFile, writeFile } = await import('node:fs/promises');
const manifestPath = resolve(outdir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const translation = new URL(process.env.TUBITLE_TRANSLATION_URL || 'http://127.0.0.1:18081');
if ((translation.protocol !== 'https:' && !(translation.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(translation.hostname))) || translation.username || translation.password || translation.pathname !== '/' || translation.search || translation.hash) throw new Error('TUBITLE_TRANSLATION_URL must be an HTTPS origin (loopback HTTP allowed)');
manifest.host_permissions = [...new Set([...manifest.host_permissions, `${site.origin}/*`, `${translation.origin}/*`])];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

await copyPdfFontAssets(app, resolve(outdir, "pdf-fonts"));

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
  define: { __TUBITLE_TRANSLATION_URL__: JSON.stringify(translation.origin), __TUBITLE_SITE_URL__: JSON.stringify(site.origin), "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") }
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`Watching ${app}`);
} else {
  await build(options);
}
