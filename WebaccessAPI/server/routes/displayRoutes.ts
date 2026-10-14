import { Router, type Request, type Response } from 'express';
import type { TagOption } from '../../shared/contracts.js';
import { AlarmMonitor } from '../services/alarmMonitor.js';
import { WebAccessUnavailableError, WebAccessClient } from '../services/webAccessClient.js';

export function createDisplayRouter(alarmMonitor: AlarmMonitor, webAccessClient: WebAccessClient): Router {
  const router: Router = Router();

  router.get('/display-state', (_request: Request, response: Response): void => {
    response.json(alarmMonitor.getDisplayState());
  });

  router.get('/tags', async (_request: Request, response: Response): Promise<void> => {
    try {
      const tags: TagOption[] = await webAccessClient.getTags();
      response.json({ tags });
    } catch (error: unknown) {
      const message: string = error instanceof WebAccessUnavailableError ? error.message : '測點清單讀取失敗。';
      response.status(503).json({ error: message });
    }
  });

  router.get('/health', (_request: Request, response: Response): void => {
    const displayState = alarmMonitor.getDisplayState();
    response.json({
      ok: true,
      connectionStatus: displayState.connectionStatus,
      lastSuccessAt: displayState.lastSuccessAt,
    });
  });

  return router;
}
