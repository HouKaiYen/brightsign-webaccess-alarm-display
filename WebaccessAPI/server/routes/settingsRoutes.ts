import { Router, type Request, type Response } from 'express';
import type { AlarmSettings } from '../../shared/contracts.js';
import { AlarmMonitor } from '../services/alarmMonitor.js';
import { SettingsConflictError, SettingsStore, SettingsValidationError } from '../services/settingsStore.js';

export function createSettingsRouter(settingsStore: SettingsStore, alarmMonitor: AlarmMonitor): Router {
  const router: Router = Router();

  router.get('/settings', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await settingsStore.getSettings());
    } catch (error: unknown) {
      sendSettingsError(response, error);
    }
  });

  router.put('/settings', async (request: Request, response: Response): Promise<void> => {
    try {
      const savedSettings: AlarmSettings = await settingsStore.saveSettings(request.body as unknown);
      await alarmMonitor.updateSettings(savedSettings);
      response.json(savedSettings);
    } catch (error: unknown) {
      sendSettingsError(response, error);
    }
  });

  return router;
}

function sendSettingsError(response: Response, error: unknown): void {
  if (error instanceof SettingsConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof SettingsValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: '設定讀寫失敗。' });
}
