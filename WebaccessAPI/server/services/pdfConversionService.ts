import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPackageDirectory: string = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const maximumPdfPages: number = 30;
const maximumDimension: number = 1920;
const maximumPixelsPerPage: number = 3_686_400;
const maximumTotalPixels: number = 40_000_000;
const maximumPageRenderMilliseconds: number = 10_000;

export async function convertPdfToPngPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    stopAtErrors: true,
    useSystemFonts: true,
    cMapUrl: path.join(pdfPackageDirectory, 'cmaps').split(path.sep).join('/') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfPackageDirectory, 'standard_fonts').split(path.sep).join('/') + '/',
    wasmUrl: path.join(pdfPackageDirectory, 'wasm').split(path.sep).join('/') + '/',
  });
  const document: PDFDocumentProxy = await loadingTask.promise;
  if (document.numPages < 1 || document.numPages > maximumPdfPages) {
    await loadingTask.destroy();
    throw new Error('PDF 頁數必須介於 1 到 30 頁。');
  }

  const pageBuffers: Buffer[] = [];
  let renderedPixels: number = 0;
  try {
    for (let pageNumber: number = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page: PDFPageProxy = await document.getPage(pageNumber);
      const baseViewport: PageViewport = page.getViewport({ scale: 1 });
      const scale: number = Math.min(
        2,
        maximumDimension / Math.max(baseViewport.width, baseViewport.height),
        Math.sqrt(maximumPixelsPerPage / (baseViewport.width * baseViewport.height)),
      );
      const viewport: PageViewport = page.getViewport({ scale });
      renderedPixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
      if (renderedPixels > maximumTotalPixels) {
        throw new Error('PDF 頁面總尺寸過大，無法安全轉換。');
      }
      const canvas: Canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      const context: SKRSContext2D = canvas.getContext('2d');
      let timeoutHandle: NodeJS.Timeout | undefined;
      await Promise.race([
        page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise,
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('PDF 頁面轉換逾時。')), maximumPageRenderMilliseconds);
        }),
      ]).finally(() => clearTimeout(timeoutHandle));
      pageBuffers.push(await canvas.encode('png'));
      page.cleanup();
    }
    return pageBuffers;
  } catch (error: unknown) {
    await loadingTask.destroy();
    throw error;
  } finally {
    await loadingTask.destroy();
  }
}
