import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import type { UploadResult } from '../../shared/contracts.js';
import { SettingsStore } from '../services/settingsStore.js';

const maximumImageSize: number = 10 * 1024 * 1024;
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumImageSize, files: 1 },
  fileFilter: (_request: Request, file: Express.Multer.File, callback: FileFilterCallback): void => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      callback(null, true);
      return;
    }
    callback(new Error('只接受 PNG 或 JPEG 圖片。'));
  },
});

export function createUploadRouter(settingsStore: SettingsStore): Router {
  const router: Router = Router();

  router.post('/uploads', imageUpload.single('image'), async (request: Request, response: Response): Promise<void> => {
    const uploadedFile: Express.Multer.File | undefined = request.file;
    if (uploadedFile === undefined) {
      response.status(400).json({ error: '請提供 image 圖片檔案。' });
      return;
    }

    const detectedExtension: string | null = detectImageExtension(uploadedFile.buffer);
    if (detectedExtension === null) {
      response.status(400).json({ error: '圖片內容不是有效的 PNG 或 JPEG 檔案。' });
      return;
    }

    const fileName: string = `${randomUUID()}${detectedExtension}`;
    try {
      await writeFile(path.join(settingsStore.getUploadsDirectory(), fileName), uploadedFile.buffer, { flag: 'wx' });
      const result: UploadResult = { imageUrl: `/uploads/${fileName}` };
      response.status(201).json(result);
    } catch {
      response.status(500).json({ error: '圖片保存失敗。' });
    }
  });

  return router;
}

function detectImageExtension(buffer: Buffer): string | null {
  const isPng: boolean = buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.readUInt32BE(8) === 13 && buffer.subarray(12, 16).toString('ascii') === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 &&
    buffer.readUInt32BE(buffer.length - 12) === 0 &&
    buffer.subarray(buffer.length - 8, buffer.length - 4).toString('ascii') === 'IEND';
  if (isPng) {
    return '.png';
  }
  const isJpeg: boolean = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9 && hasJpegDimensions(buffer);
  return isJpeg ? '.jpg' : null;
}

function hasJpegDimensions(buffer: Buffer): boolean {
  let offset: number = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker: number = buffer[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength: number = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return false;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return segmentLength >= 7 && buffer.readUInt16BE(offset + 5) > 0 && buffer.readUInt16BE(offset + 7) > 0;
    }
    offset += 2 + segmentLength;
  }
  return false;
}
