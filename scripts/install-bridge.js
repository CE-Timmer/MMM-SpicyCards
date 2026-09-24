"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function main() {
  const command = process.platform === "win32" ? "spicetify.exe" : "spicetify";
  const config = execFileSync(command, ["-c"], { encoding: "utf8", windowsHide: true }).trim();
  if (!path.isAbsolute(config) || !config.endsWith(".ini")) throw new Error("Could not locate the Spicetify configuration");
  const destination = path.join(path.dirname(config), "Extensions", "spotifycards-bridge.js");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(__dirname, "..", "spicetify", "spotifycards-bridge.js"), destination);
  execFileSync(command, ["config", "extensions", "spotifycards-bridge.js"], { stdio: "inherit", windowsHide: true });
  console.log(`Installed ${destination}\nRun spicetify apply to load the extension (Spotify may restart).\nThen open your Spotify profile menu > SpotifyCards Bridge.`);
}
main().catch(error => { console.error(error.code === "ENOENT" ? "Install Spicetify first and make sure it is on PATH." : error.message); process.exitCode = 1; });
