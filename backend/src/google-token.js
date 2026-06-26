export async function verifyGoogleAccessToken(accessToken) {
  if (!accessToken) {
    throw new Error('Missing Google access token.');
  }

  const expectedClientId = process.env.GOOGLE_CLIENT_ID || '';
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

  let info = {};
  try {
    info = await response.json();
  } catch (_error) {
    // Ignore non-JSON bodies.
  }

  if (!response.ok) {
    throw new Error(info.error_description || info.error || 'Invalid Google access token.');
  }

  if (expectedClientId && info.aud && info.aud !== expectedClientId) {
    throw new Error('Google token audience mismatch.');
  }

  const googleSub = info.sub || info.user_id;
  if (!googleSub) {
    throw new Error('Google token did not include a user id.');
  }

  let email = info.email ? String(info.email) : null;
  if (!email) {
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (userinfoResponse.ok) {
      const userinfo = await userinfoResponse.json().catch(() => ({}));
      if (userinfo?.email) {
        email = String(userinfo.email);
      }
    }
  }

  return {
    googleSub: String(googleSub),
    email
  };
}
