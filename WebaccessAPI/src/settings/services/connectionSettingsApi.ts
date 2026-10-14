import { SettingsApiError } from './settingsApi';

export interface ConnectionSettings {
  version: number;
  apiBase: string;
  project: string;
  username: string;
  hasPassword: boolean;
  passwordNeedsReset?: boolean;
}

export interface UpdateConnectionSettings {
  version: number;
  apiBase: string;
  project: string;
  username: string;
  password?: string;
}

async function readConnectionError(response: Response): Promise<SettingsApiError> {
  let message: string = `連線設定伺服器回應失敗（${response.status}）`;
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

export async function getConnectionSettings(): Promise<ConnectionSettings> {
  const response: Response = await fetch('/api/connection-settings', { cache: 'no-store' });
  if (!response.ok) throw await readConnectionError(response);
  return (await response.json()) as ConnectionSettings;
}

export async function putConnectionSettings(settings: UpdateConnectionSettings): Promise<ConnectionSettings> {
  const response: Response = await fetch('/api/connection-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw await readConnectionError(response);
  return (await response.json()) as ConnectionSettings;
}
