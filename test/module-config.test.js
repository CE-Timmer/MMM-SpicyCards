"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const os = require("node:os");
const { runtimePaths } = require("../lib/runtime-config");

test("MagicMirror config sends credentials to helper but never to the iframe renderer", () => {
  let module;
  class View { constructor(_root, options) { this.options = options; } }
  const context = { Module: { register: (_name, value) => { module = value; } }, SpotifyCardsView: View,
    document: { createElement: () => ({}) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../MMM-SpotifyCards.js"), "utf8"), context);
  module.config = { ...module.defaults, card: "vertical", sp_dc: "cookie-value", dev_token: "sl_sk_example_key" };
  module.file = value => value;
  let notification;
  module.identifier = "instance-1";
  module.sendSocketNotification = (type, payload) => { notification = { type, payload }; };
  module.getDom();
  module.notificationReceived("DOM_OBJECTS_CREATED");
  assert.equal(module.view.options.card, "vertical");
  assert.ok(!JSON.stringify(module.view.options).includes("cookie-value"));
  assert.ok(!JSON.stringify(module.view.options).includes("sl_sk_example_key"));
  assert.equal(notification.payload.sp_dc, "cookie-value");
  assert.equal(notification.payload.dev_token, "sl_sk_example_key");
});

test("runtime files stay outside the served module directory", () => {
  const directory = path.join(os.tmpdir(), "spotifycards-private");
  const files = runtimePaths({}, path.join(directory, "credentials.json"));
  assert.equal(files.configFile, path.join(directory, "config.json"));
  assert.equal(files.sessionFile, path.join(directory, "session.json"));
});
