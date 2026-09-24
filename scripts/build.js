"use strict";
const esbuild = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const upstream = path.join(root, "upstream/spicy-lyrics");

async function build() {
  // Use the actual upstream page DOM; only layout CSS is changed for the cards.
  const page = await fs.readFile(path.join(upstream, "src/components/Pages/PageView.ts"), "utf8");
  const markup = page.match(/elem\.innerHTML = `([\s\S]*?)`;/)?.[1];
  if (!markup?.includes('class="NowBar"') || !markup.includes('class="LyricsContainer"')) throw new Error("Upstream page structure changed");
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, "dist/page.html"), markup);
  const bootstrap = await fs.readFile(path.join(root, "standalone/bootstrap.js"), "utf8");
  const boundaries = new Set([
    "components/Pages/PageView.ts", "components/Global/SpotifyPlayer.ts",
    "components/Utils/CompactMode.ts", "components/Utils/PopupLyrics.ts", "utils/Lyrics/fetchLyrics.ts"
  ]);
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: ["standalone/main.ts"], bundle: true,
    outfile: "dist/spotifycards.js", format: "iife", target: "chrome110", sourcemap: true,
    metafile: true, banner: { js: bootstrap }, legalComments: "eof",
    plugins: [{ name: "standalone-host", setup(build) {
      build.onResolve({ filter: /^\./ }, args => {
        const resolved = path.resolve(args.resolveDir, args.path);
        const relative = path.relative(path.join(upstream, "src"), resolved).replaceAll("\\", "/");
        if (boundaries.has(relative)) return { path: path.join(root, "standalone/platform.ts") };
      });
    } }]
  });
  await fs.writeFile(path.join(root, "dist/build-inputs.json"), JSON.stringify(Object.keys(result.metafile.inputs), null, 2));
  // Keep the exact upstream packed codec in the Node helper as well.
  await esbuild.build({ entryPoints: [path.join(upstream, "src/utils/objpack.ts")], outfile: path.join(root, "vendor/objpack.js"), platform: "node", format: "cjs", target: "node20" });

  const goRoot = path.join(root, "spotify-webplayer-token");
  const binDir = path.join(goRoot, "bin");
  const binary = path.join(binDir, `spotify-webplayer-token${process.platform === "win32" ? ".exe" : ""}`);
  await fs.mkdir(binDir, { recursive: true });
  const resultGo = spawnSync("go", ["build", "-o", binary, "."], { cwd: goRoot, stdio: "inherit", shell: false });
  if (resultGo.error?.code === "ENOENT") throw new Error("Go is required to build the Spotify token refresher. Install Go and run npm run build again.");
  if (resultGo.error) throw resultGo.error;
  if (resultGo.status !== 0) throw new Error(`Go token refresher build failed with exit code ${resultGo.status}`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
