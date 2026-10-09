/**
 * Bundle and minify the system's code for release (owner's request, 1.0.28: faster loading): module/ad2e.mjs and the 118
 * files it imports become one file, `ad2e.bundle.mjs` (+ source map), so the browser fetches one script instead of
 * following the import chain file by file. The release workflow points system.json `esmodules` at the bundle; the
 * repository keeps module/ad2e.mjs as the entry for development. Run: npm run build:code
 */
import { build } from "esbuild";

await build({
  entryPoints: ["module/ad2e.mjs"],
  outfile: "ad2e.bundle.mjs",
  bundle: true,
  format: "esm",
  minify: true,
  keepNames: true,
  sourcemap: true,
  target: "es2022",
  legalComments: "inline",
  logLevel: "info"
});
