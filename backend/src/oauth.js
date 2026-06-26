function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env (from your Google Cloud OAuth Web client).'
    );
  }
  return { clientId, clientSecret };
}

async function parseGoogleTokenResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (data && data.error_description) ||
      (data && data.error) ||
      `Google token request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export async function exchangeAuthCode({ code, codeVerifier, redirectUrl }) {
  if (!code || !codeVerifier || !redirectUrl) {
    throw new Error('code, codeVerifier, and redirectUrl are required.');
  }

  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUrl,
      code_verifier: codeVerifier
    }).toString()
  });

  return parseGoogleTokenResponse(response);
}

export async function refreshGoogleToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('refreshToken is required.');
  }

  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  return parseGoogleTokenResponse(response);
}
