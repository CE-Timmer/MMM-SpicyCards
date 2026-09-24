"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDesktopReceiver, bridgePaths, startDesktopBridge } = require("../lib/desktop-bridge");
const { SpotifyService } = require("../lib/service");
const { createBridge, readDesktopSession, normalizeConfig } = require("../spicetify/spotifycards-bridge");
const key = "a".repeat(64), token = "desktop-session-for-test-only";
const current = () => ({ accessToken: token, accessTokenExpirationTimestampMs: Date.now() + 3600000 });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-bridge-"));
  const credentialFile = path.join(directory, "credentials.json");
  const { tokenFile } = bridgePaths(credentialFile);
  let notifications = 0;
  const server = createDesktopReceiver({ pairingKey: key, tokenFile, onToken: () => notifications++ });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${url}/spotifycards/token`, { method: "POST", headers: { "Content-Type": "application/json", "X-SpotifyCards-Key": key, ...headers }, body: JSON.stringify(body) });
  return { credentialFile, tokenFile, url, post, notifications: () => notifications };
}

test("desktop extension delivers to receiver; lyrics prefer it over cookie and OAuth", async t => {
  const f = await fixture(t);
  const messages = [];
  let session = current();
  const bridge = createBridge({ spicetify: { Platform: { AuthorizationAPI: { getState: () => ({ token: session }) } } }, onStatus: s => messages.push(s) });
  bridge.configure({ url: f.url, pairingKey: key, enabled: true });
  await bridge.tick();
  assert.equal(f.notifications(), 1);
  assert.equal(JSON.parse(await fs.readFile(f.tokenFile, "utf8")).accessToken, token);
  assert.ok(!messages.join().includes(token));
  const service = new SpotifyService({ credentialFile: f.credentialFile, env: {}, fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.spicylyrics.org/query");
    assert.equal(init.headers["SpicyLyrics-WebAuth"], `Bearer ${token}`);
    return Response.json({ queries: [{ operationId: "0", result: { httpStatus: 404 } }] });
  } });
  service.setWebPlayerToken("cookie-token");
  service.setSessionCredentials({ SPOTIFY_CLIENT_ID: "client", SPOTIFY_REFRESH_TOKEN: "oauth-refresh" });
  assert.equal(await service.lyrics("0123456789abcdefghijkl"), null);
  service.setSessionCredentials({});
  assert.equal(await service.playbackToken(), token);
  await bridge.tick();
  assert.equal(f.notifications(), 1, "unchanged token is not sent every check");
  session = { ...current(), accessToken: "rotated-desktop-session-test-token" };
  await bridge.tick(true);
  assert.equal((await service.credentials()).desktopToken, session.accessToken);
  const restarted = new SpotifyService({ credentialFile: f.credentialFile, env: {} });
  assert.equal((await restarted.credentials()).desktopToken, session.accessToken);
});

test("receiver rejects wrong pairing, bad origin, oversized and expired sessions without replacing good token", async t => {
  const f = await fixture(t);
  const body = { accessToken: token, expiresAt: Date.now() + 3600000 };
  assert.equal((await f.post(body)).status, 200);
  const before = await fs.readFile(f.tokenFile, "utf8");
  assert.equal((await f.post(body, { "X-SpotifyCards-Key": "wrong" })).status, 401);
  assert.equal((await f.post(body, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.post({ ...body, expiresAt: Date.now() - 1000 })).status, 400);
  assert.equal((await f.post({ ...body, accessToken: "bad" })).status, 400);
  assert.equal((await f.post({ ...body, extra: "x".repeat(17000) })).status, 413);
  assert.equal(await fs.readFile(f.tokenFile, "utf8"), before);
  const response = await fetch(`${f.url}/spotifycards/token`, { headers: { "X-SpotifyCards-Key": key } });
  assert.equal(response.status, 405);
  assert.ok(!(await response.text()).includes(token));
});

test("Spotify desktop cross-origin preflight is supported", async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/spotifycards/token`, { method: "OPTIONS", headers: { Origin: "https://xpui.app.spotify.com", "Access-Control-Request-Method": "POST" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://xpui.app.spotify.com");
  assert.equal(response.headers.get("access-control-allow-private-network"), "true");
});

test("desktop expiry falls back to cookie credentials and does not leak stale tokens", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.tokenFile, JSON.stringify({ accessToken: token, expiresAt: Date.now() - 1 }));
  const service = new SpotifyService({ credentialFile: f.credentialFile, env: {} });
  service.setWebPlayerToken("cookie-token");
  assert.equal((await service.credentials()).desktopToken, undefined);
  assert.equal(await service.playbackToken(), "cookie-token");
});

test("token reader uses authorization store, Cosmos, then Platform.Session", async () => {
  const session = current();
  assert.equal((await readDesktopSession({ Platform: { AuthorizationAPI: { getState: () => ({ token: session }) } } })).accessToken, token);
  assert.equal((await readDesktopSession({ CosmosAsync: { get: async url => { assert.equal(url, "sp://oauth/v2/token"); return { accessToken: token, expiresAtTime: session.accessTokenExpirationTimestampMs }; } } })).accessToken, token);
  assert.equal((await readDesktopSession({ Platform: { Session: session }, CosmosAsync: { get: async () => { throw new Error(); } } })).accessToken, token);
  await assert.rejects(readDesktopSession({ Platform: { AuthorizationAPI: { getState: () => ({ isAuthorized: false, token: session }) }, Session: session } }));
  await assert.rejects(readDesktopSession({ Platform: { Session: { ...session, accessTokenExpirationTimestampMs: 1 } } }));
});

test("forwarding retries failed delivery, picks up rotation, and resends after receiver restart", async () => {
  let clock = Date.now(), calls = 0, fail = true;
  let session = { accessToken: token, accessTokenExpirationTimestampMs: clock + 3600000 };
  const bridge = createBridge({ now: () => clock, spicetify: { Platform: { AuthorizationAPI: { getState: () => ({ token: session }) } } }, fetchImpl: async (_, init) => {
    calls++; assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
    if (fail) throw new TypeError("offline");
    return Response.json({ ok: true });
  } });
  bridge.configure({ url: "192.168.1.50:8890", pairingKey: key, enabled: true });
  await bridge.tick(); await bridge.tick(); assert.equal(calls, 1);
  clock += 30000; fail = false; await bridge.tick(); assert.equal(calls, 2);
  clock += 30000; await bridge.tick(); assert.equal(calls, 2);
  session = { ...session, accessToken: "new-desktop-token-for-rotation" };
  clock += 30000; await bridge.tick(); assert.equal(calls, 3);
  clock += 300000; await bridge.tick(); assert.equal(calls, 4);
  bridge.stop(); await bridge.tick(true); assert.equal(calls, 4);
});

test("configuration rejects destinations with credentials and receiver is opt-in", () => {
  assert.throws(() => normalizeConfig({ url: "https://user:password@example.com", pairingKey: key }));
  assert.throws(() => normalizeConfig({ url: "file:///tmp", pairingKey: key }));
  assert.equal(normalizeConfig({ url: "192.168.1.50:8890/", pairingKey: key }).url, "http://192.168.1.50:8890");
  assert.equal(startDesktopBridge({ credentialFile: path.join(os.tmpdir(), "nonexistent-spotifycards-dir", "credentials.json") }), null);
});
