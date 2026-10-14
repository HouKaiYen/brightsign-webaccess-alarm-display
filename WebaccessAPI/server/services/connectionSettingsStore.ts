import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConnectionSettings, SaveConnectionSettingsRequest } from '../../shared/contracts.js';
import type { ServerConfiguration } from '../config/environment.js';
import type { SecretProtector } from './secretProtector.js';

interface PersistedConnectionSettings {
  version: number;
  apiBase: string;
  project: string;
  username: string;
  encryptedPassword: string;
}

export class ConnectionSettingsConflictError extends Error {
  public constructor() {
    super('WebAccess 連線設定已更新，請重新載入後再儲存。');
    this.name = 'ConnectionSettingsConflictError';
  }
}

export class ConnectionSettingsValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConnectionSettingsValidationError';
  }
}

export class ConnectionSettingsStore {
  private readonly _settingsPath: string;
  private readonly _configuration: ServerConfiguration;
  private readonly _secretProtector: SecretProtector;
  private _currentSettings: PersistedConnectionSettings | null = null;
  private _password: string = '';
  private _passwordUnavailable: boolean = false;
  private _saveQueue: Promise<void> = Promise.resolve();

  public constructor(dataDirectory: string, configuration: ServerConfiguration, secretProtector: SecretProtector) {
    this._settingsPath = path.join(path.resolve(dataDirectory), 'connection-settings.json');
    this._configuration = configuration;
    this._secretProtector = secretProtector;
  }

  public async initialize(): Promise<void> {
    await mkdir(path.dirname(this._settingsPath), { recursive: true });
    try {
      const jsonText: string = await readFile(this._settingsPath, 'utf8');
      const persistedSettings: unknown = JSON.parse(jsonText);
      if (!this.isPersistedSettings(persistedSettings)) {
        throw new ConnectionSettingsValidationError('已保存的 WebAccess 連線設定格式無效。');
      }
      this.validateStoredValues(persistedSettings);
      let password: string = '';
      if (persistedSettings.encryptedPassword !== '') {
        try {
          password = await this._secretProtector.unprotect(persistedSettings.encryptedPassword);
        } catch {
          this._passwordUnavailable = true;
        }
      }
      this._currentSettings = persistedSettings;
      this._password = password;
      this.applyToConfiguration(persistedSettings, password);
      await this._secretProtector.secureFile(this._settingsPath);
    } catch (error: unknown) {
      if (this.isFileNotFound(error)) {
        await this.initializeFromEnvironment();
        return;
      }
      if (error instanceof SyntaxError) {
        throw new ConnectionSettingsValidationError('已保存的 WebAccess 連線設定不是有效 JSON。');
      }
      throw error;
    }
  }

  public getPublicSettings(): ConnectionSettings {
    if (this._currentSettings === null) {
      throw new Error('WebAccess 連線設定尚未初始化。');
    }
    return this.toPublicSettings(this._currentSettings);
  }

  public saveSettings(request: unknown): Promise<ConnectionSettings> {
    const operation: Promise<ConnectionSettings> = this._saveQueue.then(() => this.saveSettingsInSequence(request));
    this._saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async initializeFromEnvironment(): Promise<void> {
    const defaultSettings: PersistedConnectionSettings = {
      version: 1,
      apiBase: this._configuration.webAccessApiBase,
      project: this._configuration.webAccessProject,
      username: this._configuration.webAccessUsername,
      encryptedPassword: this._configuration.webAccessPassword === ''
        ? ''
        : await this._secretProtector.protect(this._configuration.webAccessPassword),
    };
    this.validateStoredValues(defaultSettings);
    await this.writeSettings(defaultSettings);
    this._currentSettings = defaultSettings;
    this._password = this._configuration.webAccessPassword;
  }

  private async saveSettingsInSequence(request: unknown): Promise<ConnectionSettings> {
    if (!this.isSaveRequest(request)) {
      throw new ConnectionSettingsValidationError('WebAccess 連線設定欄位格式無效。');
    }
    if (this._currentSettings === null) {
      throw new Error('WebAccess 連線設定尚未初始化。');
    }
    if (request.version !== this._currentSettings.version) {
      throw new ConnectionSettingsConflictError();
    }

    const apiBase: string = this.validateApiBase(request.apiBase);
    const project: string = request.project.trim();
    const username: string = request.username.trim();
    if (project === '' || username === '') {
      throw new ConnectionSettingsValidationError('WebAccess 專案與使用者名稱不可空白。');
    }
    if (request.password !== undefined && request.password.length > 4096) {
      throw new ConnectionSettingsValidationError('WebAccess 密碼長度不可超過 4096 個字元。');
    }
    if (request.password === undefined && this._passwordUnavailable) {
      throw new ConnectionSettingsValidationError('此密碼無法由目前 Windows 主機解密，請重新輸入密碼；原設定檔尚未變更。');
    }

    if (request.password === undefined && this._password !== '' &&
      (apiBase !== this._currentSettings.apiBase || username !== this._currentSettings.username)) {
      throw new ConnectionSettingsValidationError('更改 WebAccess 服務網址或帳號時，請重新輸入密碼，或明確清除已保存的密碼。');
    }

    const password: string = request.password === undefined ? this._password : request.password;
    const persistedSettings: PersistedConnectionSettings = {
      version: this._currentSettings.version + 1,
      apiBase,
      project,
      username,
      encryptedPassword: password === '' ? '' : await this._secretProtector.protect(password),
    };

    await this.writeSettings(persistedSettings);
    this._currentSettings = persistedSettings;
    this._password = password;
    this._passwordUnavailable = false;
    this.applyToConfiguration(persistedSettings, password);
    return this.toPublicSettings(persistedSettings);
  }

  private validateApiBase(apiBase: string): string {
    const normalizedApiBase: string = apiBase.trim().replace(/\/+$/, '');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedApiBase);
    } catch {
      throw new ConnectionSettingsValidationError('WebAccess API 基本網址格式無效。');
    }
    if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
      parsedUrl.hostname === '' || parsedUrl.username !== '' || parsedUrl.password !== '' ||
      parsedUrl.search !== '' || parsedUrl.hash !== '') {
      throw new ConnectionSettingsValidationError('WebAccess API 基本網址必須是沒有帳密、查詢參數或片段的 HTTP/HTTPS 網址。');
    }
    return normalizedApiBase;
  }

  private validateStoredValues(settings: PersistedConnectionSettings): void {
    if (!Number.isInteger(settings.version) || settings.version < 1 ||
      typeof settings.apiBase !== 'string' || typeof settings.project !== 'string' ||
      typeof settings.username !== 'string' || typeof settings.encryptedPassword !== 'string') {
      throw new ConnectionSettingsValidationError('已保存的 WebAccess 連線設定欄位無效。');
    }
    if (settings.apiBase !== '') {
      this.validateApiBase(settings.apiBase);
    }
  }

  private async writeSettings(settings: PersistedConnectionSettings): Promise<void> {
    const temporaryPath: string = path.join(path.dirname(this._settingsPath), `connection-settings.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await this._secretProtector.secureFile(temporaryPath);
      await rename(temporaryPath, this._settingsPath);
    } catch (error: unknown) {
      try {
        await unlink(temporaryPath);
      } catch {
        // 暫存檔清理失敗時仍保留原設定檔與主要錯誤。
      }
      throw error;
    }
  }

  private applyToConfiguration(settings: PersistedConnectionSettings, password: string): void {
    this._configuration.webAccessApiBase = this._passwordUnavailable ? '' : settings.apiBase;
    this._configuration.webAccessProject = settings.project;
    this._configuration.webAccessUsername = settings.username;
    this._configuration.webAccessPassword = password;
  }

  private toPublicSettings(settings: PersistedConnectionSettings): ConnectionSettings {
    const publicSettings: ConnectionSettings = {
      version: settings.version,
      apiBase: settings.apiBase,
      project: settings.project,
      username: settings.username,
      hasPassword: this._password !== '' && !this._passwordUnavailable,
    };
    if (this._passwordUnavailable) {
      publicSettings.passwordNeedsReset = true;
    }
    return publicSettings;
  }

  private isSaveRequest(value: unknown): value is SaveConnectionSettingsRequest {
    return this.isRecord(value) && Number.isInteger(value['version']) &&
      typeof value['apiBase'] === 'string' && typeof value['project'] === 'string' &&
      typeof value['username'] === 'string' &&
      (value['password'] === undefined || typeof value['password'] === 'string');
  }

  private isPersistedSettings(value: unknown): value is PersistedConnectionSettings {
    return this.isRecord(value) && Number.isInteger(value['version']) &&
      typeof value['apiBase'] === 'string' && typeof value['project'] === 'string' &&
      typeof value['username'] === 'string' && typeof value['encryptedPassword'] === 'string';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isFileNotFound(error: unknown): boolean {
    return this.isRecord(error) && error['code'] === 'ENOENT';
  }
}
