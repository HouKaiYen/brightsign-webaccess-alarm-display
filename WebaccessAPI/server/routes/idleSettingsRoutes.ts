import { Router, type Request, type Response } from 'express';
import type { VersionedIdleSettings } from '../../shared/contracts.js';
import { AlarmMonitor } from '../services/alarmMonitor.js';
import { SettingsConflictError, SettingsStore, SettingsValidationError } from '../services/settingsStore.js';

export function createIdleSettingsRouter(settingsStore: SettingsStore, alarmMonitor: AlarmMonitor): Router {
  const router: Router = Router();
  router.get('/idle-settings', async (_request: Request, response: Response): Promise<void> => {
    try {
      response.json(await settingsStore.getIdleSettings());
    } catch (error: unknown) {
      sendIdleSettingsError(response, error);
    }
  });
  router.put('/idle-settings', async (request: Request, response: Response): Promise<void> => {
    try {
      const savedIdleSettings: VersionedIdleSettings = await settingsStore.saveIdleSettings(request.body as unknown);
      await alarmMonitor.updateSettings(await settingsStore.getSettings());
      response.json(savedIdleSettings);
    } catch (error: unknown) {
      sendIdleSettingsError(response, error);
    }
  });
  return router;
}

function sendIdleSettingsError(response: Response, error: unknown): void {
  if (error instanceof SettingsConflictError) {
    response.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof SettingsValidationError) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: '待機媒體設定讀寫失敗。' });
}
