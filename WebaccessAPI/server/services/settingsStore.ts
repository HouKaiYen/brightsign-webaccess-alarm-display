import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AlarmMarker, AlarmSettings, FloorPlan, IdleMedia, IdleSettings, VersionedIdleSettings } from '../../shared/contracts.js';
import { DefaultIdleSettings, EmptySettings, MarqueeSpeedOptions } from '../../shared/contracts.js';

export class SettingsConflictError extends Error {
  public constructor() {
    super('設定版本已更新，請重新載入後再儲存。');
    this.name = 'SettingsConflictError';
  }
}

export class SettingsValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

export class SettingsStore {
  private readonly _settingsPath: string;
  private readonly _dataDirectory: string;
  private _saveQueue: Promise<void> = Promise.resolve();

  public constructor(dataDirectory: string) {
    this._dataDirectory = path.resolve(dataDirectory);
    this._settingsPath = path.join(this._dataDirectory, 'settings.json');
  }

  public async initialize(): Promise<void> {
    await mkdir(path.join(this._dataDirectory, 'uploads'), { recursive: true });
    try {
      await readFile(this._settingsPath, 'utf8');
    } catch (error: unknown) {
      if (this.isFileNotFound(error)) {
        await this.writeSettings(EmptySettings);
        return;
      }
      throw error;
    }
    await this.getSettings();
  }

  public async getSettings(): Promise<AlarmSettings> {
    try {
      const jsonText: string = await readFile(this._settingsPath, 'utf8');
      const settings: unknown = JSON.parse(jsonText);
      if (!this.isAlarmSettings(settings)) {
        throw new SettingsValidationError('伺服器設定檔格式無效。');
      }
      return await this.migrateLegacyPages(settings);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new SettingsValidationError('伺服器設定檔不是有效 JSON。');
      }
      throw error;
    }
  }

  public saveSettings(candidate: unknown): Promise<AlarmSettings> {
    const operation: Promise<AlarmSettings> = this._saveQueue.then(() => this.saveSettingsInSequence(candidate));
    this._saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async saveSettingsInSequence(candidate: unknown): Promise<AlarmSettings> {
    if (!this.isAlarmSettings(candidate)) {
      throw new SettingsValidationError('設定資料格式無效。');
    }

    const currentSettings: AlarmSettings = await this.getSettings();
    if (candidate.version !== currentSettings.version) {
      throw new SettingsConflictError();
    }

    await this.validateSettings(candidate);
    const savedSettings: AlarmSettings = {
      ...candidate,
      version: currentSettings.version + 1,
    };
    if (candidate.idle !== undefined || currentSettings.idle !== undefined) {
      savedSettings.idle = candidate.idle ?? currentSettings.idle;
    }
    await this.writeSettings(savedSettings);
    return savedSettings;
  }

  public async getIdleSettings(): Promise<VersionedIdleSettings> {
    const settings: AlarmSettings = await this.getSettings();
    const idleSettings: IdleSettings = settings.idle ?? {
      ...DefaultIdleSettings,
      items: settings.idleImageUrl === '' ? [] : [{
        id: 'legacy-idle-image',
        name: '舊版待機圖片',
        kind: 'image',
        url: settings.idleImageUrl,
        durationSeconds: 10,
      }],
    };
    return { ...idleSettings, version: settings.version };
  }

  public saveIdleSettings(candidate: unknown): Promise<VersionedIdleSettings> {
    const operation: Promise<VersionedIdleSettings> = this._saveQueue.then(() => this.saveIdleSettingsInSequence(candidate));
    this._saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async saveIdleSettingsInSequence(candidate: unknown): Promise<VersionedIdleSettings> {
    if (!this.isRecord(candidate) || !Number.isInteger(candidate.version)) {
      throw new SettingsValidationError('待機媒體設定格式無效。');
    }
    const currentSettings: AlarmSettings = await this.getSettings();
    if (candidate.version !== currentSettings.version) {
      throw new SettingsConflictError();
    }
    const idleSettings: IdleSettings = {
      items: candidate.items as IdleMedia[],
      isMuted: candidate.isMuted as boolean,
      marquee: candidate.marquee as IdleSettings['marquee'],
    };
    this.validateIdleSettings(idleSettings);
    for (const item of idleSettings.items) {
      await this.validateAssetUrl(item.url, '待機媒體');
      for (const pageUrl of item.pageUrls ?? []) {
        await this.validateAssetUrl(pageUrl, 'PDF 頁面');
      }
    }
    const savedSettings: AlarmSettings = { ...currentSettings, idle: idleSettings, version: currentSettings.version + 1 };
    savedSettings.idleImageUrl = '';
    await this.writeSettings(savedSettings);
    return { ...idleSettings, version: savedSettings.version };
  }

  public createUploadName(extension: string): string {
    return `${randomUUID()}${extension}`;
  }

  public getUploadsDirectory(): string {
    return path.join(this._dataDirectory, 'uploads');
  }

  private async writeSettings(settings: AlarmSettings): Promise<void> {
    await mkdir(this._dataDirectory, { recursive: true });
    const temporaryPath: string = path.join(this._dataDirectory, `settings.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, this._settingsPath);
  }

  private async migrateLegacyPages(settings: AlarmSettings): Promise<AlarmSettings> {
    // 待機檔案可能被搬移或刪除；讀取時保留引用，讓管理頁仍能修復清單。
    await this.validateSettings(settings, true, false);
    const markersByPageId: Map<string, AlarmMarker[]> = new Map<string, AlarmMarker[]>();
    for (const marker of settings.markers) {
      const pageMarkers: AlarmMarker[] = markersByPageId.get(marker.pageId) ?? [];
      pageMarkers.push(marker);
      markersByPageId.set(marker.pageId, pageMarkers);
    }
    if (![...markersByPageId.values()].some((pageMarkers) => pageMarkers.length > 1)) {
      await this.validateSettings(settings, false, false);
      return settings;
    }

    const migratedSettings: AlarmSettings = {
      ...settings,
      version: settings.version + 1,
      pages: settings.pages.map((page) => ({ ...page })),
      markers: settings.markers.map((marker) => ({ ...marker })),
    };
    const pagesById: Map<string, FloorPlan> = new Map<string, FloorPlan>(
      migratedSettings.pages.map((page) => [page.id, page]),
    );
    const markerIndexesByPageId: Map<string, number[]> = new Map<string, number[]>();
    migratedSettings.markers.forEach((marker, markerIndex) => {
      const markerIndexes: number[] = markerIndexesByPageId.get(marker.pageId) ?? [];
      markerIndexes.push(markerIndex);
      markerIndexesByPageId.set(marker.pageId, markerIndexes);
    });

    for (const [pageId, markerIndexes] of markerIndexesByPageId) {
      if (markerIndexes.length < 2) {
        continue;
      }
      const originalPage: FloorPlan | undefined = pagesById.get(pageId);
      if (originalPage === undefined) {
        throw new SettingsValidationError('舊版警報資料引用不存在的平面圖，無法升級。');
      }
      for (const markerIndex of markerIndexes.slice(1)) {
        const marker: AlarmMarker = migratedSettings.markers[markerIndex];
        const pageIdForMarker: string = randomUUID();
        migratedSettings.pages.push({
          ...originalPage,
          id: pageIdForMarker,
          name: `${originalPage.name} - ${marker.name}`,
        });
        marker.pageId = pageIdForMarker;
      }
    }

    await this.validateSettings(migratedSettings, false, false);
    await this.writeSettings(migratedSettings);
    return migratedSettings;
  }

  private async validateSettings(settings: AlarmSettings, allowLegacyMultipleMarkersPerPage: boolean = false, shouldRequireIdleFiles: boolean = true): Promise<void> {
    if (!Number.isInteger(settings.version) || settings.version < 1) {
      throw new SettingsValidationError('設定版本必須是正整數。');
    }
    if (!Array.isArray(settings.pages) || !Array.isArray(settings.markers) || typeof settings.idleImageUrl !== 'string') {
      throw new SettingsValidationError('平面圖、警報標記或待機圖片設定格式錯誤。');
    }

    const pageIds: Set<string> = new Set<string>();
    if (settings.floorPlanImages !== undefined) {
      if (!Array.isArray(settings.floorPlanImages)) {
        throw new SettingsValidationError('平面圖庫格式無效。');
      }
      const imageIds: Set<string> = new Set<string>();
      for (const image of settings.floorPlanImages) {
        this.validatePage(image);
        if (imageIds.has(image.id)) {
          throw new SettingsValidationError('平面圖庫識別碼不可重複。');
        }
        imageIds.add(image.id);
        await this.validateAssetUrl(image.imageUrl, '平面圖庫');
      }
    }
    for (const page of settings.pages) {
      this.validatePage(page);
      if (pageIds.has(page.id)) {
        throw new SettingsValidationError('平面圖識別碼不可重複。');
      }
      pageIds.add(page.id);
      if (page.imageUrl !== '') {
        await this.validateAssetUrl(page.imageUrl, '平面圖');
      }
    }

    const markerIds: Set<string> = new Set<string>();
    const markerNames: Set<string> = new Set<string>();
    const markerPageIds: Set<string> = new Set<string>();
    for (const marker of settings.markers) {
      this.validateMarker(marker);
      if (markerIds.has(marker.id)) {
        throw new SettingsValidationError('警報標記識別碼不可重複。');
      }
      if (markerNames.has(marker.name)) {
        throw new SettingsValidationError(`測點 Name「${marker.name}」不可重複設定。`);
      }
      if (!pageIds.has(marker.pageId)) {
        throw new SettingsValidationError(`測點「${marker.name}」指定的平面圖不存在。`);
      }
      if (!allowLegacyMultipleMarkersPerPage && markerPageIds.has(marker.pageId)) {
        throw new SettingsValidationError(`平面圖只能設定一個測點；「${marker.name}」所屬頁面已有測點。`);
      }
      markerIds.add(marker.id);
      markerNames.add(marker.name);
      markerPageIds.add(marker.pageId);
      if (marker.iconKind === 'custom') {
        await this.validateAssetUrl(marker.iconUrl, '自訂警報圖示');
      }
    }

    if (settings.idleImageUrl !== '') {
      await this.validateAssetUrl(settings.idleImageUrl, '待機圖片', shouldRequireIdleFiles);
    }
    if (settings.idle !== undefined) {
      this.validateIdleSettings(settings.idle);
      for (const item of settings.idle.items) {
        await this.validateAssetUrl(item.url, '待機媒體', shouldRequireIdleFiles);
        for (const pageUrl of item.pageUrls ?? []) {
          await this.validateAssetUrl(pageUrl, 'PDF 頁面', shouldRequireIdleFiles);
        }
      }
    }
  }

  private validateIdleSettings(settings: IdleSettings): void {
    if (!this.isRecord(settings) || !Array.isArray(settings.items) || settings.items.length > 200 || typeof settings.isMuted !== 'boolean' ||
      !this.isRecord(settings.marquee) || typeof settings.marquee.isEnabled !== 'boolean' ||
      typeof settings.marquee.text !== 'string' || settings.marquee.text.length > 500 || !MarqueeSpeedOptions.some((option) => option.value === settings.marquee.speed) ||
      (settings.marquee.position !== undefined && !['top', 'bottom'].includes(settings.marquee.position))) {
      throw new SettingsValidationError('待機媒體、聲音或跑馬燈設定格式無效。');
    }
    const ids: Set<string> = new Set<string>();
    for (const item of settings.items) {
      if (!this.isRecord(item) || typeof item.id !== 'string' || item.id.trim() === '' || ids.has(item.id) ||
        typeof item.name !== 'string' || item.name.trim() === '' || !['image', 'gif', 'video', 'pdf'].includes(String(item.kind)) ||
        typeof item.url !== 'string' || !Number.isInteger(item.durationSeconds) || item.durationSeconds < 3 || item.durationSeconds > 300 ||
        !this.mediaUrlMatchesKind(String(item.kind), item.url) ||
        (item.pageUrls !== undefined && (!Array.isArray(item.pageUrls) || item.pageUrls.some((url: unknown) => typeof url !== 'string')))) {
        throw new SettingsValidationError('待機媒體欄位無效或識別碼重複。');
      }
      if (item.kind === 'pdf' && (!Array.isArray(item.pageUrls) || item.pageUrls.length === 0 || item.pageUrls.length > 30)) {
        throw new SettingsValidationError('PDF 頁面資料無效。');
      }
      if (item.pageUrls?.some((url: string) => !/^\/uploads\/[a-zA-Z0-9-]+\.png$/i.test(url))) {
        throw new SettingsValidationError('PDF 頁面必須使用伺服器產生的 PNG 圖片。');
      }
      ids.add(item.id);
    }
  }

  private mediaUrlMatchesKind(kind: string, url: string): boolean {
    if (kind === 'image') {
      return /^\/uploads\/[a-zA-Z0-9-]+\.(?:png|jpe?g)$/i.test(url);
    }
    const expectedExtension: string = kind === 'gif' ? 'gif' : kind === 'video' ? 'mp4' : 'pdf';
    return new RegExp(`^/uploads/[a-zA-Z0-9-]+\\.${expectedExtension}$`, 'i').test(url);
  }

  private validatePage(page: FloorPlan): void {
    if (!this.isRecord(page) || typeof page.id !== 'string' || page.id.trim() === '' ||
      typeof page.name !== 'string' || page.name.trim() === '' || typeof page.imageUrl !== 'string') {
      throw new SettingsValidationError('平面圖欄位不完整。');
    }
  }

  private validateMarker(marker: AlarmMarker): void {
    if (!this.isRecord(marker) || typeof marker.id !== 'string' || marker.id.trim() === '' ||
      typeof marker.name !== 'string' || marker.name.trim() === '' ||
      typeof marker.pageId !== 'string' || typeof marker.text !== 'string' ||
      !Number.isFinite(marker.x) || marker.x < 0 || marker.x > 100 ||
      !Number.isFinite(marker.y) || marker.y < 0 || marker.y > 100 ||
      !Number.isFinite(marker.size) || marker.size < 20 || marker.size > 160 ||
      typeof marker.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(marker.color) ||
      typeof marker.shouldBlink !== 'boolean' ||
      (marker.shouldShowExitIcon !== undefined && typeof marker.shouldShowExitIcon !== 'boolean') ||
      !['sos', 'warning', 'circle', 'push-button', 'custom'].includes(marker.iconKind) || typeof marker.iconUrl !== 'string') {
      throw new SettingsValidationError('警報標記欄位或座標、尺寸、顏色格式無效。');
    }
    if (marker.iconKind === 'custom' && marker.iconUrl === '') {
      throw new SettingsValidationError(`自訂警報圖示「${marker.name}」尚未上傳圖片。`);
    }
  }

  private async validateAssetUrl(assetUrl: string, assetLabel: string, shouldRequireFile: boolean = true): Promise<void> {
    const fileName: string | undefined = /^\/uploads\/([a-zA-Z0-9-]+\.(?:png|jpe?g|gif|mp4|pdf))$/i.exec(assetUrl)?.[1];
    if (fileName === undefined) {
      throw new SettingsValidationError(`${assetLabel}必須使用伺服器已上傳的媒體檔案。`);
    }
    if (!shouldRequireFile) return;
    try {
      await access(path.join(this.getUploadsDirectory(), fileName));
    } catch {
      throw new SettingsValidationError(`${assetLabel}引用的圖片不存在（${fileName}），請重新上傳或移除該項目。`);
    }
  }

  private isAlarmSettings(value: unknown): value is AlarmSettings {
    return this.isRecord(value) && Number.isInteger(value.version) &&
      Array.isArray(value.pages) && Array.isArray(value.markers) && typeof value.idleImageUrl === 'string';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isFileNotFound(error: unknown): boolean {
    return this.isRecord(error) && error['code'] === 'ENOENT';
  }
}
