import type { ActiveAlarm, TagOption } from '../../shared/contracts.js';
import type { ServerConfiguration } from '../config/environment.js';

export class WebAccessUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WebAccessUnavailableError';
  }
}

export class WebAccessClient {
  private readonly _configuration: ServerConfiguration;

  public constructor(configuration: ServerConfiguration) {
    this._configuration = configuration;
  }

  public get isConfigured(): boolean {
    return this._configuration.webAccessApiBase.trim() !== '' &&
      this._configuration.webAccessProject.trim() !== '' &&
      this._configuration.webAccessUsername.trim() !== '';
  }

  public async getActiveAlarms(): Promise<ActiveAlarm[]> {
    if (!this.isConfigured) {
      throw new WebAccessUnavailableError('WebAccess 尚未設定連線資訊。');
    }
    const project: string = encodeURIComponent(this._configuration.webAccessProject);
    const responseBody: unknown = await this.fetchJson(`/GetAlarmSummary/${project}/0/5000`);
    return this.parseAlarms(responseBody);
  }

  public async getTags(): Promise<TagOption[]> {
    if (!this.isConfigured) {
      throw new WebAccessUnavailableError('WebAccess 尚未設定連線資訊。');
    }
    const project: string = encodeURIComponent(this._configuration.webAccessProject);
    const responseBody: unknown = await this.fetchJson(`/TagList/${project}`);
    if (!this.isRecord(responseBody)) {
      throw new WebAccessUnavailableError('WebAccess 測點清單回應格式無效。');
    }

    const result: unknown = responseBody['Result'];
    const rawTags: unknown = responseBody['Tags'] ?? responseBody['TagList'];
    if (!this.isRecord(result) || result['Ret'] !== 0 || !Array.isArray(rawTags)) {
      throw new WebAccessUnavailableError('WebAccess 測點清單回傳錯誤。');
    }
    if (result['Total'] !== undefined &&
      (!Number.isInteger(result['Total']) || (result['Total'] as number) < 0 || rawTags.length !== result['Total'])) {
      throw new WebAccessUnavailableError('WebAccess 測點清單不完整。');
    }

    const tags: TagOption[] = [];
    for (const rawTag of rawTags) {
      if (!this.isRecord(rawTag) || typeof rawTag['Name'] !== 'string' || rawTag['Name'].trim() === '' ||
        (typeof rawTag['Description'] !== 'string' && typeof rawTag['Desc'] !== 'string')) {
        throw new WebAccessUnavailableError('WebAccess 測點清單包含無效資料。');
      }
      tags.push({ name: rawTag['Name'], description: (rawTag['Description'] ?? rawTag['Desc']) as string });
    }
    return tags;
  }

  private async fetchJson(endpointPath: string): Promise<unknown> {
    const baseUrl: string = this._configuration.webAccessApiBase.replace(/\/+$/, '');
    const endpoint: URL = new URL(`${baseUrl}${endpointPath}`);
    const abortController: AbortController = new AbortController();
    const timeoutId: NodeJS.Timeout = setTimeout(() => abortController.abort(), this._configuration.requestTimeoutMs);
    const credentials: string = Buffer.from(
      `${this._configuration.webAccessUsername}:${this._configuration.webAccessPassword}`,
      'utf8',
    ).toString('base64');
    try {
      const response: Response = await fetch(endpoint, {
        headers: { Authorization: `Basic ${credentials}`, Accept: 'application/json' },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new WebAccessUnavailableError(`WebAccess 回傳 HTTP ${response.status}。`);
      }
      return await response.json() as unknown;
    } catch (error: unknown) {
      if (error instanceof WebAccessUnavailableError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new WebAccessUnavailableError('WebAccess 連線逾時。');
      }
      throw new WebAccessUnavailableError('WebAccess 無法連線或回應格式錯誤。');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseAlarms(value: unknown): ActiveAlarm[] {
    if (!this.isRecord(value) || !this.isRecord(value['Result']) || !Array.isArray(value['AlarmTagList'])) {
      throw new WebAccessUnavailableError('WebAccess 警報回應格式無效。');
    }

    const result: Record<string, unknown> = value['Result'];
    const returnCode: unknown = result['Ret'];
    const total: unknown = result['Total'];
    if (returnCode !== 0 || !Number.isInteger(total) || (total as number) < 0) {
      throw new WebAccessUnavailableError('WebAccess 警報清單回傳錯誤。');
    }

    const rawAlarms: unknown[] = value['AlarmTagList'];
    if ((total as number) > 5000 || rawAlarms.length !== total) {
      throw new WebAccessUnavailableError('WebAccess 警報清單不完整，暫不更新警報狀態。');
    }

    const activeAlarms: ActiveAlarm[] = [];
    for (const rawAlarm of rawAlarms) {
      if (!this.isRecord(rawAlarm) || typeof rawAlarm['Name'] !== 'string' || rawAlarm['Name'].trim() === '' ||
        typeof rawAlarm['Desc'] !== 'string' || typeof rawAlarm['Time'] !== 'string') {
        throw new WebAccessUnavailableError('WebAccess 警報清單包含無效測點資料。');
      }
      activeAlarms.push({
        name: rawAlarm['Name'],
        description: rawAlarm['Desc'],
        time: rawAlarm['Time'],
        occurredAt: this.parseScadaTime(rawAlarm['Time']),
      });
    }
    return activeAlarms;
  }

  private parseScadaTime(time: string): number {
    const match: RegExpMatchArray | null = /^(\d{2})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(time);
    if (match === null) {
      return Number.NaN;
    }
    const year: number = 2000 + Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);
    const hour: number = Number(match[4]);
    const minute: number = Number(match[5]);
    const second: number = Number(match[6]);
    const utcTime: number = Date.UTC(year, month - 1, day, hour, minute, second);
    const parsedDate: Date = new Date(utcTime);
    if (year < 2000 || year > 2099 || parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day ||
      parsedDate.getUTCHours() !== hour || parsedDate.getUTCMinutes() !== minute || parsedDate.getUTCSeconds() !== second) {
      return Number.NaN;
    }
    return utcTime - 8 * 60 * 60 * 1000;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
