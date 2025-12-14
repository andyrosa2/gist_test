"use strict";

const puppeteer = require("puppeteer");

const DEFAULT_URL = "https://andyrosa2.github.io/gist_test/";
const NAVIGATION_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 15_000;

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}

async function assertVisible(page, selector, label) {
  try {
    await page.waitForSelector(selector, {
      visible: true,
      timeout: SELECTOR_TIMEOUT_MS,
    });
  } catch (err) {
    fail(`${label} not visible (${selector})`);
    throw err;
  }
}

async function assertDisabled(page, selector, label) {
  const isDisabled = await page.$eval(selector, (element) => element.disabled === true);
  if (!isDisabled) {
    fail(`${label} expected disabled (${selector})`);
    throw new Error("Assertion failed");
  }
}

async function assertEnabled(page, selector, label) {
  const isEnabled = await page.$eval(selector, (element) => element.disabled === false);
  if (!isEnabled) {
    fail(`${label} expected enabled (${selector})`);
    throw new Error("Assertion failed");
  }
}

async function main() {
  const targetUrl = process.argv[2] ? String(process.argv[2]) : DEFAULT_URL;

  const browser = await puppeteer.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    const title = await page.title();
    if (title !== "Notes") {
      fail(`Unexpected title: ${title}`);
      return;
    }

    await assertVisible(page, "#setupCard", "Setup card");
    await assertVisible(page, "#tokenInput", "Token input");
    await assertVisible(page, "#saveTokenBtn", "Save token button");
    await assertVisible(page, "#clearTokenBtn", "Clear token button");
    await assertVisible(page, "#gistIdInput", "Gist id input");
    await assertVisible(page, "#useGistBtn", "Use gist id button");
    await assertVisible(page, "#createGistBtn", "Create notes gist button");

    // With no token+gist configured, notes card should remain hidden.
    const notesCardHidden = await page.$eval("#notesCard", (element) => element.classList.contains("hidden"));
    if (!notesCardHidden) {
      fail("Notes card expected hidden before token/gist setup");
      return;
    }

    // The add note button exists but should be disabled while notesCard is hidden.
    await assertDisabled(page, "#addNoteBtn", "Add note button");

    process.stdout.write("PASS\n");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  if (process.exitCode !== 1) {
    fail(err && err.stack ? err.stack : String(err));
  }
});
