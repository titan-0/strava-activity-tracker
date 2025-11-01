# Strava Activity Tracker (Backend)

This repository runs a small Express backend that connects with Strava via OAuth, stores athlete activities in MongoDB, and (optionally) appends newly saved activities to a Google Sheet.

## What this service does

- Redirects users to Strava to authorize the app: GET `/auth/strava`.
- Exchanges Strava authorization code for access & refresh tokens (callback: `/auth/strava/callback`).

- Persists new activities to MongoDB.
- Optionally appends newly persisted activities to a Google Sheet (service account).

## Requirements

- Node.js 18+ (the project uses ESM modules)
- MongoDB connection (Atlas or local)
- A Google Cloud service account with the Sheets API enabled (if you want Sheets integration)
- A Strava app (Client ID & Client Secret)

## Environment variables

Create a `.env` file at the project root with the following variables (example below).

- `MONGO_URI` — MongoDB connection string (required)
- `STRAVA_CLIENT_ID` — Strava app client id (required for OAuth)
- `STRAVA_CLIENT_SECRET` — Strava app client secret (required for OAuth)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — either the JSON content of the service account key (string) OR a path to the service account JSON file (optional; required for Sheets integration)
- `SHEET_ID` — Google Sheets spreadsheet id (optional; required for append)
- `SHEET_NAME` — sheet name/tab (optional; defaults to `Sheet1`)
- `PORT` — port to run the express server (optional; defaults to 5000)

### Example `.env`

# Use the file editor to create `.env`

MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/mydb?retryWrites=true&w=majority
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=abcdefg
# Either put the full JSON contents (escape newlines) or a path to the file:
# GOOGLE_SERVICE_ACCOUNT_JSON=C:\keys\gsa-key.json
# or (single-line JSON string with escaped newlines):
# GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"..."}
SHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
SHEET_NAME=Sheet1
PORT=5000

> Note: If you use the JSON string form for `GOOGLE_SERVICE_ACCOUNT_JSON`, ensure `private_key` contains `\n` escaped newlines (or use a file path instead).

## Install & run

Open PowerShell in the project folder and run:

```powershell
npm install
# dev (auto-restarts)
npx nodemon
# or production
node index.js
```

Server runs on `http://localhost:5000` by default.

## Google Sheets setup (short)

1. In Google Cloud Console create a service account with the `Sheets API` enabled.
2. Create a service account key (JSON) and either set `GOOGLE_SERVICE_ACCOUNT_JSON` to the file path or paste the JSON as a single-line string in the env variable.
3. Share the target spreadsheet with the service account `client_email` (e.g. `my-service-account@project.iam.gserviceaccount.com`) with Editor access.
4. Set `SHEET_ID` to the spreadsheet id (the long id in the sheet URL).

## Endpoints

- `GET /auth/strava` — redirect the user to Strava to authorize the app
- `GET /auth/strava/callback?code=...` — Strava redirects here with the code. This route exchanges the code for tokens and stores tokens in Mongo for the user.
- `GET /activities/:stravaId` — fetches the athlete activities from Strava, stores any new activities in Mongo, and appends newly saved activities to the configured Google Sheet.

## Troubleshooting

- If you see: `MONGO_URI environment variable is not set. Set it in your .env...` — create `.env` and provide `MONGO_URI`.
- If Node warns about module type, `package.json` contains `"type":"module"` to run ESM imports. Keep it as-is, or convert `index.js` to CommonJS requires.
- If Google Sheets append fails, check that:
  - `GOOGLE_SERVICE_ACCOUNT_JSON` is valid (or file path readable)
  - `SHEET_ID` is correct
  - The spreadsheet is shared with the service account's email (client_email)

## Security notes

- Do NOT commit your `.env` or Google service account JSON to source control.
- Treat your `STRAVA_CLIENT_SECRET` and `MONGO_URI` credentials as secrets.

## Next improvements (suggested)

- Add an `.env.example` with keys only (no secrets).
- Add retry/backoff for Google Sheets appends.
- Add tests and shape validation for stored activities.

---

If you want, I can also create a `.env.example` file and add a small note to `package.json` scripts to run a health-check endpoint. Would you like me to add `.env.example` now?