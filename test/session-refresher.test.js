"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SessionRefresher, settings } = require("../lib/session-refresher");
const { EventEmitter } = require("node:events");

test("loads the current Web Player token from session.json without exposing other fields", () => {
  let received, session;
  const refresher = new SessionRefresher({ onToken: value => { received = value; }, onSession: value => { session = value; }, readFileSync: () => JSON.stringify({ SPOTIFY_WEB_TOKEN: "Bearer current-token", SPOTIFY_REFRESH_TOKEN: "refresh", unrelated: "private" }) });
  refresher.load();
  assert.equal(received, "current-token");
  assert.equal(session.SPOTIFY_REFRESH_TOKEN, "refresh");
});

test("uses the requested 50-minute cycle and one-minute reload delay by default", () => {
  assert.deepEqual(settings("missing-config-directory"), { intervalMs: 3000000, delayMs: 60000 });
});

function harness(t, options = {}) {
  const children = [], tokens = [], errors = [];
  const refresher = new SessionRefresher({
    readFileSync: () => JSON.stringify({ SPOTIFY_WEB_TOKEN: "fresh", SPOTIFY_WEB_TOKEN_EXPIRES_AT: Date.now() + 300000 }),
    onToken: token => tokens.push(token), onError: error => errors.push(error),
    spawnImpl: () => { const child = new EventEmitter(); child.kill = () => { child.killed = true; }; children.push(child); return child; },
    ...options
  });
  t.after(() => refresher.stop());
  return { refresher, children, tokens, errors };
}

test("refresh immediately adopts a token and schedules before expiry without overlapping", t => {
  const { refresher, children, tokens } = harness(t);
  refresher.start();
  refresher.start();
  refresher.run();
  assert.equal(children.length, 1);
  children[0].emit("close", 0);
  assert.deepEqual(tokens, ["fresh", "fresh"]);
  assert.ok(refresher.timer._idleTimeout <= 180000);
  assert.ok(refresher.timer._idleTimeout >= 170000);
});

test("spawn errors and unsuccessful exits retry once after one minute", t => {
  const { refresher, children, tokens, errors } = harness(t);
  refresher.run();
  children[0].emit("error", new Error("spawn failed"));
  children[0].emit("close", -1);
  assert.equal(refresher.timer._idleTimeout, 60000);
  assert.equal(errors.length, 1);
  assert.equal(tokens.length, 0);
  refresher.run();
  children[1].emit("close", 1);
  assert.equal(errors.length, 2);
  assert.equal(refresher.timer._idleTimeout, 60000);
});

test("stop kills refresh and ignores late completion", t => {
  const { refresher, children, tokens } = harness(t);
  refresher.run();
  refresher.stop();
  assert.equal(children[0].killed, true);
  children[0].emit("close", 0);
  assert.equal(tokens.length, 0);
  assert.equal(refresher.delay, undefined);
  assert.equal(refresher.timer, undefined);
});

test("auth failures request early renewal without causing a refresh loop", t => {
  const { refresher, children } = harness(t);
  refresher.start();
  children[0].emit("close", 0);
  refresher.requestRefresh();
  assert.equal(children.length, 1);
  refresher.lastAttempt -= 61000;
  refresher.requestRefresh();
  assert.equal(children.length, 2);
});
