import { Router } from 'express';
import { requirePlatformAuth } from '../platform-auth.js';
import { getUserSettings, updateUserSettings } from '../settings-service.js';

export function createSettingsRouter() {
  const router = Router();

  router.get('/', requirePlatformAuth, async (req, res) => {
    try {
      const settings = await getUserSettings(req.platformUser.id);
      res.json({ ok: true, settings });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to load settings.'
      });
    }
  });

  router.put('/', requirePlatformAuth, async (req, res) => {
    try {
      const { registeredSpreadsheets, selectedSheet, filters } = req.body || {};
      const settings = await updateUserSettings(req.platformUser.id, {
        registeredSpreadsheets,
        selectedSheet,
        filters
      });
      res.json({ ok: true, settings });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to save settings.'
      });
    }
  });

  return router;
}
