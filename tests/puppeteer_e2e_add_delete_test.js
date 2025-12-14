"use strict";

const fs = require("fs");
const puppeteer = require("puppeteer-core");

const DEFAULT_URL = "https://andyrosa2.github.io/gist_test/";
const NAVIGATION_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 60_000;
const WAIT_POLLING_MS = 100;

const GITHUB_API_BASE_URL = "https://api.github.com";
const GISTS_API_PATH = "/gists";

const SEL_TOKEN_INPUT = "#tokenInput";
const SEL_SAVE_TOKEN_BTN = "#saveTokenBtn";
const SEL_GIST_ID_INPUT = "#gistIdInput";
const SEL_USE_GIST_BTN = "#useGistBtn";
const SEL_CREATE_GIST_BTN = "#createGistBtn";
const SEL_NOTES_CARD = "#notesCard";
const SEL_NOTE_TEXT = "#noteText";
const SEL_ADD_NOTE_BTN = "#addNoteBtn";
const SEL_NOTES_ERROR = "#notesError";
const SEL_NOTES_LIST_NOTE = "#notesList .note";
const SEL_NOTES_LIST_NOTE_PRE = "#notesList .note pre";

const ENV_GITHUB_PAT = "GIST_TEST_GITHUB_PAT";
const ENV_NOTES_GIST_ID = "GIST_TEST_NOTES_GIST_ID";
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

function getNotesErrorTextInPage() {
  const errorElement = document.querySelector("#notesError");
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

async function waitForEnabled(page, selector, label) {
  try {
    await page.waitForFunction(
      (sel) => {
        const element = document.querySelector(sel);
        return !!element && element.disabled === false;
      },
      { timeout: ACTION_TIMEOUT_MS },
      selector
    );
  } catch (err) {
    fail(`${label} did not become enabled (${selector})`);
    throw err;
  }
}

async function waitForGistPatch(page, gistId, label) {
  const expectedUrlPrefix = GITHUB_API_BASE_URL + GISTS_API_PATH + "/" + encodeURIComponent(gistId);
  let response;
  const startedAtMs = Date.now();
  try {
    response = await page.waitForResponse(
      (resp) => {
        const request = resp.request();
        if (!request) {
          return false;
        }
        if (request.method() !== "PATCH") {
          return false;
        }
        const url = resp.url();
        return typeof url === "string" && url.startsWith(expectedUrlPrefix);
      },
      { timeout: ACTION_TIMEOUT_MS }
    );
  } catch (err) {
    fail(`${label}: timed out waiting for gist PATCH request`);
    throw err;
  }

  const elapsedMs = Date.now() - startedAtMs;
  log(`${label}: gist PATCH HTTP ${response.status()} (${elapsedMs} ms): ${response.url()}`);

  if (!response.ok()) {
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }
    const details = responseText ? ": " + responseText : "";
    fail(`${label}: gist PATCH failed with HTTP ${response.status()}${details}`);
    throw new Error("Gist PATCH failed");
  }

  return response;
}

async function waitForAddAndGistPatch(page, gistId) {
  await Promise.all([
    waitForGistPatch(page, gistId, "After add"),
    page.click(SEL_ADD_NOTE_BTN),
  ]);
}

async function waitForNoteCount(page, expectedCount, label) {
  const waitOptions = { timeout: ACTION_TIMEOUT_MS, polling: WAIT_POLLING_MS };

  const noteCountPromise = page.waitForFunction(
    (selector, count) => {
      return document.querySelectorAll(selector).length === count;
    },
    waitOptions,
    SEL_NOTES_LIST_NOTE,
    expectedCount
  );

  const errorPromise = page
    .waitForFunction(
      getNotesErrorTextInPage,
      waitOptions
    )
    .then(async () => {
      const errorText = await page.evaluate(getNotesErrorTextInPage);
      const message = errorText ? errorText : "Unknown error";
      throw new Error(`${label}: app error: ${message}`);
    });

  try {
    await Promise.race([noteCountPromise, errorPromise]);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (message.includes(": app error:")) {
      fail(message);
      throw err;
    }

    const finalCount = await page.$$eval(SEL_NOTES_LIST_NOTE, (elements) => elements.length);
    fail(`${label}: expected ${expectedCount} notes, got ${finalCount}`);
    throw new Error("Assertion failed");
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
  const providedGistId = getOptionalEnv(ENV_NOTES_GIST_ID);
  const shouldCreateGist = !providedGistId;
  let gistId = providedGistId;

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

    // If gist ID provided, enter it via webpage UI.
    if (gistId) {
      log("Entering gist ID via webpage...");
      await assertVisible(page, SEL_GIST_ID_INPUT, "Gist ID input");
      await page.focus(SEL_GIST_ID_INPUT);
      await page.keyboard.type(gistId);
      await page.click(SEL_USE_GIST_BTN);
    } else {
      // Create gist via the webpage.
      log("Creating gist via webpage...");
      await assertVisible(page, SEL_CREATE_GIST_BTN, "Create gist button");

      const [postResponse] = await Promise.all([
        waitForGistPost(page, "Create gist"),
        page.click(SEL_CREATE_GIST_BTN),
      ]);

      const responseData = await postResponse.json();
      if (!responseData || !responseData.id) {
        fail("Gist POST response did not contain an id");
        throw new Error("Gist creation failed");
      }
      gistId = String(responseData.id);
      log(`Gist created: ${gistId}`);
    }

    await assertVisible(page, SEL_NOTES_CARD, "Notes card");
    await assertVisible(page, SEL_NOTE_TEXT, "Note textarea");
    await assertVisible(page, SEL_ADD_NOTE_BTN, "Add note button");

    // Record current count.
    const initialCount = await page.$$eval(SEL_NOTES_LIST_NOTE, (elements) => elements.length);

    const marker = `e2e-test ${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await page.focus(SEL_NOTE_TEXT);
    await page.keyboard.type(marker);

    await waitForEnabled(page, SEL_ADD_NOTE_BTN, "Add note button");

    await waitForAddAndGistPatch(page, gistId);

    // Wait for count to increase.
    await waitForNoteCount(page, initialCount + 1, "After add");

    // Ensure the marker text exists in the list.
    const found = await page.$$eval(SEL_NOTES_LIST_NOTE_PRE, (elements, text) => {
      return elements.some((el) => String(el.textContent || "").includes(text));
    }, marker);

    if (!found) {
      fail("Added note not found in UI");
      return;
    }

    // Delete the newly added note by finding its container and clicking its Delete button.
    const deleted = await page.$$eval(SEL_NOTES_LIST_NOTE, (noteElements, text) => {
      for (const noteElement of noteElements) {
        const pre = noteElement.querySelector("pre");
        const deleteButton = noteElement.querySelector("button");
        if (pre && deleteButton && String(pre.textContent || "").includes(text)) {
          deleteButton.click();
          return true;
        }
      }
      return false;
    }, marker);

    if (!deleted) {
      fail("Could not locate note to delete");
      return;
    }

    await waitForGistPatch(page, gistId, "After delete");

    await waitForNoteCount(page, initialCount, "After delete");

    process.stdout.write("PASS\n");
  } finally {
    await browser.close();

    if (shouldCreateGist) {
      try {
        await deleteGist(githubToken, gistId);
      } catch (err) {
        fail(
          "Failed to delete auto-created test gist " +
            gistId +
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
