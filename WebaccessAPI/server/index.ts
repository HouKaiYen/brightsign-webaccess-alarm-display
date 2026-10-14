import { serverConfiguration } from './config/environment.js';
import { createApplication, type ApplicationRuntime } from './app.js';

const application: ApplicationRuntime = await createApplication(serverConfiguration);
application.httpServer.listen(serverConfiguration.port, serverConfiguration.host, () => {
  process.stdout.write(`BrightSign WebAccess 服務已啟動於 ${serverConfiguration.host}:${serverConfiguration.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void application.close().finally(() => process.exit(0));
  });
}
