import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { IdleMedia, IdleMediaKind } from '../../shared/contracts.js';
import { convertPdfToPngPages } from '../services/pdfConversionService.js';
import { SettingsStore } from '../services/settingsStore.js';
import { MediaLibraryStore } from '../services/mediaLibraryStore.js';

const imageLimit: number = 20 * 1024 * 1024;
const pdfLimit: number = 30 * 1024 * 1024;
const videoLimit: number = 100 * 1024 * 1024;
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: videoLimit, files: 1 },
});

export function createMediaRouter(settingsStore: SettingsStore): Router {
  const router: Router = Router();
  const mediaLibrary: MediaLibraryStore = new MediaLibraryStore(settingsStore);
  router.get('/media', async (_request: Request, response: Response): Promise<void> => {
    try { response.json({ items: await mediaLibrary.listMedia() }); }
    catch { response.status(500).json({ error: '無法讀取現有媒體，請稍後重試。' }); }
  });
  router.post('/media', (request: Request, response: Response): void => {
    mediaUpload.single('media')(request, response, (uploadError: unknown): void => {
      if (uploadError !== undefined && uploadError !== null) {
        const errorMessage: string = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE'
          ? '影片大小不可超過 100 MB；圖片不可超過 20 MB，PDF 不可超過 30 MB。'
          : '上傳媒體失敗，請確認檔案欄位名稱為 media。';
        response.status(uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: errorMessage });
        return;
      }
      void saveUploadedMedia(request, response, settingsStore, mediaLibrary);
    });
  });
  return router;
}

async function saveUploadedMedia(request: Request, response: Response, settingsStore: SettingsStore, mediaLibrary: MediaLibraryStore): Promise<void> {
  const file: Express.Multer.File | undefined = request.file;
  if (file === undefined) {
    response.status(400).json({ error: '請提供 media 媒體檔案。' });
    return;
  }
  const detectedMedia: { extension: string; kind: IdleMediaKind } | null = detectMedia(file.buffer);
  if (detectedMedia === null) {
    response.status(400).json({ error: '檔案內容不是有效的 PNG、JPEG、GIF、MP4 或 PDF。' });
    return;
  }
  const limit: number = detectedMedia.kind === 'video' ? videoLimit : detectedMedia.kind === 'pdf' ? pdfLimit : imageLimit;
  if (file.size > limit) {
    response.status(413).json({ error: detectedMedia.kind === 'video' ? '影片大小不可超過 100 MB。' : detectedMedia.kind === 'pdf' ? 'PDF 大小不可超過 30 MB。' : '圖片大小不可超過 20 MB。' });
    return;
  }

  const identifier: string = randomUUID();
  const fileName: string = `${identifier}${detectedMedia.extension}`;
  const savedPaths: string[] = [];
  try {
    if (detectedMedia.kind === 'pdf') {
      let pageBuffers: Buffer[];
      try {
        pageBuffers = await convertPdfToPngPages(file.buffer);
      } catch (error: unknown) {
        const isPasswordProtected: boolean = error instanceof Error && error.name === 'PasswordException';
        response.status(400).json({ error: isPasswordProtected ? 'PDF 有密碼保護，請先移除密碼再上傳。' : error instanceof Error ? error.message : 'PDF 無法讀取，請確認檔案未損毀。' });
        return;
      }
      const pageUrls: string[] = [];
      for (let pageIndex: number = 0; pageIndex < pageBuffers.length; pageIndex += 1) {
        const pageFileName: string = `${identifier}-page-${pageIndex + 1}.png`;
        const pagePath: string = path.join(settingsStore.getUploadsDirectory(), pageFileName);
        await writeFile(pagePath, pageBuffers[pageIndex], { flag: 'wx' });
        savedPaths.push(pagePath);
        pageUrls.push(`/uploads/${pageFileName}`);
      }
      await writeFile(path.join(settingsStore.getUploadsDirectory(), fileName), file.buffer, { flag: 'wx' });
      savedPaths.push(path.join(settingsStore.getUploadsDirectory(), fileName));
      const media: IdleMedia = { id: identifier, name: getMediaDisplayName(request.body as unknown, file.originalname, 'PDF 文件'), kind: 'pdf', url: `/uploads/${fileName}`, pageUrls, durationSeconds: 10 };
      await mediaLibrary.recordMedia(media);
    response.status(201).json({ media });
      return;
    }
    const destination: string = path.join(settingsStore.getUploadsDirectory(), fileName);
    await writeFile(destination, file.buffer, { flag: 'wx' });
    savedPaths.push(destination);
    const media: IdleMedia = {
      id: identifier,
      name: getMediaDisplayName(request.body as unknown, file.originalname, '媒體檔案'),
      kind: detectedMedia.kind,
      url: `/uploads/${fileName}`,
      durationSeconds: 10,
    };
    await mediaLibrary.recordMedia(media);
    response.status(201).json({ media });
  } catch {
    await Promise.all(savedPaths.map(async (savedPath: string) => unlink(savedPath).catch(() => undefined)));
    response.status(500).json({ error: '媒體保存失敗，請稍後再試。' });
  }
}

function detectMedia(buffer: Buffer): { extension: string; kind: IdleMediaKind } | null {
  if (buffer.length >= 45 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.subarray(12, 16).toString('ascii') === 'IHDR' && buffer.subarray(buffer.length - 8, buffer.length - 4).toString('ascii') === 'IEND') {
    return { extension: '.png', kind: 'image' };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    return { extension: '.jpg', kind: 'image' };
  }
  if (buffer.length >= 13 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')) && buffer[buffer.length - 1] === 0x3b) {
    return { extension: '.gif', kind: 'gif' };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { extension: '.mp4', kind: 'video' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { extension: '.pdf', kind: 'pdf' };
  }
  return null;
}

function getMediaDisplayName(body: unknown, originalName: string, fallback: string): string {
  let fileName: string = originalName;
  if (typeof body === 'object' && body !== null && 'displayName' in body && typeof body.displayName === 'string') {
    fileName = body.displayName;
  } else if (Array.from(originalName).every((character: string) => character.charCodeAt(0) <= 255)) {
    // 舊版 multipart 檔名可能被當作 Latin-1 解碼；只在位元組是有效 UTF-8 時還原。
    try { fileName = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(originalName, 'latin1')); }
    catch { fileName = originalName; }
  }
  return (path.parse(fileName).name.trim() || fallback).slice(0, 200);
}
