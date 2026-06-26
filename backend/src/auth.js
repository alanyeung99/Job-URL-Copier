export function requireApiKey(expectedKey) {
  return (req, res, next) => {
    if (!expectedKey) {
      res.status(500).json({
        ok: false,
        error: 'Server misconfigured: API_KEY is not set.'
      });
      return;
    }

    const provided = req.get('x-api-key');
    if (!provided || provided !== expectedKey) {
      res.status(401).json({ ok: false, error: 'Invalid API key.' });
      return;
    }

    next();
  };
}

export function requireGoogleAccessToken(req, res, next) {
  const headerToken = req.get('x-google-access-token');
  if (headerToken) {
    req.googleAccessToken = headerToken;
    next();
    return;
  }

  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    res.status(401).json({
      ok: false,
      error: 'Missing Google access token. Sign in with Google in the extension.'
    });
    return;
  }

  req.googleAccessToken = match[1];
  next();
}

export function requireGoogleAccessTokenHeader(req, res, next) {
  const token = req.get('x-google-access-token') || '';
  if (!token) {
    res.status(401).json({
      ok: false,
      error: 'Missing Google access token. Sign in with Google again.'
    });
    return;
  }
  req.googleAccessToken = token;
  next();
}
