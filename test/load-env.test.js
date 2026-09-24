"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadEnv, parseEnv } = require("../lib/load-env");
const { SpotifyService } = require("../lib/service");

test("parses a local env file without overriding real process values", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-env-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, '# comment\nSPOTIFY_CLIENT_ID="from-file"\nSPOTIFY_REFRESH_TOKEN=refresh # note\n');
  assert.deepEqual(parseEnv("A=1\n# nope\nB='two'"), { A: "1", B: "two" });
  const env = loadEnv({ SPOTIFY_CLIENT_ID: "from-process" }, file);
  assert.equal(env.SPOTIFY_CLIENT_ID, "from-process");
  assert.equal(env.SPOTIFY_REFRESH_TOKEN, "refresh");
});

test("service reads token fields from an explicitly selected env file", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-env-service-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  await fs.writeFile(file, "SPOTIFY_CLIENT_ID=client\nSPOTIFY_REFRESH_TOKEN=refresh\nSPOTIFY_WEB_PLAYER_TOKEN=web-token\n");
  const service = new SpotifyService({ credentialFile: path.join(dir, "credentials.json"), env: {}, envFile: file, loadEnvFile: true });
  assert.deepEqual(await service.credentials(), { desktopToken: undefined, spicyLyricsSecretKey: undefined, clientId: "client", clientSecret: undefined, refreshToken: "refresh", accessToken: undefined, webPlayerToken: "web-token" });
});
