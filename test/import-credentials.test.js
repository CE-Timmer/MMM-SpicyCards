"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function run(input, environment) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["scripts/import-credentials.js"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, ...environment } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("credential import saves only supplied values outside the served module", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-import-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "private", "credentials.json");
  const token = "web-player-token-that-is-long-enough";
  const result = await run(JSON.stringify({ webPlayerToken: `Bearer ${token}`, clientId: "a".repeat(32) }), { SPOTIFYCARDS_CREDENTIAL_FILE: file });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes(token));
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { webPlayerToken: token, clientId: "a".repeat(32) });
});

test("credential import rejects malformed values and environment collisions without writing", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-import-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "credentials.json");
  const invalid = await run('{"webPlayerToken":"short"}', { SPOTIFYCARDS_CREDENTIAL_FILE: file });
  assert.equal(invalid.code, 1);
  await assert.rejects(fs.readFile(file));
  const overridden = await run('{"webPlayerToken":"web-player-token-that-is-long-enough"}', { SPOTIFYCARDS_CREDENTIAL_FILE: file, SPOTIFY_WEB_PLAYER_TOKEN: "environment" });
  assert.equal(overridden.code, 1);
  await assert.rejects(fs.readFile(file));
});
