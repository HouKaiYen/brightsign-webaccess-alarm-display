import { Router, type Request, type Response } from 'express';
import type { ConnectionSettings } from '../../shared/contracts.js';
import { AlarmMonitor } from '../services/alarmMonitor.js';
import {
  ConnectionSettingsConflictError,
  ConnectionSettingsStore,
  ConnectionSettingsValidationError,
} from '../services/connectionSettingsStore.js';

function canModifyConnectionSettings(request: Request): boolean {
  const address: string = request.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  try {
    const host: URL = new URL('http://' + (request.headers.host ?? ''));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    const origin: string | undefined = request.headers.origin;
    return origin === undefined || new URL(origin).origin === host.origin;
  } catch { return false; }
}

export function createConnectionSettingsRouter(
  connectionSettingsStore: ConnectionSettingsStore,
  alarmMonitor: AlarmMonitor,
): Router {
  const router: Router = Router();

  router.get('/connection-settings', (_request: Request, response: Response): void => {
    response.json(connectionSettingsStore.getPublicSettings());
  });

  router.put('/connection-settings', async (request: Request, response: Response): Promise<void> => {
    if (!canModifyConnectionSettings(request)) {
      response.status(403).json({ error: '請在服務主機使用 http://localhost:連接埠/engineering 修改 WebAccess 連線設定。' });
      return;
    }
    try {
      const savedSettings: ConnectionSettings = await alarmMonitor.reconfigureConnectionSettings(
        () => connectionSettingsStore.saveSettings(request.body as unknown),
      );
      response.status(200).json(savedSettings);
    } catch (error: unknown) {
      if (error instanceof ConnectionSettingsConflictError) {
        response.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof ConnectionSettingsValidationError) {
        response.status(400).json({ error: error.message });
        return;
      }
      response.status(500).json({ error: 'WebAccess 連線設定保存失敗。' });
    }
  });

  return router;
}
