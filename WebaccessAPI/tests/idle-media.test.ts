import assert from 'node:assert/strict';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createIdleSettingsRouter } from '../server/routes/idleSettingsRoutes.js';
import { createMediaRouter } from '../server/routes/mediaRoutes.js';
import { SettingsStore } from '../server/services/settingsStore.js';
import { SettingsConflictError } from '../server/services/settingsStore.js';

const pngBytes: number[] = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

test('閒置媒體上傳會檢查檔案標頭，PDF 轉成各頁 PNG，設定版本可持久化', async () => {
  const dataDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'idle-media-'));
  const settingsStore: SettingsStore = new SettingsStore(dataDirectory);
  await settingsStore.initialize();
  const app: Express = express();
  app.use(express.json());
  app.use('/api', createMediaRouter(settingsStore));
  app.use('/api', createIdleSettingsRouter(settingsStore, { updateSettings: async () => undefined } as never));
  const server: HttpServer = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo = server.address() as AddressInfo;
  const baseUrl: string = `http://127.0.0.1:${address.port}`;
  try {
    const pngForm: FormData = new FormData();
    pngForm.append('media', new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }), '社區公告-é.png');
    const pngResponse: Response = await fetch(`${baseUrl}/api/media`, { method: 'POST', body: pngForm });
    assert.equal(pngResponse.status, 201);
    const pngResult = await pngResponse.json() as { media: { kind: string; url: string; name: string } };
    assert.equal(pngResult.media.kind, 'image');
    assert.equal(pngResult.media.name, '社區公告-é');
    const namedForm: FormData = new FormData();
    namedForm.append('media', new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }), 'fallback.png');
    namedForm.append('displayName', '一樓公告 2026.png');
    const namedResponse: Response = await fetch(baseUrl + '/api/media', { method: 'POST', body: namedForm });
    assert.equal((await namedResponse.json() as { media: { name: string } }).media.name, '一樓公告 2026');

    const gifForm: FormData = new FormData();
    gifForm.append('media', new Blob([new Uint8Array([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0, 0x3b])], { type: 'image/gif' }), 'loop.gif');
    assert.equal((await fetch(`${baseUrl}/api/media`, { method: 'POST', body: gifForm })).status, 201);

    const mp4Form: FormData = new FormData();
    mp4Form.append('media', new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])], { type: 'video/mp4' }), 'loop.mp4');
    assert.equal((await fetch(`${baseUrl}/api/media`, { method: 'POST', body: mp4Form })).status, 201);

    const invalidForm: FormData = new FormData();
    invalidForm.append('media', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'fake.png');
    assert.equal((await fetch(`${baseUrl}/api/media`, { method: 'POST', body: invalidForm })).status, 400);

    const pdfForm: FormData = new FormData();
    pdfForm.append('media', new Blob([new Uint8Array(createTwoPagePdf())], { type: 'application/pdf' }), 'two-pages.pdf');
    const pdfResponse: Response = await fetch(`${baseUrl}/api/media`, { method: 'POST', body: pdfForm });
    assert.equal(pdfResponse.status, 201, await pdfResponse.clone().text());
    const pdfResult = await pdfResponse.json() as { media: { pageUrls: string[] } };
    assert.equal(pdfResult.media.pageUrls.length, 2);

    const initial = await (await fetch(`${baseUrl}/api/idle-settings`)).json() as { version: number };
    const saveResponse: Response = await fetch(`${baseUrl}/api/idle-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: initial.version, items: [pdfResult.media], isMuted: true, marquee: { isEnabled: true, text: '頂部公告', speed: 'extreme', position: 'top' } }),
    });
    assert.equal(saveResponse.status, 200);
    assert.equal((await saveResponse.json() as { version: number }).version, initial.version + 1);
    const conflictResponse: Response = await fetch(`${baseUrl}/api/idle-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: initial.version, items: [], isMuted: true, marquee: { isEnabled: false, text: '', speed: 'normal' } }),
    });
    assert.equal(conflictResponse.status, 409);
    const invalidPathResponse: Response = await fetch(`${baseUrl}/api/idle-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: initial.version + 1, items: [{ id: 'bad', name: '外部', kind: 'image', url: 'https://example.com/x.png', durationSeconds: 10 }], isMuted: true, marquee: { isEnabled: false, text: '', speed: 'normal' } }),
    });
    assert.equal(invalidPathResponse.status, 400);
    const libraryResponse: Response = await fetch(baseUrl + '/api/media');
    assert.equal(libraryResponse.status, 200);
    const library: { items: Array<{ name: string; kind: string; pageUrls?: string[] }> } = await libraryResponse.json() as { items: Array<{ name: string; kind: string; pageUrls?: string[] }> };
    assert.ok(library.items.some((item) => item.name === '社區公告-é'));
    assert.ok(library.items.some((item) => item.name === '一樓公告 2026'));
    assert.equal(library.items.filter((item) => item.kind === 'pdf').length, 1);
    assert.equal(library.items.find((item) => item.kind === 'pdf')?.pageUrls?.length, 2);
    const restartedStore: SettingsStore = new SettingsStore(dataDirectory);
    await restartedStore.initialize();
    const persistedIdle = await restartedStore.getIdleSettings();
    assert.equal(persistedIdle.marquee.position, 'top');
    assert.equal(persistedIdle.marquee.speed, 'extreme');
    await restartedStore.saveIdleSettings({ ...persistedIdle, items: [] });
    const retainedLibrary = await (await fetch(baseUrl + '/api/media')).json() as { items: Array<{ kind: string }> };
    assert.ok(retainedLibrary.items.some((item) => item.kind === 'pdf'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('閒置設定與警報設定共用版本佇列，並行儲存不會互相覆蓋', async () => {
  const dataDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'idle-media-race-'));
  const settingsStore: SettingsStore = new SettingsStore(dataDirectory);
  try {
    await settingsStore.initialize();
    const currentSettings = await settingsStore.getSettings();
    const simultaneousSaves: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      settingsStore.saveSettings({ ...currentSettings, pages: [{ id: 'page-a', name: 'A', imageUrl: '' }] }),
      settingsStore.saveIdleSettings({ version: currentSettings.version, items: [], isMuted: true, marquee: { isEnabled: false, text: '', speed: 'normal' } }),
    ]);
    assert.equal(simultaneousSaves.filter((result: PromiseSettledResult<unknown>) => result.status === 'fulfilled').length, 1);
    const rejectedSave: PromiseRejectedResult | undefined = simultaneousSaves.find((result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(rejectedSave?.reason instanceof SettingsConflictError);
    const finalSettings = await settingsStore.getSettings();
    assert.equal(finalSettings.version, currentSettings.version + 1);
    assert.ok(finalSettings.pages.length === 1 || finalSettings.idle !== undefined);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

function createTwoPagePdf(): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] /Resources << >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 90 90] /Resources << >> >>',
  ];
  let content: string = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((objectText: string, index: number) => {
    offsets.push(Buffer.byteLength(content, 'ascii'));
    content += `${index + 1} 0 obj\n${objectText}\nendobj\n`;
  });
  const crossReferenceOffset: number = Buffer.byteLength(content, 'ascii');
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    content += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return Buffer.from(content, 'ascii');
}
