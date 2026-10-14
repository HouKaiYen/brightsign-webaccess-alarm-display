import { Router, type Request, type Response } from 'express';
import { AlarmMonitor } from '../services/alarmMonitor.js';
import { PortableStartupManager } from '../services/portableStartupManager.js';

interface SystemStatus {
  isMonitoring: boolean;
  isPortable: boolean;
  canManageStartup: boolean;
  isStartupEnabled: boolean | null;
  startupMessage: string;
}

export function createSystemRouter(alarmMonitor: AlarmMonitor): Router {
  const router: Router = Router();
  const startupManager: PortableStartupManager = new PortableStartupManager();
  let monitoringQueue: Promise<void> = Promise.resolve();

  function canManageStartup(request: Request): boolean {
    const address: string | undefined = request.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) return false;
    try {
      const host: URL = new URL(`http://${request.headers.host ?? ''}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
      const origin: string | undefined = request.headers.origin;
      return origin === undefined || new URL(origin).host === host.host;
    } catch { return false; }
  }

  async function getStatus(request: Request): Promise<SystemStatus> {
    let isStartupEnabled: boolean | null = null;
    let startupMessage: string = startupManager.isPortable ? '首次設定需要 Windows 管理員授權。' : '開機自啟動需使用免安裝包。';
    if (startupManager.isPortable) {
      try { isStartupEnabled = await startupManager.getIsEnabled(); }
      catch (error: unknown) { startupMessage = error instanceof Error ? error.message : '無法讀取自啟動狀態。'; }
    }
    return { isMonitoring: alarmMonitor.isRunning, isPortable: startupManager.isPortable, canManageStartup: canManageStartup(request), isStartupEnabled, startupMessage };
  }

  router.get('/system-status', async (request: Request, response: Response): Promise<void> => { response.json(await getStatus(request)); });
  router.put('/monitoring', async (request: Request, response: Response): Promise<void> => {
    const candidate: unknown = request.body;
    if (typeof candidate !== 'object' || candidate === null || !('isMonitoring' in candidate) || typeof candidate.isMonitoring !== 'boolean') {
      response.status(400).json({ error: '請指定是否啟動警報監控。' }); return;
    }
    const shouldMonitor: boolean = candidate.isMonitoring;
    const operation: Promise<void> = monitoringQueue.then(async (): Promise<void> => {
      await alarmMonitor.setIsRunning(shouldMonitor);
    });
    monitoringQueue = operation.catch(() => undefined);
    try { await operation; response.json(await getStatus(request)); }
    catch { response.status(500).json({ error: '警報監控切換失敗。' }); }
  });
  router.put('/startup', async (request: Request, response: Response): Promise<void> => {
    if (!startupManager.isPortable || !canManageStartup(request)) {
      response.status(403).json({ error: '請在免安裝主機使用 http://localhost:連接埠/settings 管理開機自啟動。' }); return;
    }
    const candidate: unknown = request.body;
    if (typeof candidate !== 'object' || candidate === null || !('isEnabled' in candidate) || typeof candidate.isEnabled !== 'boolean') {
      response.status(400).json({ error: '請指定是否啟用開機自啟動。' }); return;
    }
    try {
      const desiredState: boolean = candidate.isEnabled;
      if (await startupManager.getIsEnabled() !== desiredState) await startupManager.setIsEnabled(desiredState);
      const status: SystemStatus = await getStatus(request);
      if (status.isStartupEnabled !== desiredState) {
        response.status(500).json({ error: 'Windows 排程操作完成，但狀態未變更。請查看 data\\startup-management-error.log。' }); return;
      }
      response.json({ ...status, startupMessage: desiredState ? '已啟用開機自啟動。' : '已取消開機自啟動。' });
    } catch (error: unknown) { response.status(500).json({ error: error instanceof Error ? error.message : '自啟動操作失敗。' }); }
  });
  return router;
}
