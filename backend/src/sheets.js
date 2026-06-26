import { google } from 'googleapis';

function resolveSpreadsheetId(spreadsheetId) {
  const id = String(spreadsheetId || '').trim();
  if (!id) {
    throw new Error('spreadsheetId is required. Enter a spreadsheet ID in the extension.');
  }
  return id;
}

function getSheetsClient(accessToken) {
  if (!accessToken) {
    throw new Error('Missing Google access token. Sign in with Google in the extension.');
  }

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth: oauth2 });
}

function mapSheetsFromApiData(data) {
  return (data.sheets || [])
    .map((entry) => {
      const props = entry.properties || {};
      const sheetId = String(props.sheetId);
      const sheetName = props.title || `Sheet ${sheetId}`;
      return {
        id: sheetId,
        name: sheetName,
        sheetId,
        sheetName
      };
    })
    .filter((sheet) => sheet.sheetName);
}

function getTodayDateString() {
  const d = new Date();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

function toDateKey(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}`;
  }
  const parts = String(value).trim().split(/[/-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map((p) => Number.parseInt(p, 10));
    if (c > 31) {
      const d = new Date(c, a - 1, b);
      if (!Number.isNaN(d.getTime())) {
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }
    }
  }
  return String(value).trim();
}

function getNextDailyNumber(rows, todayDate) {
  const todayKey = toDateKey(todayDate);

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const [dateCell, noCell] = rows[i] || [];
    if (!dateCell && (noCell === undefined || noCell === '')) {
      continue;
    }
    if (toDateKey(dateCell) === todayKey) {
      const previous = Number.parseInt(String(noCell), 10);
      return Number.isFinite(previous) ? previous + 1 : 1;
    }
    return 1;
  }

  return 1;
}

async function fetchSheetDateAndNoColumns(sheets, spreadsheetId, sheetName) {
  const escaped = String(sheetName).replace(/'/g, "''");
  const range = `'${escaped}'!A2:B`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return response.data.values || [];
}

async function getNextRowNumberForSheet(sheets, spreadsheetId, sheetName) {
  const todayDate = getTodayDateString();
  const rows = await fetchSheetDateAndNoColumns(sheets, spreadsheetId, sheetName);
  return {
    todayDate,
    nextNo: getNextDailyNumber(rows, todayDate)
  };
}

function jobToRowValues(job, todayDate, nextNo) {
  return [
    todayDate,
    nextNo,
    job.company || '',
    job.jobTitle || '',
    job.jobUrl || '',
    job.jobType || '',
    job.salary || '',
    job.level || ''
  ];
}

function formatGoogleError(error) {
  const googleMessage = error?.response?.data?.error?.message || error?.message || '';
  const status = error?.response?.status || error?.code;
  const msg = String(googleMessage);

  if (/insufficient|authentication scopes|scope/i.test(msg)) {
    return (
      'Google sign-in is missing spreadsheet permission. Sign out in the extension, sign in again, ' +
      'and allow Google Sheets access when prompted.'
    );
  }

  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) {
    return (
      'Google Sheets API is not enabled for this OAuth app. In Google Cloud Console (same project as your OAuth client), ' +
      'open APIs & Services → Library → enable "Google Sheets API", wait one minute, then sign out and sign in again.'
    );
  }

  if (/permission|forbidden|403|not found|404|does not have permission/i.test(msg) || status === 403 || status === 404) {
    return (
      'Cannot access this spreadsheet. Open it in Chrome with the same account shown above and confirm you can edit it. ' +
      'Shared sheets need Editor access, not Viewer.' +
      (msg ? ` (${msg})` : '')
    );
  }
  return msg || 'Google Sheets request failed.';
}

export async function listSheets(spreadsheetId, accessToken) {
  const resolvedSpreadsheetId = resolveSpreadsheetId(spreadsheetId);
  const sheets = getSheetsClient(accessToken);

  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: resolvedSpreadsheetId,
      fields: 'sheets.properties(sheetId,title)'
    });
    return mapSheetsFromApiData(response.data);
  } catch (error) {
    throw new Error(formatGoogleError(error));
  }
}

export async function readSheetPreview(spreadsheetId, sheetName, accessToken, rowLimit = 100) {
  if (!sheetName) {
    throw new Error('Sheet tab name is required.');
  }

  const resolvedSpreadsheetId = resolveSpreadsheetId(spreadsheetId);
  const sheets = getSheetsClient(accessToken);
  const escaped = String(sheetName).replace(/'/g, "''");
  const limit = Math.min(Math.max(Number(rowLimit) || 100, 1), 500);
  const range = `'${escaped}'!A1:H${limit}`;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: resolvedSpreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE'
    });

    const values = response.data.values || [];
    const defaultHeaders = ['Date', 'No', 'Company', 'Title', 'Link', 'Type', 'Salary', 'Level'];
    const headers = values.length ? values[0] : defaultHeaders;
    const rows = values.length > 1 ? values.slice(1) : [];

    return {
      sheetName,
      spreadsheetId: resolvedSpreadsheetId,
      range: response.data.range || range,
      headers,
      rows,
      rowCount: rows.length
    };
  } catch (error) {
    throw new Error(formatGoogleError(error));
  }
}

export async function appendJob(spreadsheetId, sheetName, sheetId, job, accessToken) {
  const numericSheetId = Number(sheetId);
  if (!Number.isFinite(numericSheetId)) {
    throw new Error('Invalid sheet ID for append.');
  }
  if (!sheetName) {
    throw new Error('Sheet name is required.');
  }

  const resolvedSpreadsheetId = resolveSpreadsheetId(spreadsheetId);
  const sheets = getSheetsClient(accessToken);

  try {
    const { todayDate, nextNo } = await getNextRowNumberForSheet(
      sheets,
      resolvedSpreadsheetId,
      sheetName
    );

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: resolvedSpreadsheetId,
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId: numericSheetId,
              rows: [
                {
                  values: jobToRowValues(job, todayDate, nextNo).map((value, index) => ({
                    userEnteredValue:
                      index === 1
                        ? { numberValue: Number(value) }
                        : { stringValue: String(value ?? '') }
                  }))
                }
              ],
              fields: 'userEnteredValue'
            }
          }
        ]
      }
    });

    return { todayDate, nextNo };
  } catch (error) {
    throw new Error(formatGoogleError(error));
  }
}
