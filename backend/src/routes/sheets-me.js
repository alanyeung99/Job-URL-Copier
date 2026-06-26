import { Router } from 'express';
import { requirePlatformAuth } from '../platform-auth.js';
import { requireGoogleAccessTokenHeader } from '../auth.js';
import { getUserSettings, resolveSpreadsheetIdFromSettings } from '../settings-service.js';
import { listSheets, readSheetPreview } from '../sheets.js';

export function createSheetsMeRouter() {
  const router = Router();

  router.get('/tabs', requirePlatformAuth, requireGoogleAccessTokenHeader, async (req, res) => {
    try {
      const settings = await getUserSettings(req.platformUser.id);
      const spreadsheetId = resolveSpreadsheetIdFromSettings(settings, req.query.spreadsheetId);
      if (!spreadsheetId) {
        res.status(400).json({
          ok: false,
          error: 'Register a spreadsheet first.'
        });
        return;
      }

      const sheets = await listSheets(spreadsheetId, req.googleAccessToken);
      res.json({ ok: true, spreadsheetId, sheets });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to load sheet tabs.'
      });
    }
  });

  router.get('/preview', requirePlatformAuth, requireGoogleAccessTokenHeader, async (req, res) => {
    try {
      const settings = await getUserSettings(req.platformUser.id);
      const spreadsheetId = resolveSpreadsheetIdFromSettings(settings, req.query.spreadsheetId);
      if (!spreadsheetId) {
        res.status(400).json({
          ok: false,
          error: 'Register a spreadsheet first.'
        });
        return;
      }

      const sheetName =
        req.query.sheetName ||
        settings.selectedSheet?.sheetName ||
        settings.selectedSheet?.name ||
        null;

      if (!sheetName) {
        res.status(400).json({
          ok: false,
          error: 'Select a target sheet tab on the Preview page first.'
        });
        return;
      }

      const limit = req.query.limit;
      const preview = await readSheetPreview(
        spreadsheetId,
        sheetName,
        req.googleAccessToken,
        limit
      );

      res.json({ ok: true, preview, settingsUpdatedAt: settings.updatedAt });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to load sheet preview.'
      });
    }
  });

  return router;
}
