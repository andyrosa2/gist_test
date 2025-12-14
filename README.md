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

## Setup / first run
1. Open the live site.
2. Create a GitHub token with `gist` scope:
   - https://github.com/settings/tokens
3. Paste the token into the app and click "Save token".
4. Click "Create notes gist" (recommended), or paste an existing Gist ID and click "Use gist id".

## Local development
Open [index.html](index.html) directly in a browser.

## Notes
- The token and Gist ID are stored in browser localStorage on your machine.
- If the GitHub API returns 401/403, the app clears the stored token so you can re-enter it.
