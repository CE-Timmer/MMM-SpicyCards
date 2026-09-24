"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function helper() {
  const context = { module: { exports: {} }, require: name => name === "node_helper" ? { create: value => value } : name === "./lib/desktop-bridge" ? { startDesktopBridge: () => null } : name === "./lib/session-refresher" ? { SessionRefresher: class { start() {} stop() {} load() {} requestRefresh() {} } } : require(path.join(__dirname, "..", name)),
    setTimeout: (_, delay) => ({ delay }), clearTimeout() {}, Date, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../node_helper.js"), "utf8"), context);
  const instance = context.module.exports;
  instance.start();
  instance.sent = [];
  instance.sendSocketNotification = (type, data) => instance.sent.push({ type, data });
  instance.clients.add("test");
  return instance;
}
test("late lyrics for an old track cannot replace current lyrics", async () => {
  const h = helper();
  let resolveA;
  h.service = { lyrics: id => id === "A" ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ raw: { Type: "Static", Lines: [{ Text: "B" }] }, hasLyrics: true }) };
  h.currentId = "A";
  const old = h.fetchLyrics("A");
  h.currentId = "B";
  await h.fetchLyrics("B");
  resolveA({ raw: { Type: "Static", Lines: [{ Text: "A" }] }, hasLyrics: true });
  await old;
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].data.trackId, "B");
});
test("lyrics fetching never stalls playback polling", async () => {
  const h = helper();
  h.service = { playback: async () => ({ track: { id: "A", lyricsId: "A" }, playing: true }), lyrics: () => new Promise(() => {}) };
  await h.poll();
  assert.equal(h.sent[0].type, "SPOTIFYCARDS_PLAYBACK");
  assert.equal(h.timer.delay, 3000);
  assert.ok(h.lyricAttempt);
});
test("stop suppresses late results and prevents scheduling another poll", async () => {
  const h = helper();
  let finish;
  h.service = { playback: () => new Promise(resolve => { finish = resolve; }) };
  const poll = h.poll();
  h.stop();
  finish({ track: null });
  await poll;
  assert.equal(h.sent.length, 0);
  assert.equal(h.timer, undefined);
});
