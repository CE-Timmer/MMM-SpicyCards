"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SpotifyService } = require("../lib/service");
const { decodeLyrics } = require("../lib/lyrics");
const { SLObjPack } = require("../vendor/objpack");
const id = "0123456789abcdefghijkl";
const raw = { Type: "Syllable", Content: [{ Type: "Vocal", OppositeAligned: true,
  Lead: { StartTime: 1, EndTime: 3, Syllables: [{ Text: "Hello", StartTime: 1, EndTime: 2, IsPartOfWord: false, TransliteratedText: "Hello" }] },
  Background: [{ StartTime: 1.5, EndTime: 3, Syllables: [{ Text: "Echo", StartTime: 1.5, EndTime: 3 }] }] }],
  SongWriters: ["Demo"], TTMLUploadMetadata: { Maker: { username: "demo" } }, arbitraryMetadata: { preserved: true } };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
async function setup(t, fetchImpl, env = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const credentialFile = path.join(dir, "credentials.json");
  await fs.writeFile(credentialFile, JSON.stringify({ accessToken: "dev-token", webPlayerToken: "session-token" }));
  return new SpotifyService({ credentialFile, fetchImpl, env });
}
test("packed and plain data preserve every provider field", () => {
  assert.deepEqual(decodeLyrics(new SLObjPack().pack(raw)).raw, raw);
  assert.deepEqual(decodeLyrics(raw).raw, raw);
  assert.throws(() => decodeLyrics([["__proto__", "bad"], [-1, 1, 0, 1]]));
  assert.throws(() => decodeLyrics([["Type"], [-3, 999999999, 999999999]]));
});
test("developer API uses its server key and decodes the documented Body", async t => {
  let requests = 0;
  const service = await setup(t, async (url, init) => {
    requests++;
    assert.equal(url, `https://api.spicylyrics.org/v1/lyrics/${id}`);
    assert.equal(init.headers.Authorization, "Bearer sl_sk_testkey");
    assert.equal(init.method, undefined);
    assert.ok(!JSON.stringify(init).includes("session-token"));
    return json({ Body: { ...raw, source: "spicy_lyrics" }, Status: 200, Type: "object" });
  });
  await fs.writeFile(service.credentialFile, JSON.stringify({ spicyLyricsSecretKey: "sl_sk_testkey", webPlayerToken: "session-token" }));
  const result = await service.lyrics(id);
  assert.equal(result.raw.source, "spicy_lyrics");
  await service.lyrics(id);
  assert.equal(requests, 1);
});

test("developer API maps not-found and rate-limit responses", async t => {
  let status = 404, calls = 0;
  const service = await setup(t, async () => { calls++; return json({}, status, status === 429 ? { "Retry-After": "90" } : {}); });
  await fs.writeFile(service.credentialFile, JSON.stringify({ spicyLyricsSecretKey: "sl_sk_testkey" }));
  assert.equal(await service.lyrics(id), null);
  assert.equal(await service.lyrics(id), null);
  assert.equal(calls, 1);
  status = 429;
  await assert.rejects(service.lyrics("abcdefghijkl0123456789"), e => e.code === "lyrics-rate-limited" && e.retryMs === 90000);
});
test("lyrics use only the session token and cache packed responses", async t => {
  let calls = 0;
  const service = await setup(t, async (url, init) => {
    calls++;
    assert.equal(url, "https://api.spicylyrics.org/query");
    assert.equal(init.headers["SpicyLyrics-WebAuth"], "Bearer session-token");
    assert.ok(!JSON.stringify(init).includes("dev-token"));
    assert.equal(JSON.parse(init.body).queries[0].variables.id, id);
    return json({ queries: [{ operationId: "0", result: { httpStatus: 200, data: new SLObjPack().pack(raw) } }] });
  });
  assert.deepEqual((await service.lyrics(id)).raw, raw);
  await service.lyrics(id);
  assert.equal(calls, 1);
});
test("missing web-player token never falls back to developer token", async t => {
  const service = await setup(t, () => { throw new Error("Network must not be called"); });
  await fs.writeFile(service.credentialFile, JSON.stringify({ accessToken: "dev-token" }));
  await assert.rejects(service.lyrics(id), { code: "lyrics-setup" });
});
test("lyrics keep using the Web Player bearer when separate OAuth credentials exist", async t => {
  const service = await setup(t, async (url, init) => {
    assert.equal(url, "https://api.spicylyrics.org/query");
    assert.equal(init.headers["SpicyLyrics-WebAuth"], "Bearer cookie-bearer");
    return json({ queries: [{ operationId: "0", result: { httpStatus: 200, data: raw } }] });
  });
  await fs.writeFile(service.credentialFile, JSON.stringify({ clientId: "developer-client", refreshToken: "refresh", webPlayerToken: "cookie-bearer" }));
  assert.deepEqual((await service.lyrics(id)).raw, raw);
});
test("new session token is picked up from file after an auth failure", async t => {
  let calls = 0;
  const service = await setup(t, async (_, init) => {
    calls++;
    if (calls === 1) return json({}, 401);
    assert.equal(init.headers["SpicyLyrics-WebAuth"], "Bearer rotated");
    return json({ queries: [{ operationId: "0", result: { httpStatus: 200, data: raw } }] });
  });
  await assert.rejects(service.lyrics(id), { code: "lyrics-auth" });
  await fs.writeFile(service.credentialFile, JSON.stringify({ webPlayerToken: "rotated" }));
  assert.deepEqual((await service.lyrics(id)).raw, raw);
});
test("rate limit blocks requests across track changes and respects Retry-After", async t => {
  let calls = 0;
  const service = await setup(t, async () => { calls++; return json({}, 429, { "Retry-After": "120" }); });
  await assert.rejects(service.lyrics(id), e => e.code === "lyrics-rate-limited" && e.retryMs === 120000);
  await assert.rejects(service.lyrics("abcdefghijkl0123456789"), { code: "lyrics-rate-limited" });
  assert.equal(calls, 1);
});
test("queued lyrics retry, while not-found results are cached", async t => {
  let status = 503, calls = 0;
  const service = await setup(t, async () => { calls++; return json({ queries: [{ operationId: "0", result: { httpStatus: status } }] }); });
  await assert.rejects(service.lyrics(id), { code: "lyrics-queued" });
  status = 404;
  assert.equal(await service.lyrics(id), null);
  assert.equal(await service.lyrics(id), null);
  assert.equal(calls, 2);
});
test("playback refreshes once on 401, preserves session token, and projects metadata", async t => {
  let reads = 0, refreshes = 0;
  const service = await setup(t, async (url, init) => {
    if (url.includes("/api/token")) { refreshes++; return json({ access_token: `access-${refreshes}`, refresh_token: "next-refresh", expires_in: 3600 }); }
    reads++;
    if (reads === 1) return json({}, 401);
    assert.equal(init.headers.Authorization, "Bearer access-2");
    return json({ is_playing: true, progress_ms: 1234, device: { name: "Speaker" }, item: {
      id, type: "track", name: "Demo", artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/image/demo" }] }, duration_ms: 200000 } });
  });
  await fs.writeFile(service.credentialFile, JSON.stringify({ clientId: "client", refreshToken: "refresh", webPlayerToken: "session" }));
  const result = await service.playback();
  assert.equal(result.track.lyricsId, id);
  assert.equal(result.progress, 1234);
  assert.equal(result.track.artist, "Artist");
  assert.equal(refreshes, 2);
  const stored = JSON.parse(await fs.readFile(service.credentialFile, "utf8"));
  assert.equal(stored.webPlayerToken, "session");
  assert.equal(stored.refreshToken, "next-refresh");
  assert.ok(!JSON.stringify(result).includes("access-"));
});
test("204 playback is idle and episodes do not request lyrics", async t => {
  let episode = false;
  const service = await setup(t, async () => episode ? json({ item: { type: "episode", id, name: "Podcast", duration_ms: 123, show: { publisher: "Publisher" } }, is_playing: false, progress_ms: 50 }) : new Response(null, { status: 204 }));
  assert.equal((await service.playback()).track, null);
  episode = true;
  const playback = await service.playback();
  assert.equal(playback.track.lyricsId, null);
  assert.equal(playback.playing, false);
});

test("session OAuth rotation is persisted to the same source and reused", async t => {
  let calls = 0;
  const service = await setup(t, async (_, init) => {
    assert.equal(init.body.get("refresh_token"), calls++ ? "rotated" : "original");
    return json({ access_token: "access", refresh_token: "rotated", expires_in: 3600 });
  });
  service.sessionFile = path.join(path.dirname(service.credentialFile), "session.json");
  const session = { SPOTIFY_CLIENT_ID: "client", SPOTIFY_REFRESH_TOKEN: "original", SPOTIFY_WEB_TOKEN: "cookie-token" };
  await fs.writeFile(service.sessionFile, JSON.stringify(session));
  service.setSessionCredentials(session);
  await service.playbackToken();
  service.setSessionCredentials(JSON.parse(await fs.readFile(service.sessionFile, "utf8")));
  await service.playbackToken(true);
  const saved = JSON.parse(await fs.readFile(service.sessionFile, "utf8"));
  assert.equal(saved.SPOTIFY_REFRESH_TOKEN, "rotated");
  assert.equal(saved.SPOTIFY_WEB_TOKEN, "cookie-token");
});
