import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { createPlatformSessionFromGoogleAccessToken } from '../auth-service.js';

async function sessionFromGoogleBearer(req, res) {
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    res.status(401).json({
      ok: false,
      error: 'Missing Google access token. Sign in with Google.'
    });
    return;
  }

  try {
    const session = await createPlatformSessionFromGoogleAccessToken(match[1]);
    res.json({ ok: true, ...session });
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error?.message || 'Failed to create platform session.'
    });
  }
}

export function createAuthRouter(apiKey) {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      scopes:
        'https://www.googleapis.com/auth/spreadsheets openid email profile'
    });
  });

  router.post('/session', requireApiKey(apiKey), sessionFromGoogleBearer);

  router.post('/web/session', sessionFromGoogleBearer);

  return router;
}
