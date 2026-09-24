"use strict";

const fs = require("node:fs");
const path = require("node:path");

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) {
    return text.slice(1, -1);
  }
  return text.replace(/\s+#.*$/, "").trim();
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

function defaultEnvFile(env) {
  if (env.SPOTIFYCARDS_ENV_FILE) return env.SPOTIFYCARDS_ENV_FILE;
  return path.join(__dirname, "..", ".env");
}

function loadEnv(env = process.env, envFile = defaultEnvFile(env)) {
  let file = {};
  try { file = parseEnv(fs.readFileSync(envFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // The service process environment deliberately wins over the local file.
  return { ...file, ...env };
}

module.exports = { loadEnv, parseEnv, defaultEnvFile };
