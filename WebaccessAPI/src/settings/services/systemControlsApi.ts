import { SettingsApiError } from './settingsApi';

export interface SystemStatus {
  isMonitoring: boolean;
  isPortable: boolean;
  canManageStartup: boolean;
  isStartupEnabled: boolean | null;
  startupMessage: string;
}

async function readSystemError(response: Response): Promise<SettingsApiError> {
  let message: string = `系統控制伺服器回應失敗（${response.status}）`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const errorValue: unknown = body.error;
      if (typeof errorValue === 'string' && errorValue.trim().length > 0) message = errorValue;
    }
  } catch {
    // 回應沒有 JSON 時保留狀態碼訊息。
  }
  return new SettingsApiError(message, response.status);
}

async function readSystemStatus(response: Response): Promise<SystemStatus> {
  if (!response.ok) throw await readSystemError(response);
  return (await response.json()) as SystemStatus;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const response: Response = await fetch('/api/system-status', { cache: 'no-store' });
  return readSystemStatus(response);
}

export async function setMonitoring(isMonitoring: boolean): Promise<SystemStatus> {
  const response: Response = await fetch('/api/monitoring', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isMonitoring }),
  });
  return readSystemStatus(response);
}

export async function setStartupEnabled(isEnabled: boolean): Promise<SystemStatus> {
  const response: Response = await fetch('/api/startup', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isEnabled }),
  });
  return readSystemStatus(response);
}
