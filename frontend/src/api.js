const STORAGE_KEY = 'jobrightDashboardSession';

const API_BASE = import.meta.env.VITE_API_URL ?
      String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
      : null;

function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

export function loadSession() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function parseTokenClientResponse(response) {
  if (response.error) {
    throw new Error(response.error_description || response.error);
  }
  if (!response.access_token) {
    throw new Error('Google did not return an access token.');
  }
  const expiresIn = Number(response.expires_in);
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000;
  return {
    accessToken: response.access_token,
    expiresAt
  };
}

function createTokenClient(clientId, scopes, callback) {
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google sign-in is still loading. Try again in a moment.');
  }
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: scopes,
    callback
  });
}

export function requestGoogleAccessToken(clientId, scopes) {
  return new Promise((resolve, reject) => {
    try {
      const client = createTokenClient(clientId, scopes, (response) => {
        try {
          resolve(parseTokenClientResponse(response));
        } catch (error) {
          reject(error);
        }
      });
      client.requestAccessToken({ prompt: '' });
    } catch (error) {
      reject(error);
    }
  });
}

export function requestGoogleAccessTokenInteractive(clientId, scopes) {
  return new Promise((resolve, reject) => {
    try {
      const client = createTokenClient(clientId, scopes, (response) => {
        try {
          resolve(parseTokenClientResponse(response));
        } catch (error) {
          reject(error);
        }
      });
      client.requestAccessToken({ prompt: 'consent select_account' });
    } catch (error) {
      reject(error);
    }
  });
}

function googleTokenExpired(session) {
  if (!session?.googleAccessToken) {
    return true;
  }
  const expiresAt = session.googleAccessTokenExpiresAt || 0;
  return expiresAt < Date.now() + 60_000;
}

function promiseWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('Request timed out.')), ms);
    })
  ]);
}

async function parseJsonResponse(response) {
  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    console.error('Error parsing JSON response', _error);
    // Ignore non-JSON bodies.
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

export async function fetchAuthConfig() {
  const response = await fetch(apiUrl('/api/auth/config'), {
    cache: 'no-store'
  });
  return parseJsonResponse(response);
}

export async function createWebSession(googleAccessToken) {
  const response = await fetch(apiUrl('/api/auth/web/session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${googleAccessToken}`
    }
  });
  return parseJsonResponse(response);
}

function authHeaders(platformToken, googleAccessToken) {
  const headers = {
    Authorization: `Bearer ${platformToken}`
  };
  if (googleAccessToken) {
    headers['X-Google-Access-Token'] = googleAccessToken;
  }
  return headers;
}

export async function fetchSettings(platformToken, googleAccessToken) {
  const response = await fetch(apiUrl('/api/me/settings'), {
    headers: authHeaders(platformToken, googleAccessToken)
  });
  return parseJsonResponse(response);
}

export async function saveSettings(platformToken, googleAccessToken, settings) {
  const response = await fetch(apiUrl('/api/me/settings'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(platformToken, googleAccessToken)
    },
    body: JSON.stringify(settings)
  });
  return parseJsonResponse(response);
}

export async function fetchSheetTabs(platformToken, googleAccessToken, spreadsheetId) {
  const params = new URLSearchParams();
  if (spreadsheetId) {
    params.set('spreadsheetId', spreadsheetId);
  }
  const query = params.toString();
  const response = await fetch(apiUrl(`/api/me/sheets/tabs${query ? `?${query}` : ''}`), {
    headers: authHeaders(platformToken, googleAccessToken)
  });
  return parseJsonResponse(response);
}

export async function fetchSheetPreview(
  platformToken,
  googleAccessToken,
  sheetName,
  spreadsheetId
) {
  const params = new URLSearchParams();
  if (sheetName) {
    params.set('sheetName', sheetName);
  }
  if (spreadsheetId) {
    params.set('spreadsheetId', spreadsheetId);
  }
  const response = await fetch(apiUrl(`/api/me/sheets/preview?${params.toString()}`), {
    headers: authHeaders(platformToken, googleAccessToken)
  });
  return parseJsonResponse(response);
}

export async function restoreSession(authConfig) {
  const saved = loadSession();
  if (!saved?.platformToken) {
    return null;
  }

  let platformToken = saved.platformToken;
  let googleAccessToken = saved.googleAccessToken || null;
  let googleAccessTokenExpiresAt = saved.googleAccessTokenExpiresAt || 0;
  let user = saved.user || null;
  let settings = null;

  if (saved.googleAccessToken && googleTokenExpired(saved) && authConfig?.googleClientId) {
    try {
      const refreshed = await promiseWithTimeout(
        requestGoogleAccessToken(authConfig.googleClientId, authConfig.scopes),
        10_000
      );
      googleAccessToken = refreshed.accessToken;
      googleAccessTokenExpiresAt = refreshed.expiresAt;
    } catch (_error) {
      googleAccessToken = null;
      googleAccessTokenExpiresAt = 0;
    }
  }

  try {
    const data = await fetchSettings(platformToken, googleAccessToken);
    settings = data.settings || null;
  } catch (error) {
    const platformExpired = /platform session|invalid or expired platform/i.test(
      error?.message || ''
    );
    if (!platformExpired || !googleAccessToken) {
      if (platformExpired) {
        clearSession();
      }
      return null;
    }

    const data = await createWebSession(googleAccessToken);
    platformToken = data.token;
    user = data.user;
    settings = data.settings || null;
  }

  const session = {
    platformToken,
    googleAccessToken,
    googleAccessTokenExpiresAt,
    user
  };
  saveSession(session);
  return { ...session, settings };
}

export async function ensureGoogleAccessToken(session, authConfig) {
  if (!session?.platformToken) {
    throw new Error('Not signed in.');
  }
  if (!googleTokenExpired(session)) {
    return session;
  }
  if (!authConfig?.googleClientId) {
    throw new Error('Google sign-in is not configured.');
  }

  const refreshed = await requestGoogleAccessTokenInteractive(
    authConfig.googleClientId,
    authConfig.scopes
  );
  const nextSession = {
    ...session,
    googleAccessToken: refreshed.accessToken,
    googleAccessTokenExpiresAt: refreshed.expiresAt
  };
  saveSession(nextSession);
  return nextSession;
}

export function parseSpreadsheetId(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return null;
  }
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) {
    return fromUrl[1];
  }
  const bare = trimmed.split(/[?#]/)[0].replace(/\/+$/, '');
  if (/^[a-zA-Z0-9-_]{20,}$/.test(bare)) {
    return bare;
  }
  return null;
}

export function normalizeSpreadsheetUrl(input) {
  const spreadsheetId = parseSpreadsheetId(input);
  if (!spreadsheetId) {
    return null;
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
