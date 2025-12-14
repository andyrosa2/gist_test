"use strict";

const fs = require("fs");
const puppeteer = require("puppeteer-core");

const DEFAULT_URL = "https://andyrosa2.github.io/gist_test/";
const NAVIGATION_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 60_000;

const GITHUB_API_BASE_URL = "https://api.github.com";
const GISTS_API_PATH = "/gists";

const SEL_TOKEN_INPUT = "#tokenInput";
const SEL_SAVE_TOKEN_BTN = "#saveTokenBtn";
const SEL_SETUP_CARD = "#setupCard";
const SEL_CREATE_GIST_BTN = "#createGistBtn";
const SEL_SETUP_ERROR = "#setupError";
const SEL_NOTES_CARD = "#notesCard";

const ENV_GITHUB_PAT = "GIST_TEST_GITHUB_PAT";
const ENV_BROWSER_PATH = "BROWSER_PATH";

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}

function log(message) {
  process.stderr.write(`LOG: ${message}\n`);
}

function getRequiredEnv(name) {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name] ? String(process.env[name]).trim() : "";
  return value;
}

function getGithubToken() {
  return getRequiredEnv(ENV_GITHUB_PAT);
}

function getSetupErrorTextInPage() {
  const errorElement = document.querySelector("#setupError");
  if (!errorElement) {
    return "";
  }
  if (errorElement.classList.contains("hidden")) {
    return "";
  }
  return String(errorElement.textContent || "").trim();
}

async function githubApiRequest(token, path, options) {
  const response = await fetch(GITHUB_API_BASE_URL + path, {
    ...options,
    headers: {
      "Authorization": "token " + token,
      "Accept": "application/vnd.github+json",
      ...(options && options.headers ? options.headers : {}),
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const error = new Error("GitHub API error " + response.status + ": " + responseText);
    error.status = response.status;
    throw error;
  }

  return response;
}

async function deleteGist(token, gistId) {
  await githubApiRequest(token, GISTS_API_PATH + "/" + encodeURIComponent(gistId), {
    method: "DELETE",
  });
}

function findBrowserExecutablePath() {
  const envPath = getOptionalEnv(ENV_BROWSER_PATH);
  if (envPath) {
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    throw new Error(`${ENV_BROWSER_PATH} does not exist: ${envPath}`);
  }

  const candidatePaths = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    "Could not find a local browser executable. Set BROWSER_PATH to msedge.exe or chrome.exe, or install Edge/Chrome."
  );
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

async function assertHidden(page, selector, label) {
  try {
    await page.waitForSelector(selector, {
      hidden: true,
      timeout: SELECTOR_TIMEOUT_MS,
    });
  } catch (err) {
    fail(`${label} not hidden (${selector})`);
    throw err;
  }
}

async function waitForGistPost(page, label) {
  const expectedUrl = GITHUB_API_BASE_URL + GISTS_API_PATH;
  let response;
  const startedAtMs = Date.now();
  try {
    response = await page.waitForResponse(
      (resp) => {
        const request = resp.request();
        if (!request) {
          return false;
        }
        if (request.method() !== "POST") {
          return false;
        }
        const url = resp.url();
        return typeof url === "string" && url === expectedUrl;
      },
      { timeout: ACTION_TIMEOUT_MS }
    );
  } catch (err) {
    fail(`${label}: timed out waiting for gist POST request`);
    throw err;
  }

  const elapsedMs = Date.now() - startedAtMs;
  log(`${label}: gist POST HTTP ${response.status()} (${elapsedMs} ms): ${response.url()}`);

  if (!response.ok()) {
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }
    const details = responseText ? ": " + responseText : "";
    fail(`${label}: gist POST failed with HTTP ${response.status()}${details}`);
    throw new Error("Gist POST failed");
  }

  return response;
}

async function main() {
  const targetUrl = process.argv[2] ? String(process.argv[2]) : DEFAULT_URL;
  const githubToken = getGithubToken();
  let createdGistId = null;

  const executablePath = findBrowserExecutablePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    // Enter token via webpage UI.
    log("Entering token via webpage...");
    await assertVisible(page, SEL_TOKEN_INPUT, "Token input");
    await page.focus(SEL_TOKEN_INPUT);
    await page.keyboard.type(githubToken);
    await page.click(SEL_SAVE_TOKEN_BTN);

    // Setup card should be visible (no gist ID yet).
    await assertVisible(page, SEL_SETUP_CARD, "Setup card");
    await assertVisible(page, SEL_CREATE_GIST_BTN, "Create gist button");

    // Notes card should be hidden initially.
    const notesCardHidden = await page.$eval(SEL_NOTES_CARD, (element) => {
      return element.classList.contains("hidden");
    });
    if (!notesCardHidden) {
      fail("Notes card should be hidden before gist creation");
      return;
    }

    log("Clicking 'Create notes gist' button...");

    // Click create and wait for POST request.
    const [postResponse] = await Promise.all([
      waitForGistPost(page, "Create gist"),
      page.click(SEL_CREATE_GIST_BTN),
    ]);

    // Extract gist ID from response.
    const responseData = await postResponse.json();
    if (!responseData || !responseData.id) {
      fail("Gist POST response did not contain an id");
      return;
    }
    createdGistId = String(responseData.id);
    log(`Gist created with id: ${createdGistId}`);

    // Verify gist ID was stored in localStorage.
    const storedGistId = await page.evaluate(() => {
      return localStorage.getItem("NOTES_GIST_ID");
    });

    if (storedGistId !== createdGistId) {
      fail(`localStorage gist ID mismatch: expected ${createdGistId}, got ${storedGistId}`);
      return;
    }
    log("Gist ID correctly stored in localStorage");

    // Notes card should now be visible.
    await assertVisible(page, SEL_NOTES_CARD, "Notes card after creation");

    // Check no setup error displayed.
    const setupError = await page.evaluate(getSetupErrorTextInPage);
    if (setupError) {
      fail(`Setup error displayed: ${setupError}`);
      return;
    }

    process.stdout.write("PASS\n");
  } finally {
    await browser.close();

    // Clean up the gist created by the webpage.
    if (createdGistId) {
      try {
        await deleteGist(githubToken, createdGistId);
        log(`Deleted test gist: ${createdGistId}`);
      } catch (err) {
        fail(
          "Failed to delete webpage-created test gist " +
            createdGistId +
            ": " +
            String(err && err.message ? err.message : err)
        );
      }
    }
  }
}

main().catch((err) => {
  if (process.exitCode !== 1) {
    fail(err && err.stack ? err.stack : String(err));
  }
});
