"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { createDesktopReceiver } = require("../lib/desktop-bridge");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spotifycards-bridge-ui-"));
  const tokenFile = path.join(directory, "session.json"), pairingKey = "b".repeat(64);
  const token = "synthetic-desktop-session-never-a-real-token";
  const server = createDesktopReceiver({ pairingKey, tokenFile });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : { channel: process.platform === "win32" ? "msedge" : "chromium" });
    const context = await browser.newContext();
    await context.grantPermissions(["local-network-access"], { origin: "https://xpui.app.spotify.com" });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("https://xpui.app.spotify.com/**", route => route.fulfill({ contentType: "text/html", body: '<html><head></head><body style="background:#121212;color:white;font:16px sans-serif;padding:32px"><h1>Spotify desktop extension test</h1><div id="menu"></div><main></main></body></html>' }));
    await page.goto("https://xpui.app.spotify.com/");
    await page.evaluate(token => {
      window.Spicetify = {
        Platform: { AuthorizationAPI: { getState: () => ({ token: { accessToken: token, accessTokenExpirationTimestampMs: Date.now() + 3600000 } }) } },
        LocalStorage: { get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value) },
        Menu: { Item: class { constructor(name, checked, click) { this.name = name; this.click = click; } register() { const button = document.createElement("button"); button.textContent = this.name; button.onclick = this.click; document.querySelector("#menu").append(button); } } },
        PopupModal: { display: ({ content }) => document.querySelector("main").replaceChildren(content) }
      };
    }, token);
    await page.addScriptTag({ path: path.join(__dirname, "../spicetify/spotifycards-bridge.js") });
    await page.getByRole("button", { name: "SpotifyCards Bridge", exact: true }).click();
    await page.getByLabel("Mirror address (include bridge port)").fill(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel("Pairing key", { exact: true }).fill(pairingKey);
    await page.getByRole("button", { name: "Save and send now" }).click();
    try { await page.getByRole("status").filter({ hasText: "Session delivered" }).waitFor({ timeout: 15000 }); }
    catch (error) { console.error("Bridge status:", await page.getByRole("status").innerText()); throw error; }
    assert.equal(JSON.parse(await fs.readFile(tokenFile, "utf8")).accessToken, token);
    assert.ok(!(await page.locator("body").innerText()).includes(token));
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(token));
    assert.equal(await page.getByLabel("Pairing key", { exact: true }).getAttribute("type"), "password");
    await page.getByLabel("Pairing key", { exact: true }).fill("c".repeat(64));
    await page.getByRole("button", { name: "Save and send now" }).click();
    await page.getByRole("status").filter({ hasText: "Pairing key was rejected" }).waitFor();
    await page.getByLabel("Forward desktop session to this mirror").uncheck();
    await page.getByRole("button", { name: "Save and send now" }).click();
    await page.getByRole("status").filter({ hasText: "disabled" }).waitFor();
    await fs.mkdir(path.join(__dirname, "../artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../artifacts/desktop-bridge.png") });
    assert.deepEqual(errors, []);
    console.log("Bridge browser checks passed: settings, real CORS delivery, pairing error, disable, and no token in UI/localStorage.");
  } finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
