import express from 'express';
import cors from 'cors';
import { requireApiKey, requireGoogleAccessToken } from './auth.js';
import { exchangeAuthCode, refreshGoogleToken } from './oauth.js';
import { appendJob, listSheets } from './sheets.js';
import { createAuthRouter } from './routes/auth.js';
import { createSettingsRouter } from './routes/settings.js';
import { createSheetsMeRouter } from './routes/sheets-me.js';

function parseCorsOrigins() {
  const raw =
    process.env.CORS_ORIGIN || process.env.DASHBOARD_ORIGIN || 'http://localhost:5173';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  const apiKey = process.env.API_KEY || '';
  const corsOrigins = parseCorsOrigins();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        const allowVercelPreviews = corsOrigins.some((value) => value.includes('.vercel.app'));
        if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/health', requireApiKey(apiKey), (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', createAuthRouter(apiKey));
  app.use('/api/me/settings', createSettingsRouter());
  app.use('/api/me/sheets', createSheetsMeRouter());

  app.post('/api/oauth/token', requireApiKey(apiKey), async (req, res) => {
    try {
      const { code, codeVerifier, redirectUrl } = req.body || {};
      const tokens = await exchangeAuthCode({ code, codeVerifier, redirectUrl });
      res.json({ ok: true, ...tokens });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Google token exchange failed.'
      });
    }
  });

  app.post('/api/oauth/refresh', requireApiKey(apiKey), async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      const tokens = await refreshGoogleToken(refreshToken);
      res.json({ ok: true, ...tokens });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Google token refresh failed.'
      });
    }
  });

  app.get(
    '/api/sheets',
    requireApiKey(apiKey),
    requireGoogleAccessToken,
    async (req, res) => {
      try {
        const spreadsheetId = req.query.spreadsheetId;
        if (!spreadsheetId) {
          res.status(400).json({
            ok: false,
            error: 'spreadsheetId query parameter is required.'
          });
          return;
        }

        const sheets = await listSheets(spreadsheetId, req.googleAccessToken);
        res.json({ ok: true, sheets });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: error?.message || 'Failed to load sheet list.'
        });
      }
    }
  );

  app.post(
    '/api/jobs',
    requireApiKey(apiKey),
    requireGoogleAccessToken,
    async (req, res) => {
      try {
        const { spreadsheetId, sheetName, sheetId, job } = req.body || {};
        if (!spreadsheetId) {
          res.status(400).json({ ok: false, error: 'spreadsheetId is required.' });
          return;
        }
        if (!job || typeof job !== 'object') {
          res.status(400).json({ ok: false, error: 'Missing job payload.' });
          return;
        }

        const result = await appendJob(
          spreadsheetId,
          sheetName,
          sheetId,
          job,
          req.googleAccessToken
        );
        res.json({ ok: true, ...result });
      } catch (error) {
        res.status(500).json({
          ok: false,
          error: error?.message || 'Failed to append job.'
        });
      }
    }
  );

  return app;
}
