# Backend — Google Apps Script + Google Sheets

The app works fully offline on its own. This backend is optional and lets several devices share the same data through a Google Sheet.

## Setup (5 minutes)
1. Create a new Google Sheet (e.g. "AK PACK Daily Collection").
2. **Extensions → Apps Script**. Delete the default code and paste in `Code.gs`.
   (Optional: Project Settings → *Show appsscript.json* and paste `appsscript.json`.)
3. Select the function **setup** and press **Run**. Approve the permissions. Open **Execution log** and copy the line `ACCESS KEY: …`.
4. **Deploy → New deployment → Web app** — *Execute as:* Me, *Who has access:* Anyone. Copy the **Web app URL** (ends in `/exec`).
5. In the app open **Admin → Cloud sync**, paste the URL and the access key, tap **Connect**.

Existing data on the device is uploaded on first connect; data already in the sheet is downloaded and merged by ID.

## How it works
- Sheets created by `setup()`: Payments, Members, Advances, Handovers, Trainers, PTClients, Closings, Settings, Activity. (If you update an older deployment, deploy a **New version**; missing sheets are created automatically.) A hidden-style `_json` column keeps the exact record.
- The app sends only what changed since the last sync (`put` / `del` operations) and receives the full current state back. Last write wins.
- Every request needs the access key. 10 wrong keys lock the API for 10 minutes.
- If you edit the code, use **Deploy → Manage deployments → Edit → New version** so the same URL serves the new code.

## Security notes
- The web app URL is public by design; the access key is the password. Do not post either in public places.
- To rotate the key: change `ACCESS_KEY_OVERRIDE` (or delete the `ACCESS_KEY` script property), run `setup()` again, then reconnect each device.
- Deleting rows by hand in the sheet is fine; devices will receive the change on their next sync.