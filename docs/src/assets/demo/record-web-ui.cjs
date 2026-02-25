/**
 * Playwright script to record a web UI demo of the herdctl dashboard.
 *
 * Narrative:
 *   1. Land on Fleet Dashboard
 *   2. Click into the "homelab" agent
 *   3. Click into a chat session
 *   4. Navigate to "All Chats"
 *   5. Click on one of the visible sessions
 *
 * A warmup pass visits every page first (without recording) so all data
 * and assets are cached, eliminating loading delays in the final GIF.
 *
 * Usage: node demo/record-web-ui.cjs
 */

const { chromium } = require("playwright");

const OUTPUT_DIR = __dirname;
const BASE_URL = "http://localhost:3232";
const WIDTH = 1048;
const HEIGHT = 742;

async function record() {
  const browser = await chromium.launch({ headless: true });

  // ── Warmup pass (no recording) ──────────────────────────────────
  // Visit every page we'll hit during the recording so the browser
  // caches all JS bundles, API responses, fonts, etc.
  console.log("Warming up caches…");
  const warmupCtx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: "dark",
  });
  const warmupPage = await warmupCtx.newPage();

  // Dashboard
  await warmupPage.goto(BASE_URL);
  await warmupPage.waitForLoadState("networkidle");

  // Agent page
  await warmupPage.click('a[href="/agents/personal.homelab"]');
  await warmupPage.waitForLoadState("networkidle");

  // First chat session
  const warmupSession = warmupPage
    .locator('[data-testid="session-row"], .session-row, a[href*="/chat/"]')
    .first();
  if (await warmupSession.isVisible({ timeout: 3000 }).catch(() => false)) {
    await warmupSession.click();
    await warmupPage.waitForLoadState("networkidle");
  } else {
    const warmupLink = warmupPage.locator("main a").first();
    if (await warmupLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await warmupLink.click();
      await warmupPage.waitForLoadState("networkidle");
    }
  }

  // All Chats
  await warmupPage.goto(`${BASE_URL}/chats`);
  await warmupPage.waitForLoadState("networkidle");

  // Click a session from All Chats
  const warmupAllChats = warmupPage
    .locator('main a, main [role="button"], main button')
    .first();
  if (await warmupAllChats.isVisible({ timeout: 3000 }).catch(() => false)) {
    await warmupAllChats.click();
    await warmupPage.waitForLoadState("networkidle");
  }

  await warmupCtx.close();
  console.log("Warmup complete. Starting recording…");

  // ── Recorded pass ───────────────────────────────────────────────
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: WIDTH, height: HEIGHT },
    },
    colorScheme: "dark",
  });

  const page = await context.newPage();

  // 1. Land on the dashboard
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  // 2. Click into "homelab" agent
  await page.click('a[href="/agents/personal.homelab"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // 3. Click on the first chat session visible
  const firstSession = page
    .locator('[data-testid="session-row"], .session-row, a[href*="/chat/"]')
    .first();
  if (await firstSession.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstSession.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
  } else {
    const chatLink = page.locator("main a").first();
    if (await chatLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await chatLink.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(2000);
    }
  }

  // 4. Navigate to "All Chats"
  await page.click('a[href="/chats"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);

  // 5. Click on one of the first visible sessions
  const allChatsSession = page
    .locator('main a, main [role="button"], main button')
    .first();
  if (
    await allChatsSession.isVisible({ timeout: 3000 }).catch(() => false)
  ) {
    await allChatsSession.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
  } else {
    await page.waitForTimeout(3000);
  }

  // Close to finalize the video
  await context.close();
  await browser.close();

  console.log(`Video saved to ${OUTPUT_DIR}/`);
}

record().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
