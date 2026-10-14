import { useState } from 'react';
import type { JSX } from 'react';
import { SettingsApiError } from '../services/settingsApi';
import { getConnectionSettings, putConnectionSettings } from '../services/connectionSettingsApi';
import type { ConnectionSettings as ConnectionSettingsData, UpdateConnectionSettings } from '../services/connectionSettingsApi';

interface ConnectionSettingsProps {
  disabled?: boolean;
}

interface ConnectionForm {
  apiBase: string;
  project: string;
  username: string;
  password: string;
  clearPassword: boolean;
}

const emptyForm: ConnectionForm = {
  apiBase: '',
  project: '',
  username: '',
  password: '',
  clearPassword: false,
};

export function ConnectionSettings({ disabled = false }: ConnectionSettingsProps): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [settings, setSettings] = useState<ConnectionSettingsData | null>(null);
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');
  const [saveError, setSaveError] = useState<string>('');
  const [saveConflict, setSaveConflict] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');

  async function loadSettings(): Promise<void> {
    setIsLoading(true);
    setLoadError('');
    try {
      const loadedSettings: ConnectionSettingsData = await getConnectionSettings();
      setSettings(loadedSettings);
      setForm({
        apiBase: loadedSettings.apiBase,
        project: loadedSettings.project,
        username: loadedSettings.username,
        password: '',
        clearPassword: false,
      });
      setSaveError('');
      setSaveConflict(false);
      setSuccessMessage('');
      setHasLoaded(true);
    } catch (error: unknown) {
      setLoadError(errorMessage(error, '無法載入 WebAccess 連線設定。'));
    } finally {
      setIsLoading(false);
    }
  }

  function updateForm(patch: Partial<ConnectionForm>): void {
    setForm((current: ConnectionForm) => ({ ...current, ...patch }));
    if (!saveConflict) {
      setSaveError('');
      setSuccessMessage('');
    }
  }

  function openDialog(): void {
    setIsOpen(true);
    if (!hasLoaded && !isLoading) void loadSettings();
  }

  async function saveSettings(): Promise<void> {
    if (settings === null || isSaving || saveConflict) return;
    if (form.project.trim().length === 0 || form.username.trim().length === 0) {
      setSaveError('請輸入專案名稱與帳號。');
      return;
    }
    if (settings.passwordNeedsReset === true && form.password.length === 0 && !form.clearPassword) {
      setSaveError('已保存的密碼無法在此主機解密。請重新輸入密碼，或勾選清除已保存的密碼。');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    setSuccessMessage('');
    const apiBase: string = normalizeApiBase(form.apiBase);
    if (!isHttpUrl(apiBase)) {
      setSaveError('請輸入完整的 HTTP/HTTPS JSON 服務網址，或只輸入 WebAccess 主機 IP／名稱。');
      setIsSaving(false);
      return;
    }
    const update: UpdateConnectionSettings = {
      version: settings.version,
      apiBase,
      project: form.project.trim(),
      username: form.username.trim(),
    };
    if (form.clearPassword) update.password = '';
    else if (form.password.length > 0) update.password = form.password;
    try {
      const savedSettings: ConnectionSettingsData = await putConnectionSettings(update);
      setSettings(savedSettings);
      setForm({
        apiBase: savedSettings.apiBase,
        project: savedSettings.project,
        username: savedSettings.username,
        password: '',
        clearPassword: false,
      });
      setSuccessMessage(`WebAccess 連線設定已儲存：${savedSettings.apiBase}`);
      setSaveConflict(false);
    } catch (error: unknown) {
      const isVersionConflict: boolean = error instanceof SettingsApiError && error.status === 409;
      setSaveConflict(isVersionConflict);
      setSaveError(isVersionConflict
        ? '連線設定已被其他人更新。為避免覆蓋，請重新載入最新設定後再編輯。'
        : errorMessage(error, '儲存 WebAccess 連線設定失敗。'));
    } finally {
      setIsSaving(false);
    }
  }

  function closeDialog(): void {
    setIsOpen(false);
  }

  return (
    <>
      <button className="secondary-button connection-settings-trigger" type="button" disabled={disabled} onClick={openDialog}>WebAccess 連線設定</button>
      {isOpen && (
        <div className="dialog-backdrop connection-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-settings-title">
            <div className="connection-dialog-heading">
              <div><span className="section-kicker">伺服器連線</span><h2 id="connection-settings-title">WebAccess 連線設定</h2><p>請在服務主機以 localhost 開啟本頁修改連線設定。更改服務網址或帳號時，須重新輸入密碼。</p></div>
              <button className="dialog-close-button" type="button" onClick={closeDialog} aria-label="關閉連線設定">×</button>
            </div>
            {isLoading && <div className="connection-loading"><span className="loading-spinner" /><span>正在載入連線設定…</span></div>}
            {loadError && <div className="connection-error" role="alert"><span>{loadError}</span><button className="text-button" type="button" onClick={() => void loadSettings()}>重新載入</button></div>}
            {!isLoading && !loadError && settings !== null && (
              <form onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
                <label className="field-label" htmlFor="webaccess-api-base">JSON 服務根網址</label>
                <input id="webaccess-api-base" type="text" inputMode="url" required placeholder="http://192.168.1.100/WaWebService/Json" value={form.apiBase} onChange={(event) => updateForm({ apiBase: event.currentTarget.value })} />
                <p className="connection-field-hint">將範例 IP 位址替換成 WebAccess 主機的 IP。只輸入 IP／主機名稱時，會自動補上 HTTP 與 JSON 服務路徑。</p>

                <label className="field-label" htmlFor="webaccess-project">專案名稱</label>
                <input id="webaccess-project" type="text" required value={form.project} onChange={(event) => updateForm({ project: event.currentTarget.value })} />

                <label className="field-label" htmlFor="webaccess-username">帳號</label>
                <input id="webaccess-username" type="text" autoComplete="username" required value={form.username} onChange={(event) => updateForm({ username: event.currentTarget.value })} />

                <label className="field-label" htmlFor="webaccess-password">密碼</label>
                {settings.passwordNeedsReset === true && <p className="connection-password-warning" role="alert">已保存的密碼無法在此主機解密，請重新輸入密碼，或勾選清除後再儲存。</p>}
                <input id="webaccess-password" type="password" autoComplete="new-password" placeholder={settings.passwordNeedsReset ? '請重新輸入 WebAccess 密碼' : settings.hasPassword ? '已保存密碼；留白可保留' : '輸入 WebAccess 密碼'} value={form.password} disabled={form.clearPassword} onChange={(event) => updateForm({ password: event.currentTarget.value })} />
                <label className="clear-password-option"><input type="checkbox" checked={form.clearPassword} onChange={(event) => updateForm({ clearPassword: event.currentTarget.checked, password: event.currentTarget.checked ? '' : form.password })} /><span>明確清除伺服器保存的密碼（若有）</span></label>

                {saveError && <div className="connection-error" role="alert"><span>{saveError}</span>{saveConflict && <button className="text-button" type="button" onClick={() => void loadSettings()}>重新載入最新設定</button>}</div>}
                {successMessage && <p className="connection-success" role="status">{successMessage}</p>}
                <div className="connection-dialog-actions">
                  <button className="secondary-button" type="button" onClick={closeDialog}>關閉</button>
                  <button className="primary-button" type="submit" disabled={isSaving || saveConflict}>{isSaving ? <><span className="button-spinner" />儲存中</> : '儲存連線設定'}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeApiBase(value: string): string {
  const trimmedValue: string = value.trim();
  if (/^https?:\/\//i.test(trimmedValue) || trimmedValue.length === 0) return trimmedValue;
  if (trimmedValue.includes('/') || trimmedValue.includes('?') || trimmedValue.includes('#')) return trimmedValue;
  return `http://${trimmedValue}/WaWebService/Json`;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsedUrl: URL = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}
