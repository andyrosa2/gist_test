# Notes (Gist-backed)

Single-page notes app with two features:

- Add note
- Delete note

Notes are stored in a single GitHub Gist file named `notes.json`.

Live site (GitHub Pages):

- https://andyrosa2.github.io/gist_test/

Repo:

- https://github.com/andyrosa2/gist_test

## How it works

- You provide your own GitHub token (needs `gist` scope)
- The app creates (or uses) a private Gist
- Each add/delete updates `notes.json` in that Gist via the GitHub API

## Architecture

Storage

- A single GitHub Gist contains a single file named `notes.json`
- The app reads/writes that file via the GitHub REST API

Authentication

- You paste a GitHub token into the app
- The token is stored in localStorage in your browser

Data format

```json
{
   "version": 1,
   "notes": [
      {
         "id": "1734140000000",
         "createdAt": "2025-12-14T01:42:23.000Z",
         "text": "example note"
      }
   ]
}
```

API endpoints used

- Create gist: `POST https://api.github.com/gists`
- Read gist: `GET https://api.github.com/gists/{gist_id}`
- Update gist: `PATCH https://api.github.com/gists/{gist_id}`

## Setup / first run

1. Open the live site.
2. Create a GitHub token with `gist` scope:
   - https://github.com/settings/tokens
3. Paste the token into the app and click "Save token".
4. Click "Create notes gist" (recommended), or paste an existing Gist ID and click "Use gist id".

## Local development

Open [index.html](index.html) directly in a browser.

## Smoke test (Puppeteer)

This repo includes a simple Puppeteer smoke test that uses `puppeteer-core` (no bundled Chromium download).

Install dependencies:
- `npm install`

Run the test:
- `npm run test:smoke`

By default it tries to launch Microsoft Edge or Google Chrome from common Windows install paths.
If your browser is elsewhere, set `BROWSER_PATH` to the full path of `msedge.exe` or `chrome.exe`.

## End-to-end test (add + delete)

This test exercises the real add and delete flow against a real Gist, so it requires credentials and a dedicated test Gist.

Required environment variables:
- `GIST_TEST_GITHUB_TOKEN` (must have `gist` scope)
- `GIST_TEST_NOTES_GIST_ID` (the Gist ID that contains `notes.json`)

Run it:
- `npm run test:e2e`

## Deployment

This repo is deployed using GitHub Pages from the `main` branch root.

## Notes

- The token and Gist ID are stored in browser localStorage on your machine.
- If the GitHub API returns 401/403, the app clears the stored token so you can re-enter it.
