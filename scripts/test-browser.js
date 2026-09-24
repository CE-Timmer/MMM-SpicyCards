"use strict";
const { chromium } = require("@playwright/test");
const { createPreviewServer } = require("./preview");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
async function main() {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : { channel: process.platform === "win32" ? "msedge" : "chromium" });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frameLocator("iframe");
    await frame.locator(".line").first().waitFor({ timeout: 15000 });
    await page.click("#pause");
    await page.locator("#seek").evaluate(el => { el.value = 10300; el.dispatchEvent(new Event("input")); });
    await frame.locator(".line.Active").filter({ hasText: "quiet" }).waitFor();
    await page.waitForTimeout(800);
    assert.equal(await frame.locator(".NowBar").isVisible(), false);
    await fs.mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/horizontal.png" });
    await frame.locator(".CardFullscreen").click();
    await frame.locator(".NowBar").waitFor({ state: "visible" });
    await frame.locator(".line").first().waitFor();
    await page.waitForTimeout(600);
    const metadata = await frame.locator(".NowBar").boundingBox();
    const lyrics = await frame.locator(".LyricsContainer").boundingBox();
    assert.ok(metadata.y + metadata.height <= lyrics.y + 1, "Metadata must sit above lyrics");
    assert.ok(await frame.locator(".MediaImageContainer img").count());
    await page.screenshot({ path: "artifacts/vertical.png" });
    await frame.locator(".CardFullscreen").click();
    await frame.locator(".NowBar").waitFor({ state: "hidden" });
    for (const type of ["Line", "Static", "No lyrics", "Syllable"]) {
      await page.selectOption("#type", type);
      if (type === "No lyrics") await frame.getByText("No lyrics for this song").waitFor();
      else await frame.locator(".line").first().waitFor();
    }
    await page.locator("#seek").evaluate(el => { el.value = 18000; el.dispatchEvent(new Event("input")); });
    await frame.locator(".line.Active").filter({ hasText: "light" }).waitFor();
    const sung = () => frame.locator(".line.Active .word").evaluateAll(words => words.map(word => word.style.getPropertyValue("--gradient-position")));
    const paused = await sung();
    await page.waitForTimeout(300);
    assert.deepEqual(await sung(), paused, "Word timing freezes while paused");
    await page.locator("#seek").evaluate(el => { el.value = 10300; el.dispatchEvent(new Event("input")); });
    await frame.locator(".line.Active").filter({ hasText: "quiet" }).waitFor();
    assert.equal(await frame.locator("#SpicyLyricsPage.Paused").count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#portrait");
    await frame.locator(".NowBar").waitFor({ state: "visible" });
    await frame.locator(".line.Active").filter({ hasText: "quiet" }).waitFor();
    const innerWidth = await frame.locator("#SpicyLyricsPage").evaluate(el => el.clientWidth);
    assert.ok(innerWidth <= 390, "Portrait fits the narrow viewport");
    await page.screenshot({ path: "artifacts/mobile.png" });
    assert.deepEqual(errors, [], "No browser errors");
    console.log("Browser checks passed: upstream renderer, both layouts, all lyric types, pause/seek, narrow viewport.");
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

