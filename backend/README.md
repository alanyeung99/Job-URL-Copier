# Job URL Copier — Backend

Node.js proxy for Google Sheets. **Users sign in with Google in the extension**; this server uses their OAuth access token on each request. No `service-account.json` required.

## Setup

### 1. Google Cloud OAuth client

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth client type **Web application**
3. Add redirect URI: `https://jkfiobbalfifpgfdnjfmmcokdbojbnca.chromiumapp.org/`
4. Enable **Google Sheets API**
5. Copy the client ID into `extension/google-config.js` and `extension/manifest.json`

### 2. Configure environment

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

- `API_KEY` — must match `BACKEND_API_KEY` in `extension/google-config.js`
- `GOOGLE_CLIENT_ID` — same as `GOOGLE_CLIENT_ID` in `extension/google-config.js`
- `GOOGLE_CLIENT_SECRET` — from Google Cloud → your OAuth **Web application** client (never put this in the extension)

Redirect URI in Google Cloud:

`https://jkfiobbalfifpgfdnjfmmcokdbojbnca.chromiumapp.org/`

### 3. Run

```bash
npm install
npm start
```

## API

Every `/api/*` request requires:

```http
X-API-Key: your-backend-api-key
Authorization: Bearer <user-google-access-token>
```

The extension obtains the Google token after the user signs in.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sheets?spreadsheetId=...` | List tabs in the user's spreadsheet |
| POST | `/api/jobs` | Append one job row |

### POST /api/jobs

```json
{
  "spreadsheetId": "abc123...",
  "sheetId": "0",
  "sheetName": "Sheet1",
  "job": {
    "company": "Acme",
    "jobTitle": "Engineer",
    "jobUrl": "https://...",
    "jobType": "Full-time",
    "salary": "$120k",
    "level": "Senior"
  }
}
```

## User flow

1. Sign in with Google in the extension
2. Paste their Google Sheets link
3. Pick a tab → copy jobs

No sharing with a service account email required.
