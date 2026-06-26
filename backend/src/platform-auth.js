import jwt from 'jsonwebtoken';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    throw new Error('Server misconfigured: JWT_SECRET is not set.');
  }
  return secret;
}

export function signPlatformToken(user) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
  return jwt.sign(
    {
      sub: String(user._id),
      email: user.email,
      googleSub: user.googleSub
    },
    getJwtSecret(),
    { expiresIn }
  );
}

export function requirePlatformAuth(req, res, next) {
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    res.status(401).json({ ok: false, error: 'Missing platform session token.' });
    return;
  }

  try {
    const payload = jwt.verify(match[1], getJwtSecret());
    req.platformUser = {
      id: payload.sub,
      email: payload.email,
      googleSub: payload.googleSub
    };
    next();
  } catch (_error) {
    res.status(401).json({ ok: false, error: 'Invalid or expired platform session.' });
  }
}
