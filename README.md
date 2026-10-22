# AK Pack Fitness — Daily Collection (Modular Frontend)

This is a framework-free, multi-file version of the Daily Collection frontend. The UI is split into independent HTML view files, the styles live in `styles.css`, and application logic lives in `js/app.js`.

## Structure

- `index.html` — document shell and global overlays
- `styles.css` — all shared styling
- `views/login.html` — staff login UI
- `views/app-shell.html` — app header and bottom navigation
- `views/tab-collection.html` — daily collection UI
- `views/tab-details.html` — collection details UI
- `views/tab-advances.html` — trainer advances UI
- `views/tab-members.html` — members UI
- `views/tab-admin.html` — admin and settings UI
- `js/bootstrap.js` — loads view files, then starts the app
- `js/app.js` — API calls, state, event handlers, and rendering logic

## Configuration

The Google Apps Script Web App URL remains configured in `js/app.js` as `SCRIPT_URL`. Do not put credentials or private secrets in this public frontend. The URL is a deployment endpoint, not a secret; access control must be enforced by the Apps Script backend.

## Running and deployment

Because the UI files are loaded with `fetch()`, open the app through a local web server or static hosting such as GitHub Pages. Do not open `index.html` directly as a `file://` URL. Upload the complete folder structure, not just `index.html`, to keep the UI views and scripts available.

## Notes

This is a structural refactor: UI sections have been moved into separate files while preserving their IDs and the existing application logic. Complete browser and live Apps Script integration testing is still required before production use.
