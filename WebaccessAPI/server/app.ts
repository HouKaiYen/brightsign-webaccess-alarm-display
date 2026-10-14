import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { serverConfiguration, type ServerConfiguration } from './config/environment.js';
import { createDisplayRouter } from './routes/displayRoutes.js';
import { createConnectionSettingsRouter } from './routes/connectionSettingsRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createUploadRouter } from './routes/uploadRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { createIdleSettingsRouter } from './routes/idleSettingsRoutes.js';
import { createMediaRouter } from './routes/mediaRoutes.js';
import { AlarmMonitor } from './services/alarmMonitor.js';
import { SettingsStore } from './services/settingsStore.js';
import { WebAccessClient } from './services/webAccessClient.js';
import { ConnectionSettingsStore } from './services/connectionSettingsStore.js';
import { DpapiSecretProtector, type SecretProtector } from './services/secretProtector.js';

export interface ApplicationRuntime {
  app: Express;
  httpServer: HttpServer;
  socketServer: SocketServer;
  settingsStore: SettingsStore;
  connectionSettingsStore: ConnectionSettingsStore;
  alarmMonitor: AlarmMonitor;
  close(): Promise<void>;
}

export async function createApplication(
  configuration: ServerConfiguration = serverConfiguration,
  options: { secretProtector?: SecretProtector } = {},
): Promise<ApplicationRuntime> {
  const connectionSettingsStore: ConnectionSettingsStore = new ConnectionSettingsStore(
    configuration.dataDirectory,
    configuration,
    options.secretProtector ?? new DpapiSecretProtector(),
  );
  await connectionSettingsStore.initialize();
  const settingsStore: SettingsStore = new SettingsStore(configuration.dataDirectory);
  await settingsStore.initialize();
  const webAccessClient: WebAccessClient = new WebAccessClient(configuration);
  const alarmMonitor: AlarmMonitor = new AlarmMonitor(configuration, settingsStore, webAccessClient);
  await alarmMonitor.initialize();

  const app: Express = express();
  const httpServer: HttpServer = createServer(app);
  const socketServer: SocketServer = new SocketServer(httpServer, { serveClient: true });
  const distDirectory: string = path.resolve(configuration.distDirectory);

  app.disable('x-powered-by');
  app.use((_request: Request, response: Response, next: express.NextFunction): void => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', (request: Request, response: Response, next: express.NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
    // 瀏覽器的跨來源表單也能送出上傳請求，必須在解析內容前拒絕。
    const origin: string | undefined = request.headers.origin;
    let isSameOrigin: boolean = origin === undefined;
    try {
      if (origin !== undefined) isSameOrigin = new URL(origin).origin === new URL(request.protocol + '://' + request.headers.host).origin;
    } catch { isSameOrigin = false; }
    if (!isSameOrigin || request.headers['sec-fetch-site'] === 'cross-site') {
      response.status(403).json({ error: '不允許其他網站修改設定或上傳檔案，請直接開啟本系統管理頁。' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createSettingsRouter(settingsStore, alarmMonitor));
  app.use('/api', createConnectionSettingsRouter(connectionSettingsStore, alarmMonitor));
  app.use('/api', createUploadRouter(settingsStore));
  app.use('/api', createDisplayRouter(alarmMonitor, webAccessClient));
  app.use('/api', createSystemRouter(alarmMonitor));
  app.use('/api', createIdleSettingsRouter(settingsStore, alarmMonitor));
  app.use('/api', createMediaRouter(settingsStore));
  app.use('/uploads', express.static(settingsStore.getUploadsDirectory(), {
    fallthrough: false, index: false,
    setHeaders: (response): void => {
      // 即使媒體包含額外的 HTML 或 PDF 腳本，直接開啟時也不允許執行。
      response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; script-src 'none'");
    },
  }));
  app.use(express.static(distDirectory, { fallthrough: true, index: false }));

  app.get('/', (_request: Request, response: Response): void => {
    response.redirect(302, '/display');
  });
  app.get('/display', (_request: Request, response: Response): void => {
    response.sendFile(path.join(distDirectory, 'display.html'));
  });
  app.get('/settings', (_request: Request, response: Response): void => {
    response.sendFile(path.join(distDirectory, 'settings.html'));
  });

  app.get('/engineering', (_request: Request, response: Response): void => {
    response.sendFile(path.join(distDirectory, 'engineering.html'));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction): void => {
    if (error instanceof Error && 'code' in error && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: '圖片大小不可超過 10 MB。' });
      return;
    }
    if (error instanceof Error && error.message.includes('只接受 PNG 或 JPEG')) {
      response.status(400).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: '伺服器處理請求失敗。' });
  });

  alarmMonitor.subscribe((state) => socketServer.emit('display-state', state));
  socketServer.on('connection', (socket) => {
    socket.emit('display-state', alarmMonitor.getDisplayState());
  });
  await alarmMonitor.setIsRunning(true);

  return {
    app,
    httpServer,
    socketServer,
    settingsStore,
    connectionSettingsStore,
    alarmMonitor,
    close: async (): Promise<void> => {
      await alarmMonitor.stop();
      await new Promise<void>((resolve, reject) => {
        socketServer.close((error?: Error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error?: Error) => {
            if (error !== undefined) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    },
  };
}
