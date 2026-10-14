import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createApplication, type ApplicationRuntime } from '../server/app.js';

test('停止監控保留設定服務，重新啟動及重複操作正常，原始碼模式拒絕更改開機排程', async () => {
  const directory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-system-'));
  const runtime: ApplicationRuntime = await createApplication({ host: '127.0.0.1', port: 0, dataDirectory: directory, distDirectory: directory, webAccessApiBase: '', webAccessProject: '', webAccessUsername: '', webAccessPassword: '', pollIntervalMs: 10000, requestTimeoutMs: 100 });
  try {
    await new Promise<void>((resolve) => runtime.httpServer.listen(0, '127.0.0.1', resolve));
    const baseUrl: string = `http://127.0.0.1:${(runtime.httpServer.address() as AddressInfo).port}`;
    for (const isMonitoring of [false, false, true, true]) {
      const response: Response = await fetch(`${baseUrl}/api/monitoring`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isMonitoring }) });
      assert.equal(response.status, 200);
      const status: { isMonitoring: boolean; isPortable: boolean } = await response.json() as { isMonitoring: boolean; isPortable: boolean };
      assert.equal(status.isMonitoring, isMonitoring);
      assert.equal(status.isPortable, false);
      assert.equal((await fetch(`${baseUrl}/api/settings`)).status, 200);
      const displayState: { isMonitoring: boolean } = await (await fetch(`${baseUrl}/api/display-state`)).json() as { isMonitoring: boolean };
      assert.equal(displayState.isMonitoring, isMonitoring);
    }
    assert.equal((await fetch(`${baseUrl}/api/monitoring`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"isMonitoring":"true"}' })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/startup`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"isEnabled":true}' })).status, 403);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('免安裝自啟動管理拒絕跨來源與非本機 Host，且不建立任何工作排程', async () => {
  const directory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-origin-'));
  const originalPackageDirectory: string | undefined = process.env['PORTABLE_PACKAGE_DIRECTORY'];
  process.env['PORTABLE_PACKAGE_DIRECTORY'] = directory;
  let runtime: ApplicationRuntime | null = null;
  try {
    runtime = await createApplication({ host: '127.0.0.1', port: 0, dataDirectory: directory, distDirectory: directory, webAccessApiBase: '', webAccessProject: '', webAccessUsername: '', webAccessPassword: '', pollIntervalMs: 10000, requestTimeoutMs: 100 });
    const application: ApplicationRuntime = runtime;
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const baseUrl: string = `http://127.0.0.1:${(application.httpServer.address() as AddressInfo).port}`;
    const untrustedHeaders: Array<Record<string, string>> = [{ Host: 'untrusted.example' }, { Origin: 'http://untrusted.example' }];
    for (const headers of untrustedHeaders) {
      const statusCode: number = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(`${baseUrl}/api/startup`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers } }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject);
        // 即使權限檢查退化，無效內容也不會啟動實際 Windows 排程操作。
        request.end('{"isEnabled":"true"}');
      });
      assert.equal(statusCode, 403);
    }
    const invalidResponse: Response = await fetch(`${baseUrl}/api/startup`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"isEnabled":"true"}' });
    assert.equal(invalidResponse.status, 400);
  } finally {
    if (runtime !== null) await runtime.close();
    if (originalPackageDirectory === undefined) delete process.env['PORTABLE_PACKAGE_DIRECTORY'];
    else process.env['PORTABLE_PACKAGE_DIRECTORY'] = originalPackageDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
