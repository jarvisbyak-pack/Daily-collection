# AK Pack Fitness — Daily Collection (Modular Frontend)

This is a framework-free, multi-file version of the Daily Collection frontend. The UI is split into independent HTML view files, the styles live in `styles.css`, and application logic lives in `js/fresh-app.js`.

## Structure

- `index.html` — document shell and global overlays
- `styles.css` — all shared styling
- `views/app-shell.html` — app header and bottom navigation
- `views/tab-collection.html` — daily collection UI
- `views/tab-details.html` — collection details UI
- `views/tab-advances.html` — trainer advances UI
- `views/tab-members.html` — members UI
- `views/tab-admin.html` — admin and settings UI
- `backend/Code.gs` — optional Google Apps Script API (Sheets storage)
- `js/bootstrap.js` — loads view files, then starts the app
- `js/fresh-app.js` — local app state, event handlers, and rendering logic

## Personal Training

The **PT** tab holds trainers and their PT clients. A cycle runs from the 15th to the 14th of the next month, with a cycle switcher and a trainer filter. Choosing *Personal Training* as the purpose in Record collection asks for a trainer and adds the client to that trainer automatically. Every collected client is also added to Members.

## Cloud sync (optional)

See `backend/README.md`. Paste `backend/Code.gs` into a Google Sheet's Apps Script, deploy it as a web app, then enter the URL and access key in **Admin → Cloud sync**. Without it the app stays local-only.

## Configuration

The Google Apps Script Web App URL is entered by the user in Admin → Cloud sync (never hard-coded in the public frontend). Do not put credentials or private secrets in this public frontend. The URL is a deployment endpoint, not a secret; access control must be enforced by the Apps Script backend.

## Running and deployment

Because the UI files are loaded with `fetch()`, open the app through a local web server or static hosting such as GitHub Pages. Do not open `index.html` directly as a `file://` URL. Upload the complete folder structure, not just `index.html`, to keep the UI views and scripts available.

## Notes

This is a structural refactor: UI sections have been moved into separate files while preserving their IDs and the existing application logic. All tabs (payments, members, advances, cash handovers, close day) were tested in a headless browser.