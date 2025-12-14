# Simple Notes App - Plan

## Overview
A single-page HTML notes application that stores data in a GitHub Gist.

## Features
1. Add note
2. Delete note

## Architecture

### Storage: GitHub Gist
- Notes stored as JSON in a single Gist file (e.g., `notes.json`)
- Gist API requires authentication via Personal Access Token (PAT)
- PAT must have `gist` scope

### Authentication Flow
1. User enters their GitHub PAT on first use
2. PAT stored in localStorage (browser)
3. User creates or specifies an existing Gist ID
4. Gist ID stored in localStorage

### Data Format
```json
{
  "notes": [
    { "id": "timestamp", "text": "note content" }
  ]
}
```

### API Endpoints
- Create Gist: `POST https://api.github.com/gists`
- Read Gist: `GET https://api.github.com/gists/{gist_id}`
- Update Gist: `PATCH https://api.github.com/gists/{gist_id}`

## Files
- `index.html` - Single HTML file with embedded CSS and JavaScript

## Deployment
1. Push to GitHub repository
2. Enable GitHub Pages (Settings → Pages → Deploy from branch)
3. Site available at `https://{username}.github.io/{repo}/`

## User Setup Requirements
1. Create a GitHub Personal Access Token with `gist` scope
2. On first app use, enter PAT
3. Either create new Gist or enter existing Gist ID

## Security Notes
- PAT is stored in browser localStorage (user's machine only)
- The HTML page itself contains no secrets
- Each user uses their own PAT and Gist

## Implementation Steps
1. Create index.html with basic structure
2. Add CSS styling
3. Implement PAT/Gist configuration UI
4. Implement Gist API functions (read, update)
5. Implement add note UI and logic
6. Implement delete note UI and logic
7. Initialize GitHub repo and push
8. Enable GitHub Pages
