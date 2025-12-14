"use strict";

const puppeteer = require("puppeteer-core");
const {
  DEFAULT_URL,
  NAVIGATION_TIMEOUT_MS,
  ACTION_TIMEOUT_MS,
  WAIT_POLLING_MS,
  SEL_TOKEN_INPUT,
  SEL_SAVE_TOKEN_BTN,
  SEL_GIST_ID_INPUT,
  SEL_USE_GIST_BTN,
  SEL_CREATE_GIST_BTN,
  SEL_NOTES_CARD,
  SEL_NOTE_TEXT,
  SEL_ADD_NOTE_BTN,
  SEL_NOTES_LIST_NOTE,
  SEL_NOTES_LIST_NOTE_PRE,
  ENV_NOTES_GIST_ID,
  fail,
  log,
  getOptionalEnv,
  getGithubToken,
  deleteGist,
  findBrowserExecutablePath,
  assertVisible,
  waitForEnabled,
  waitForGistPost,
  waitForGistPatch,
} = require("./test_utils");

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

      // Verify gist ID was stored in localStorage.
      const storedGistId = await page.evaluate(() => {
        return localStorage.getItem("NOTES_GIST_ID");
      });
      if (storedGistId !== gistId) {
        fail(`localStorage gist ID mismatch: expected ${gistId}, got ${storedGistId}`);
        throw new Error("localStorage verification failed");
      }
      log("Gist ID correctly stored in localStorage");
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
