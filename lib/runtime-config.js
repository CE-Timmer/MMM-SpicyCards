"use strict";
const path = require("node:path");
const os = require("node:os");

function runtimePaths(env = process.env, credentialFile = env.SPOTIFYCARDS_CREDENTIAL_FILE || path.join(os.homedir(), ".config/MMM-SpotifyCards/credentials.json")) {
  const directory = path.dirname(credentialFile);
  return {
    configFile: env.SPOTIFYCARDS_CONFIG_FILE || path.join(directory, "config.json"),
    sessionFile: env.SPOTIFYCARDS_SESSION_FILE || path.join(directory, "session.json")
  };
}
module.exports = { runtimePaths };
