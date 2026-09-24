"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { SpotifyService } = require("../lib/service");
const { WebPlayerLogin } = require("../lib/web-player-login");
const { createSetupServer } = require("../lib/setup-server");
const { saveCredentials } = require("../lib/credential-store");
const token = "demo-web-session-token-for-testing";
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-setup-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "credentials.json");
}
const profile = async () => Response.json({ id: "demo-user" });
function context() {
  const c = new EventEmitter();
  c.pages = () => [{ goto: async url => { assert.equal(url, "https://open.spotify.com/"); } }];
  c.close = async () => { c.closed = true; c.emit("close"); };
  return c;
}
function response(url, frame = "https://open.spotify.com/", bearer = token) {
  return { ok: () => true, url: () => url, request: () => ({ frame: () => ({ url: () => frame }), allHeaders: async () => ({ authorization: `Bearer ${bearer}` }) }) };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function saved(login) {
  for (let n = 0; n < 100 && login.state !== "saved"; n++) await settle();
  assert.equal(login.state, "saved");
}
test("dedicated login captures only authenticated Spotify requests and preserves playback credentials", async t => {
  const file = await temporary(t), c = context();
  await saveCredentials(file, { clientId: "existing-client", refreshToken: "existing-refresh" });
  const login = new WebPlayerLogin({ credentialFile: file, launcher: async () => c, fetchImpl: profile, env: {} });
  t.after(() => login.cancel());
  await login.start();
  c.emit("response", response("https://evil.example/request"));
  c.emit("response", response("https://api.spotify.com/v1/me", "https://evil.example/"));
  await settle();
  assert.equal(login.state, "waiting");
  c.emit("response", response("https://api-partner.spotify.com/pathfinder/v2/query"));
  await saved(login);
  assert.equal(login.state, "saved");
  assert.equal(c.closed, true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { clientId: "existing-client", refreshToken: "existing-refresh", webPlayerToken: token });
  assert.ok(!JSON.stringify(login.status()).includes(token));
});
test("anonymous tokens are ignored and a later authenticated session is saved", async t => {
  const file = await temporary(t), c = context();
  const login = new WebPlayerLogin({ credentialFile: file, launcher: async () => c, env: {}, fetchImpl: async (_, init) => init.headers.Authorization.includes("anonymous") ? new Response(null, { status: 401 }) : profile() });
  t.after(() => login.cancel());
  await login.start();
  c.emit("response", response("https://spclient.wg.spotify.com/query", undefined, "anonymous-token-for-test")); await settle();
  assert.equal(login.state, "waiting");
  c.emit("response", response("https://gew1-spclient.spotify.com/query")); await saved(login);
  assert.equal(login.state, "saved");
});
test("cancellation discards a token that is still being validated", async t => {
  const file = await temporary(t), c = context();
  let finish, called = false;
  const login = new WebPlayerLogin({ credentialFile: file, launcher: async () => c, env: {}, fetchImpl: () => new Promise(resolve => { finish = resolve; }), saver: async () => { called = true; } });
  await login.start(); c.emit("response", response("https://api.spotify.com/v1/me")); await settle();
  await login.cancel(); finish(await profile()); await settle();
  assert.equal(called, false); assert.equal(login.state, "cancelled");
});
test("missing browser and environment override are actionable states", async t => {
  const file = await temporary(t);
  const login = new WebPlayerLogin({ credentialFile: file, launcher: async () => { throw new Error("private details"); }, env: {} });
  await login.start(); assert.equal(login.state, "browser-unavailable");
  const overridden = new WebPlayerLogin({ credentialFile: file, env: { SPOTIFY_WEB_PLAYER_TOKEN: "provided" } });
  await overridden.start(); assert.equal(overridden.state, "environment-override");
});
test("setup protects writes, never exposes tokens, and completes single-use PKCE callback", async t => {
  const file = await temporary(t);
  const service = new SpotifyService({ credentialFile: file, env: {} });
  const login = new WebPlayerLogin({ credentialFile: file, fetchImpl: profile, env: {} });
  const server = createSetupServer({ service, login, fetchImpl: async (_, init) => {
    assert.ok(init.body.get("code_verifier"));
    return Response.json({ refresh_token: "private-refresh" });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  const post = (route, body, headers = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-Setup-CSRF": status.csrf, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post("/api/token", { token }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/token", { token }, { "X-Setup-CSRF": "wrong" })).status, 403);
  assert.equal((await post("/api/token", { token })).status, 200);
  const safeStatus = await (await fetch(`${base}/api/status`)).text();
  assert.ok(!safeStatus.includes(token));
  assert.equal(JSON.parse(safeStatus).playbackMode, "web-session");
  assert.equal((await fetch(`${base}/credentials.json`)).status, 404);
  const oauth = await (await post("/api/playback-login", { clientId: "a".repeat(32) })).json();
  const state = new URL(oauth.url).searchParams.get("state");
  assert.equal((await fetch(`${base}/callback?state=invalid&code=demo`)).status, 400);
  const callback = `${base}/callback?state=${state}&code=demo`;
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 303);
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 400);
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(stored.webPlayerToken, token); assert.equal(stored.refreshToken, "private-refresh");
});
test("web session can supply playback without a developer client ID", async t => {
  const file = await temporary(t);
  await saveCredentials(file, { webPlayerToken: token });
  const service = new SpotifyService({ credentialFile: file, env: {}, fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.spotify.com/v1/me/player");
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    return new Response(null, { status: 204 });
  } });
  assert.equal((await service.playback()).track, null);
});
