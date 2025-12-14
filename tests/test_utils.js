"use strict";

const fs = require("fs");

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
const SEL_SETUP_CARD = "#setupCard";
const SEL_SETUP_ERROR = "#setupError";
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
  process.stdout.write(`LOG: ${message}\n`);
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

module.exports = {
  DEFAULT_URL,
  NAVIGATION_TIMEOUT_MS,
  SELECTOR_TIMEOUT_MS,
  ACTION_TIMEOUT_MS,
  WAIT_POLLING_MS,
  GITHUB_API_BASE_URL,
  GISTS_API_PATH,
  SEL_TOKEN_INPUT,
  SEL_SAVE_TOKEN_BTN,
  SEL_GIST_ID_INPUT,
  SEL_USE_GIST_BTN,
  SEL_CREATE_GIST_BTN,
  SEL_SETUP_CARD,
  SEL_SETUP_ERROR,
  SEL_NOTES_CARD,
  SEL_NOTE_TEXT,
  SEL_ADD_NOTE_BTN,
  SEL_NOTES_ERROR,
  SEL_NOTES_LIST_NOTE,
  SEL_NOTES_LIST_NOTE_PRE,
  ENV_GITHUB_PAT,
  ENV_NOTES_GIST_ID,
  ENV_BROWSER_PATH,
  fail,
  log,
  getRequiredEnv,
  getOptionalEnv,
  getGithubToken,
  githubApiRequest,
  deleteGist,
  findBrowserExecutablePath,
  assertVisible,
  assertHidden,
  waitForEnabled,
  waitForGistPost,
  waitForGistPatch,
};
