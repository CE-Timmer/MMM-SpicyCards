"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const executable = path.join(root, "spotify-webplayer-token", "bin", `spotify-webplayer-token${process.platform === "win32" ? ".exe" : ""}`);
const result = spawnSync(executable, [
  "-config", path.join(root, "config.json"),
  "-session", path.join(root, "session.json")
], { cwd: root, stdio: "inherit", shell: false, windowsHide: true, timeout: 35000 });

if (result.error?.code === "ENOENT") {
  console.error("Spotify token refresher is not built. Run npm run build first.");
  process.exitCode = 1;
} else if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status || 1;
}
