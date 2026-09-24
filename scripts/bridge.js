"use strict";

const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { parseArgs } = require("node:util");
const { SpotifyService } = require("../lib/service");
const { bridgePaths, validKey } = require("../lib/desktop-bridge");
const { saveCredentials } = require("../lib/credential-store");

async function main() {
  const { values } = parseArgs({ options: {
    host: { type: "string" }, port: { type: "string" },
    disable: { type: "boolean" }, rotate: { type: "boolean" }
  } });
  const { configFile } = bridgePaths(new SpotifyService().credentialFile);
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(configFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read bridge configuration"); }
  const port = Number(values.port || previous.port || 8890);
  const host = values.host || previous.host || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !host.trim()) throw new Error("Invalid host or port");
  const pairingKey = !values.rotate && validKey(previous.pairingKey) ? previous.pairingKey : crypto.randomBytes(32).toString("hex");
  await saveCredentials(configFile, { enabled: !values.disable, host, port, pairingKey });
  console.log(`Bridge ${values.disable ? "disabled" : "enabled"}. Restart MagicMirror to apply.\nConfiguration: ${configFile}`);
  if (!values.disable) console.log(`In SpotifyCards Bridge settings use http://MIRROR_IP:${port}\nPairing key: ${pairingKey}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
