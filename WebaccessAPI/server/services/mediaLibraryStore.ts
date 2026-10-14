import { randomUUID } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AlarmSettings, IdleMedia, IdleMediaKind } from '../../shared/contracts.js';
import { SettingsStore } from './settingsStore.js';

export class MediaLibraryStore {
  private readonly _settingsStore: SettingsStore;
  private readonly _catalogPath: string;
  private _saveQueue: Promise<void> = Promise.resolve();

  public constructor(settingsStore: SettingsStore) {
    this._settingsStore = settingsStore;
    this._catalogPath = path.join(path.dirname(settingsStore.getUploadsDirectory()), 'media-library.json');
  }

  public recordMedia(media: IdleMedia): Promise<void> {
    const operation: Promise<void> = this._saveQueue.then(async (): Promise<void> => {
      const catalog: IdleMedia[] = await this.readCatalog();
      const next: IdleMedia[] = [...catalog.filter((item: IdleMedia) => item.url !== media.url), media];
      const temporaryPath: string = this._catalogPath + '.' + randomUUID() + '.tmp';
      await writeFile(temporaryPath, JSON.stringify(next, null, 2), { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, this._catalogPath);
    });
    this._saveQueue = operation.catch(() => undefined);
    return operation;
  }

  public async listMedia(): Promise<IdleMedia[]> {
    const files: string[] = await readdir(this._settingsStore.getUploadsDirectory());
    const availableFiles: Set<string> = new Set(files);
    const settings: AlarmSettings = await this._settingsStore.getSettings();
    const knownMedia: Map<string, IdleMedia> = new Map((await this.readCatalog()).map((item: IdleMedia) => [item.url, item]));
    for (const item of settings.idle?.items ?? []) { if (!knownMedia.has(item.url)) knownMedia.set(item.url, item); }
    for (const image of settings.floorPlanImages ?? []) {
      if (!knownMedia.has(image.imageUrl)) knownMedia.set(image.imageUrl, { id: image.id, name: image.name, kind: 'image', url: image.imageUrl, durationSeconds: 10 });
    }
    const result: IdleMedia[] = [];
    for (const fileName of files) {
      if (!/^[a-zA-Z0-9-]+\.(png|jpe?g|gif|mp4|pdf)$/i.test(fileName)) continue;
      const pageMatch: RegExpMatchArray | null = fileName.match(/^(.*)-page-\d+\.png$/i);
      if (pageMatch !== null && availableFiles.has(pageMatch[1] + '.pdf')) continue;
      const url: string = '/uploads/' + fileName;
      const known: IdleMedia | undefined = knownMedia.get(url);
      if (known !== undefined) { result.push(known); continue; }
      const extension: string = path.extname(fileName).toLowerCase();
      const identifier: string = path.parse(fileName).name;
      const kind: IdleMediaKind = extension === '.pdf' ? 'pdf' : extension === '.mp4' ? 'video' : extension === '.gif' ? 'gif' : 'image';
      const media: IdleMedia = { id: identifier, name: identifier, kind, url, durationSeconds: 10 };
      if (kind === 'pdf') {
        media.pageUrls = files.filter((candidate: string) => candidate.startsWith(identifier + '-page-') && /^.*-page-\d+\.png$/.test(candidate)).sort((first: string, second: string) => Number(first.match(/-page-(\d+)\.png$/)?.[1]) - Number(second.match(/-page-(\d+)\.png$/)?.[1])).map((page: string) => '/uploads/' + page);
        if (media.pageUrls.length === 0) continue;
      }
      result.push(media);
    }
    return result.sort((first: IdleMedia, second: IdleMedia) => first.name.localeCompare(second.name, 'zh-Hant'));
  }

  private async readCatalog(): Promise<IdleMedia[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this._catalogPath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('媒體圖庫格式無效。');
      return parsed.filter((item: unknown): item is IdleMedia => typeof item === 'object' && item !== null && 'url' in item && typeof item.url === 'string' && /^\/uploads\/[a-zA-Z0-9-]+\.(png|jpe?g|gif|mp4|pdf)$/i.test(item.url) && 'name' in item && typeof item.name === 'string');
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }
}
