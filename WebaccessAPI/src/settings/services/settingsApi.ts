import type {
  AlarmSettings,
  TagOption,
  UploadResult,
} from '../../../shared/contracts';

export class SettingsApiError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = 'SettingsApiError';
    this.status = status;
  }
}

async function readError(response: Response): Promise<SettingsApiError> {
  let message: string = `伺服器回應失敗（${response.status}）`;

  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const errorValue: unknown = body.error;
      if (typeof errorValue === 'string' && errorValue.trim().length > 0) {
        message = errorValue;
      }
    }
  } catch {
    // 回應沒有 JSON 時保留狀態碼訊息。
  }

  return new SettingsApiError(message, response.status);
}

export async function getSettings(): Promise<AlarmSettings> {
  const response: Response = await fetch('/api/settings', { cache: 'no-store' });
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as AlarmSettings;
}

export async function putSettings(settings: AlarmSettings): Promise<AlarmSettings> {
  const response: Response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as AlarmSettings;
}

export async function getTags(): Promise<TagOption[]> {
  const response: Response = await fetch('/api/tags', { cache: 'no-store' });
  if (!response.ok) {
    throw await readError(response);
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('tags' in body) || !Array.isArray(body.tags)) {
    throw new Error('測點清單格式錯誤');
  }
  return body.tags as TagOption[];
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const formData: FormData = new FormData();
  formData.append('image', file);
  const response: Response = await fetch('/api/uploads', { method: 'POST', body: formData });
  if (!response.ok) {
    throw await readError(response);
  }
  return (await response.json()) as UploadResult;
}
