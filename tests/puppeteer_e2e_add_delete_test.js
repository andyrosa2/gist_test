"use strict";

const fs = require("fs");
const puppeteer = require("puppeteer-core");

const DEFAULT_URL = "https://andyrosa2.github.io/gist_test/";
const NOTES_FILENAME = "notes.json";
const NOTES_SCHEMA_VERSION = 1;
const NAVIGATION_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 20_000;

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}

function getRequiredEnv(name) {
  const value = process.env[name] ? String(process.env[name]).trim() : "";
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
  const pup = getOptionalEnv("PUP");
  if (pup) {
    return pup;
  }
  return getRequiredEnv("GIST_TEST_GITHUB_TOKEN");
}

async function githubApiRequest(token, path, options) {
  const response = await fetch("https://api.github.com" + path, {
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

async function createTestNotesGist(token) {
  const emptyDoc = { version: NOTES_SCHEMA_VERSION, notes: [] };
  const response = await githubApiRequest(token, "/gists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "gist_test puppeteer e2e notes",
      public: false,
      files: {
        [NOTES_FILENAME]: {
          content: JSON.stringify(emptyDoc, null, 2),
        },
      },
    }),
  });

  const data = await response.json();
  if (!data || !data.id) {
    throw new Error("Unexpected response creating gist");
  }
  return String(data.id);
}

async function deleteGist(token, gistId) {
  await githubApiRequest(token, "/gists/" + encodeURIComponent(gistId), {
    method: "DELETE",
  });
}

function findBrowserExecutablePath() {
  const envPath = process.env.BROWSER_PATH ? String(process.env.BROWSER_PATH).trim() : "";
  if (envPath) {
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    throw new Error(`BROWSER_PATH does not exist: ${envPath}`);
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

async function waitForNoteCount(page, expectedCount, label) {
  const deadlineMs = Date.now() + ACTION_TIMEOUT_MS;
  while (Date.now() < deadlineMs) {
    const actualCount = await page.$$eval("#notesList .note", (elements) => elements.length);
    if (actualCount === expectedCount) {
      return;
    }
    await page.waitForTimeout(200);
  }
  const finalCount = await page.$$eval("#notesList .note", (elements) => elements.length);
  fail(`${label}: expected ${expectedCount} notes, got ${finalCount}`);
  throw new Error("Assertion failed");
}

async function main() {
  const targetUrl = process.argv[2] ? String(process.argv[2]) : DEFAULT_URL;
  const githubToken = getGithubToken();
  const providedGistId = getOptionalEnv("GIST_TEST_NOTES_GIST_ID");
  const shouldCreateGist = !providedGistId;
  const gistId = shouldCreateGist ? await createTestNotesGist(githubToken) : providedGistId;

  const executablePath = findBrowserExecutablePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    // Load once to establish origin, then inject localStorage and reload.
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    await page.evaluate(
      (token, notesGistId) => {
        localStorage.setItem("GITHUB_TOKEN", token);
        localStorage.setItem("NOTES_GIST_ID", notesGistId);
      },
      githubToken,
      gistId
    );

    await page.reload({ waitUntil: "domcontentloaded" });

    await assertVisible(page, "#notesCard", "Notes card");
    await assertVisible(page, "#noteText", "Note textarea");
    await assertVisible(page, "#addNoteBtn", "Add note button");

    // Record current count.
    const initialCount = await page.$$eval("#notesList .note", (elements) => elements.length);

    const marker = `e2e-test ${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await page.focus("#noteText");
    await page.keyboard.type(marker);

    await page.click("#addNoteBtn");

    // Wait for count to increase.
    await waitForNoteCount(page, initialCount + 1, "After add");

    // Ensure the marker text exists in the list.
    const found = await page.$$eval("#notesList .note pre", (elements, text) => {
      return elements.some((el) => String(el.textContent || "").includes(text));
    }, marker);

    if (!found) {
      fail("Added note not found in UI");
      return;
    }

    // Delete the newly added note by finding its container and clicking its Delete button.
    const deleted = await page.$$eval("#notesList .note", (noteElements, text) => {
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
