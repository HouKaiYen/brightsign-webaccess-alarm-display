import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type ClientRequest, type Server as HttpServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { ServerConfiguration } from '../server/config/environment.js';
import { createApplication, type ApplicationRuntime } from '../server/app.js';
import type { AlarmSettings } from '../shared/contracts.js';
import { SettingsStore } from '../server/services/settingsStore.js';
import type { ConnectionSettings, SaveConnectionSettingsRequest } from '../shared/contracts.js';
import { ConnectionSettingsStore } from '../server/services/connectionSettingsStore.js';
import { DpapiSecretProtector, type SecretProtector } from '../server/services/secretProtector.js';
import { DefaultIdleSettings, EmptySettings } from '../shared/contracts.js';

test('共用平面圖庫可獨立儲存，兩個測點頁面可引用相同底圖且拒絕無效圖片', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-library-'));
  const store: SettingsStore = new SettingsStore(temporaryDirectory);
  try {
    await store.initialize();
    await writeFile(path.join(store.getUploadsDirectory(), 'shared.png'), 'test image');
    const librarySettings: AlarmSettings = await store.saveSettings({ ...EmptySettings, floorPlanImages: [{ id: 'image-1', name: '1F', imageUrl: '/uploads/shared.png' }] });
    assert.equal(librarySettings.pages.length, 0);
    const sharedSettings: AlarmSettings = await store.saveSettings({
      ...librarySettings,
      pages: [{ id: 'a', name: '測點 A', imageUrl: '/uploads/shared.png' }, { id: 'b', name: '測點 B', imageUrl: '/uploads/shared.png' }],
      markers: ['a', 'b'].map((pageId: string) => ({ id: pageId, pageId, name: `Alarm-${pageId}`, text: pageId, x: 50, y: 50, size: 48, color: '#ff0000', shouldBlink: true, iconKind: pageId === 'a' ? 'push-button' : 'sos', shouldShowExitIcon: pageId === 'a', iconUrl: '' })),
    });
    const reloadedSettings: AlarmSettings = await store.getSettings();
    assert.deepEqual(reloadedSettings, sharedSettings);
    assert.equal(reloadedSettings.floorPlanImages?.length, 1);
    const restartedStore: SettingsStore = new SettingsStore(temporaryDirectory);
    await restartedStore.initialize();
    assert.equal((await restartedStore.getSettings()).markers[0].iconKind, 'push-button');
    assert.equal((await restartedStore.getSettings()).markers[0].shouldShowExitIcon, true);
    await assert.rejects(store.saveSettings({ ...sharedSettings, markers: sharedSettings.markers.map((marker) => ({ ...marker, shouldShowExitIcon: 'true' })) }), /警報標記/);
    await assert.rejects(store.saveSettings({ ...sharedSettings, floorPlanImages: [{ id: 'missing', name: '不存在', imageUrl: '/uploads/missing.png' }] }), /圖片不存在/);
    assert.deepEqual(await store.getSettings(), sharedSettings);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

interface FakeScada {
  server: HttpServer;
  setAlarmResponse(response: unknown): void;
  setTagTotalIncluded(isIncluded: boolean): void;
  setDelay(milliseconds: number): void;
  getMaximumConcurrentRequests(): number;
  getRequests(): Array<{ url: string; authorization: string | undefined }>;
  apiBase: string;
}

class FakeSecretProtector implements SecretProtector {
  public async protect(plaintext: string): Promise<string> {
    return `test-protected:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }

  public async unprotect(ciphertext: string): Promise<string> {
    if (!ciphertext.startsWith('test-protected:')) {
      throw new Error('密文格式錯誤。');
    }
    return Buffer.from(ciphertext.slice('test-protected:'.length), 'base64').toString('utf8');
  }

  public async secureFile(_filePath: string): Promise<void> {
    return;
  }
}

class UnavailableSecretProtector extends FakeSecretProtector {
  public async unprotect(_ciphertext: string): Promise<string> {
    throw new Error('DPAPI 無法解密目前主機的密文。');
  }
}

async function createFakeScada(): Promise<FakeScada> {
  let alarmResponse: unknown = { Result: { Ret: 0, Total: 0 }, AlarmTagList: [] };
  let includeTagTotal: boolean = false;
  let delayMs: number = 0;
  let activeRequests: number = 0;
  let maximumConcurrentRequests: number = 0;
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const server: HttpServer = createServer((request, response) => {
    void (async (): Promise<void> => {
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (request.url?.includes('/TagList/')) {
        const result: { Ret: number; Total?: number } = { Ret: 0 };
        if (includeTagTotal) {
          result.Total = 2;
        }
        response.end(JSON.stringify({
          Result: result,
          Tags: [
            { Name: '1008-16_DI8', Description: 'R2F_安全門磁簧' },
            { Name: '1800-26_DI5', Description: '4F_無障礙磁簧' },
          ],
        }));
      } else {
        response.end(JSON.stringify(alarmResponse));
      }
      activeRequests -= 1;
    })();
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port: number = (server.address() as AddressInfo).port;
  return {
    server,
    setAlarmResponse: (response: unknown): void => { alarmResponse = response; },
    setTagTotalIncluded: (isIncluded: boolean): void => { includeTagTotal = isIncluded; },
    setDelay: (milliseconds: number): void => { delayMs = milliseconds; },
    getMaximumConcurrentRequests: (): number => maximumConcurrentRequests,
    getRequests: (): Array<{ url: string; authorization: string | undefined }> => [...requests],
    apiBase: `http://127.0.0.1:${port}/WaWebService/Json`,
  };
}

function createConfiguration(dataDirectory: string, apiBase: string, pollIntervalMs: number = 100000): ServerConfiguration {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDirectory,
    distDirectory: path.join(dataDirectory, 'dist'),
    webAccessApiBase: apiBase,
    webAccessProject: 'BrightSigh',
    webAccessUsername: 'tester',
    webAccessPassword: '',
    pollIntervalMs,
    requestTimeoutMs: 500,
  };
}

async function waitForState(
  runtime: ApplicationRuntime,
  predicate: (state: ReturnType<ApplicationRuntime['alarmMonitor']['getDisplayState']>) => boolean,
): Promise<ReturnType<ApplicationRuntime['alarmMonitor']['getDisplayState']>> {
  const deadline: number = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = runtime.alarmMonitor.getDisplayState();
    if (predicate(state)) {
      return state;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('等待顯示狀態逾時。');
}

async function listen(runtime: ApplicationRuntime): Promise<string> {
  runtime.httpServer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => runtime.httpServer.once('listening', resolve));
  const port: number = (runtime.httpServer.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

test('WebAccess connection settings are protected, versioned, applied live, and preserved across restart', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-connection-'));
  const dataDirectory: string = path.join(temporaryDirectory, 'data');
  const scada: FakeScada = await createFakeScada();
  scada.setAlarmResponse({ Result: { Ret: 0, Total: 1 }, AlarmTagList: [{
    Time: '26/10/02 14:00:55', Name: '1008-16_DI8', Desc: 'R2F_安全門磁簧',
  }] });
  const configuration: ServerConfiguration = createConfiguration(dataDirectory, scada.apiBase);
  let runtime: ApplicationRuntime = await createApplication(configuration, { secretProtector: new FakeSecretProtector() });
  let baseUrl: string = await listen(runtime);

  try {
    const initialResponse: Response = await fetch(`${baseUrl}/api/connection-settings`);
    assert.equal(initialResponse.status, 200);
    const initialSettings: ConnectionSettings = await initialResponse.json() as ConnectionSettings;
    assert.deepEqual(initialSettings, {
      version: 1, apiBase: scada.apiBase, project: 'BrightSigh', username: 'tester', hasPassword: false,
    });
    assert.equal(runtime.alarmMonitor.isRunning, true);
    assert.equal((await waitForState(runtime, (state) => state.alarms.length === 1)).isMonitoring, true);

    const password: string = 'sample-secret-do-not-return';
    const saveRequest: SaveConnectionSettingsRequest = {
      version: initialSettings.version,
      apiBase: scada.apiBase,
      project: 'BrightSigh',
      username: 'operator',
      password,
    };
    const saveResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveRequest),
    });
    assert.equal(saveResponse.status, 200);
    const savedSettings: ConnectionSettings = await saveResponse.json() as ConnectionSettings;
    assert.deepEqual(savedSettings, {
      version: 2, apiBase: scada.apiBase, project: 'BrightSigh', username: 'operator', hasPassword: true,
    });
    assert.equal(JSON.stringify(savedSettings).includes(password), false);
    assert.equal(configuration.webAccessPassword, password);
    const persistedJson: string = await readFile(path.join(dataDirectory, 'connection-settings.json'), 'utf8');
    assert.equal(persistedJson.includes(password), false);
    assert.equal(persistedJson.includes('encryptedPassword'), true);
    assert.equal(persistedJson.includes('"password"'), false);
    const displayResponse: Response = await fetch(`${baseUrl}/api/display-state`);
    const displayJson: string = await displayResponse.text();
    assert.equal(displayJson.includes(password), false);
    assert.equal(displayJson.includes('encryptedPassword'), false);

    const omittedPasswordResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: savedSettings.version, apiBase: savedSettings.apiBase, project: savedSettings.project, username: savedSettings.username }),
    });
    assert.equal(omittedPasswordResponse.status, 200);
    const preservedSettings: ConnectionSettings = await omittedPasswordResponse.json() as ConnectionSettings;
    assert.equal(preservedSettings.version, 3);
    assert.equal(preservedSettings.hasPassword, true);
    const expectedAuthorization: string = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`;
    const scadaRequest: { url: string; authorization: string | undefined } | undefined = scada.getRequests().find((request) =>
      request.url.includes('/GetAlarmSummary/') && request.authorization === expectedAuthorization);
    assert.equal(scadaRequest?.authorization, expectedAuthorization);

    for (const changes of [
      { apiBase: 'http://different.invalid/WaWebService/Json' },
      { apiBase: savedSettings.apiBase + '/other' },
      { username: 'different-user' },
    ]) {
      const rejectedResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...preservedSettings, ...changes }),
      });
      assert.equal(rejectedResponse.status, 400);
      assert.match((await rejectedResponse.json() as { error: string }).error, /請重新輸入密碼/);
      assert.deepEqual(runtime.connectionSettingsStore.getPublicSettings(), preservedSettings);
      assert.equal(configuration.webAccessApiBase, scada.apiBase);
      assert.equal(configuration.webAccessPassword, password);
    }
    const untrustedHeaders: Array<Record<string, string>> = [
      { Origin: 'http://untrusted.invalid' },
      { Host: 'untrusted.invalid' },
      { Origin: baseUrl.replace('http:', 'https:') },
      { Host: '192.0.2.1', 'X-Forwarded-For': '127.0.0.1' },
    ];
    for (const headers of untrustedHeaders) {
      const statusCode: number = await new Promise<number>((resolve, reject) => {
        const request: ClientRequest = httpRequest(`${baseUrl}/api/connection-settings`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
        }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject);
        request.end(JSON.stringify({ ...preservedSettings, password: '' }));
      });
      assert.equal(statusCode, 403);
      assert.deepEqual(runtime.connectionSettingsStore.getPublicSettings(), preservedSettings);
    }

    const staleResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveRequest),
    });
    assert.equal(staleResponse.status, 409);
    const invalidUrlResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: preservedSettings.version, apiBase: 'file:///bad', project: preservedSettings.project, username: preservedSettings.username }),
    });
    assert.equal(invalidUrlResponse.status, 400);

    await runtime.close();
    const restartedConfiguration: ServerConfiguration = createConfiguration(dataDirectory, 'http://invalid.example/WaWebService/Json');
    runtime = await createApplication(restartedConfiguration, { secretProtector: new FakeSecretProtector() });
    baseUrl = await listen(runtime);
    const restartedSettings: ConnectionSettings = await (await fetch(`${baseUrl}/api/connection-settings`)).json() as ConnectionSettings;
    assert.deepEqual(restartedSettings, preservedSettings);
    assert.equal(restartedConfiguration.webAccessPassword, password);
    await waitForState(runtime, (state) => state.connectionStatus === 'connected');
    const restartedAuthorization: string = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`;
    assert.equal(scada.getRequests().some((request) => request.authorization === restartedAuthorization), true);

    scada.setAlarmResponse({ Result: { Ret: 0, Total: 0 }, AlarmTagList: [] });
    await runtime.alarmMonitor.setIsRunning(false);
    assert.equal(runtime.alarmMonitor.getDisplayState().isMonitoring, false);
    const clearResponse: Response = await fetch(`${baseUrl}/api/connection-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: preservedSettings.version, apiBase: preservedSettings.apiBase, project: preservedSettings.project, username: preservedSettings.username, password: '' }),
    });
    assert.equal(clearResponse.status, 200);
    const clearedSettings: ConnectionSettings = await clearResponse.json() as ConnectionSettings;
    assert.equal(clearedSettings.version, 4);
    assert.equal(clearedSettings.hasPassword, false);
    assert.equal(runtime.alarmMonitor.isRunning, false);
    assert.equal(runtime.alarmMonitor.getDisplayState().isMonitoring, false);

    assert.equal(restartedConfiguration.webAccessProject, 'BrightSigh');
    assert.equal(restartedConfiguration.webAccessUsername, 'operator');
    assert.equal(restartedConfiguration.webAccessPassword, '');
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => scada.server.close(() => resolve()));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('connection settings report DPAPI recovery without overwriting an unreadable password', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-dpapi-recovery-'));
  const dataDirectory: string = path.join(temporaryDirectory, 'data');
  const configuration: ServerConfiguration = createConfiguration(dataDirectory, 'http://localhost/WaWebService/Json');
  const originalJson: string = JSON.stringify({
    version: 5,
    apiBase: configuration.webAccessApiBase,
    project: 'BrightSigh',
    username: 'operator',
    encryptedPassword: 'copied-from-another-machine',
  }, null, 2) + '\n';
  const settingsPath: string = path.join(dataDirectory, 'connection-settings.json');
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(settingsPath, originalJson, 'utf8');
  const store: ConnectionSettingsStore = new ConnectionSettingsStore(dataDirectory, configuration, new UnavailableSecretProtector());
  const savedApiBase: string = configuration.webAccessApiBase;

  try {
    await store.initialize();
    assert.equal(configuration.webAccessApiBase, '');
    assert.deepEqual(store.getPublicSettings(), {
      version: 5,
      apiBase: savedApiBase,
      project: 'BrightSigh',
      username: 'operator',
      hasPassword: false,
      passwordNeedsReset: true,
    });
    await assert.rejects(store.saveSettings({
      version: 5,
      apiBase: savedApiBase,
      project: 'BrightSigh',
      username: 'operator',
    }), /請重新輸入密碼/);
    assert.equal(await readFile(settingsPath, 'utf8'), originalJson);

    const recoveredSettings: ConnectionSettings = await store.saveSettings({
      version: 5,
      apiBase: savedApiBase,
      project: 'BrightSigh',
      username: 'operator',
      password: 'replacement-secret',
    });
    assert.deepEqual(recoveredSettings, {
      version: 6,
      apiBase: savedApiBase,
      project: 'BrightSigh',
      username: 'operator',
      hasPassword: true,
    });
    assert.notEqual(await readFile(settingsPath, 'utf8'), originalJson);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('HTTP API uploads a real image, saves versioned settings, and returns WebAccess tags', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-server-'));
  const scada: FakeScada = await createFakeScada();
  scada.setAlarmResponse({ Result: { Ret: 0, Total: 1 }, AlarmTagList: [{
    Time: '26/10/02 14:00:55', Name: '1008-16_DI8', Desc: 'R2F_安全門磁簧',
  }] });
  const runtime: ApplicationRuntime = await createApplication(
    createConfiguration(path.join(temporaryDirectory, 'data'), scada.apiBase),
    { secretProtector: new FakeSecretProtector() },
  );
  const baseUrl: string = await listen(runtime);

  try {
    const uploadForm: FormData = new FormData();
    const validPng: Buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    uploadForm.append('image', new Blob([Uint8Array.from(validPng)], { type: 'image/png' }), 'floor.png');
    const uploadResponse: Response = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: uploadForm });
    assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
    const uploadResult: { imageUrl: string } = await uploadResponse.json() as { imageUrl: string };

    const initialResponse: Response = await fetch(`${baseUrl}/api/settings`);
    const initialSettings: AlarmSettings = await initialResponse.json() as AlarmSettings;
    const settingsToSave: AlarmSettings = {
      ...initialSettings,
      pages: [{ id: 'floor-1', name: '一樓', imageUrl: uploadResult.imageUrl }],
      markers: [{
        id: 'marker-1', name: '1008-16_DI8', pageId: 'floor-1', text: '安全門警報',
        x: 50, y: 50, size: 80, color: '#ff0000', shouldBlink: true, iconKind: 'sos', iconUrl: '',
      }],
    };
    const saveResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsToSave),
    });
    assert.equal(saveResponse.status, 200);
    const savedSettings: AlarmSettings = await saveResponse.json() as AlarmSettings;
    assert.equal(savedSettings.version, 2);
    const staleSaveResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsToSave),
    });
    assert.equal(staleSaveResponse.status, 409);

    const state = await waitForState(runtime, (displayState) => displayState.connectionStatus === 'connected');
    assert.equal(state.selectedPageId, 'floor-1');
    assert.deepEqual(state.alarms.map((alarm) => alarm.name), ['1008-16_DI8']);
    const tagsResponse: Response = await fetch(`${baseUrl}/api/tags`);
    assert.deepEqual(await tagsResponse.json(), {
      tags: [
        { name: '1008-16_DI8', description: 'R2F_安全門磁簧' },
        { name: '1800-26_DI5', description: '4F_無障礙磁簧' },
      ],
    });
    scada.setTagTotalIncluded(true);
    const tagsWithTotalResponse: Response = await fetch(`${baseUrl}/api/tags`);
    assert.equal(tagsWithTotalResponse.status, 200);

    const invalidImageForm: FormData = new FormData();
    invalidImageForm.append('image', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'fake.png');
    const invalidImageResponse: Response = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: invalidImageForm });
    assert.equal(invalidImageResponse.status, 400);
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => scada.server.close(() => resolve()));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('alarm selection, exact Name matching, failed polls, and version checks are stable', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-monitor-'));
  const scada: FakeScada = await createFakeScada();
  const runtime: ApplicationRuntime = await createApplication(
    createConfiguration(path.join(temporaryDirectory, 'data'), scada.apiBase, 30),
    { secretProtector: new FakeSecretProtector() },
  );
  const baseUrl: string = await listen(runtime);
  const alarm = (name: string, time: string): Record<string, string> => ({ Name: name, Desc: name, Time: time });
  const setAlarms = (alarms: Array<Record<string, string>>, total: number = alarms.length, ret: number = 0): void => {
    scada.setAlarmResponse({ Result: { Ret: ret, Total: total }, AlarmTagList: alarms });
  };

  try {
    const initialResponse: Response = await fetch(`${baseUrl}/api/settings`);
    const initialSettings: AlarmSettings = await initialResponse.json() as AlarmSettings;
    const candidate: AlarmSettings = {
      ...initialSettings,
      pages: [
        { id: 'page-a', name: 'A', imageUrl: '' },
        { id: 'page-b', name: 'B', imageUrl: '' },
        { id: 'page-c', name: 'C', imageUrl: '' },
      ],
      markers: [
        { id: 'a', name: 'Alarm-A', pageId: 'page-a', text: 'A', x: 10, y: 10, size: 40, color: '#ff0000', shouldBlink: true, iconKind: 'sos', iconUrl: '' },
        { id: 'b', name: 'Alarm-B', pageId: 'page-b', text: 'B', x: 20, y: 20, size: 40, color: '#ff0000', shouldBlink: true, iconKind: 'sos', iconUrl: '' },
        { id: 'c', name: 'Alarm-C', pageId: 'page-c', text: 'C', x: 30, y: 30, size: 40, color: '#ff0000', shouldBlink: true, iconKind: 'sos', iconUrl: '' },
      ],
    };
    const parallelResponses: Response[] = await Promise.all([candidate, candidate].map((settings) => fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    })));
    assert.deepEqual(parallelResponses.map((response) => response.status).sort(), [200, 409]);
    const savedSettings: AlarmSettings = await (await fetch(`${baseUrl}/api/settings`)).json() as AlarmSettings;

    const multipleMarkersOnOnePage: AlarmSettings = {
      ...savedSettings,
      markers: [...savedSettings.markers, { ...savedSettings.markers[0], id: 'same-page', name: 'Alarm-D' }],
    };
    const multipleMarkersResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(multipleMarkersOnOnePage),
    });
    assert.equal(multipleMarkersResponse.status, 400);

    const invalidCoordinates: AlarmSettings = {
      ...savedSettings,
      markers: savedSettings.markers.map((marker) => ({ ...marker, x: 100.1 })),
    };
    const invalidCoordinatesResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalidCoordinates),
    });
    assert.equal(invalidCoordinatesResponse.status, 400);

    const duplicateNames: AlarmSettings = {
      ...savedSettings,
      markers: [...savedSettings.markers, { ...savedSettings.markers[0], id: 'duplicate' }],
    };
    const duplicateResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(duplicateNames),
    });
    assert.equal(duplicateResponse.status, 400);

    const badAsset: AlarmSettings = {
      ...savedSettings,
      markers: [{ ...savedSettings.markers[0], iconKind: 'custom', iconUrl: '/uploads/missing.png' }],
    };
    const badAssetResponse: Response = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(badAsset),
    });
    assert.equal(badAssetResponse.status, 400);

    setAlarms([
      alarm('Alarm-A', '26/10/02 13:00:00'),
      alarm('Alarm-B', '26/10/02 12:00:00'),
      alarm('Alarm-C', '26/10/02 14:00:00'),
      alarm('Alarm-A-extra', '26/10/02 16:00:00'),
    ]);
    let state = await waitForState(runtime, (displayState) => displayState.alarms.some((item) => item.name === 'Alarm-A-extra'));
    assert.equal(state.selectedPageId, 'page-c');
    assert.equal(state.settings.markers.filter((marker) => marker.pageId === state.selectedPageId).length, 1);

    setAlarms([alarm('Alarm-A', '26/10/02 13:00:00'), alarm('Alarm-B', '26/10/02 15:00:00')]);
    state = await waitForState(runtime, (displayState) => displayState.selectedPageId === 'page-b');
    const lastSuccessAt: string | null = state.lastSuccessAt;

    setAlarms([alarm('Alarm-A', '26/10/02 15:00:00'), alarm('Alarm-B', '26/10/02 15:00:00')]);
    state = await waitForState(runtime, (displayState) => displayState.lastSuccessAt !== lastSuccessAt);
    assert.equal(state.selectedPageId, 'page-b');

    setAlarms([alarm('Alarm-A', '26/10/02 15:00:00')]);
    state = await waitForState(runtime, (displayState) => displayState.alarms.length === 1);
    assert.equal(state.selectedPageId, 'page-a');

    const beforeSlowPoll: string | null = state.lastSuccessAt;
    scada.setDelay(80);
    state = await waitForState(runtime, (displayState) => displayState.lastSuccessAt !== beforeSlowPoll);
    assert.equal(scada.getMaximumConcurrentRequests(), 1);
    scada.setDelay(0);

    const successfulAlarms: string[] = state.alarms.map((item) => item.name);
    const successfulTimestamp: string | null = state.lastSuccessAt;
    setAlarms([alarm('Alarm-C', '26/10/02 16:00:00')], 1, 9);
    state = await waitForState(runtime, (displayState) => displayState.connectionStatus === 'disconnected');
    assert.deepEqual(state.alarms.map((item) => item.name), successfulAlarms);
    assert.equal(state.lastSuccessAt, successfulTimestamp);

    setAlarms([alarm('Alarm-A', '26/10/02 15:00:00')], 2);
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    state = runtime.alarmMonitor.getDisplayState();
    assert.deepEqual(state.alarms.map((item) => item.name), successfulAlarms);

    setAlarms([alarm('Alarm-A', '26/10/02 15:00:00')]);
    await waitForState(runtime, (displayState) => displayState.connectionStatus === 'connected');
    const beforeTimeoutTimestamp: string | null = runtime.alarmMonitor.getDisplayState().lastSuccessAt;
    scada.setDelay(700);
    await waitForState(runtime, (displayState) => displayState.connectionStatus === 'disconnected');
    state = runtime.alarmMonitor.getDisplayState();
    assert.deepEqual(state.alarms.map((item) => item.name), successfulAlarms);
    assert.equal(state.lastSuccessAt, beforeTimeoutTimestamp);
    scada.setDelay(0);
    await waitForState(runtime, (displayState) => displayState.connectionStatus === 'connected');

    setAlarms([]);
    state = await waitForState(runtime, (displayState) => displayState.connectionStatus === 'connected' && displayState.alarms.length === 0);
    assert.equal(state.selectedPageId, null);

    setAlarms([alarm('Alarm-A', 'invalid'), alarm('Alarm-B', 'invalid')]);
    state = await waitForState(runtime, (displayState) => displayState.alarms.length === 2);
    const invalidTimeOrder: string[] = state.alarms.map((item) => item.name);
    setAlarms([alarm('Alarm-B', 'invalid'), alarm('Alarm-A', 'invalid')]);
    const invalidTimeLastSuccess: string | null = state.lastSuccessAt;
    state = await waitForState(runtime, (displayState) => displayState.lastSuccessAt !== invalidTimeLastSuccess && displayState.alarms.length === 2);
    assert.deepEqual(state.alarms.map((item) => item.name), invalidTimeOrder);

  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => scada.server.close(() => resolve()));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('startup migrates legacy pages with multiple markers losslessly and only once', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-migration-'));
  const dataDirectory: string = path.join(temporaryDirectory, 'data');
  const uploadsDirectory: string = path.join(dataDirectory, 'uploads');
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(path.join(uploadsDirectory, 'plan.png'), 'floor plan');
  await writeFile(path.join(uploadsDirectory, 'icon.jpg'), 'custom icon');
  const legacySettings: AlarmSettings = {
    version: 6,
    pages: [{ id: 'legacy-page', name: '舊平面圖', imageUrl: '/uploads/plan.png' }],
    markers: [
      { id: 'marker-1', name: 'Alarm-1', pageId: 'legacy-page', text: '門一', x: 11, y: 21, size: 61, color: '#123456', shouldBlink: true, iconKind: 'custom', iconUrl: '/uploads/icon.jpg' },
      { id: 'marker-2', name: 'Alarm-2', pageId: 'legacy-page', text: '門二', x: 31, y: 41, size: 81, color: '#654321', shouldBlink: false, iconKind: 'warning', iconUrl: '' },
    ],
    idleImageUrl: '',
  };
  const settingsPath: string = path.join(dataDirectory, 'settings.json');
  const serializedLegacySettings: string = JSON.stringify(legacySettings, null, 2) + '\n';
  await writeFile(settingsPath, serializedLegacySettings, 'utf8');

  try {
    const firstStore: SettingsStore = new SettingsStore(dataDirectory);
    await firstStore.initialize();
    const migratedSettings: AlarmSettings = await firstStore.getSettings();
    assert.equal(migratedSettings.version, 7);
    assert.equal(migratedSettings.pages.length, 2);
    assert.equal(migratedSettings.markers.length, 2);
    assert.equal(migratedSettings.pages[0].id, 'legacy-page');
    assert.equal(migratedSettings.pages[1].imageUrl, '/uploads/plan.png');
    assert.match(migratedSettings.pages[1].name, /Alarm-2/);
    assert.notEqual(migratedSettings.pages[1].id, 'legacy-page');
    assert.equal(migratedSettings.markers[0].pageId, 'legacy-page');
    assert.equal(migratedSettings.markers[1].pageId, migratedSettings.pages[1].id);
    assert.deepEqual(
      migratedSettings.markers.map(({ id, name, text, x, y, size, color, shouldBlink, iconKind, iconUrl }) =>
        ({ id, name, text, x, y, size, color, shouldBlink, iconKind, iconUrl })),
      legacySettings.markers.map(({ id, name, text, x, y, size, color, shouldBlink, iconKind, iconUrl }) =>
        ({ id, name, text, x, y, size, color, shouldBlink, iconKind, iconUrl })),
    );

    const secondStore: SettingsStore = new SettingsStore(dataDirectory);
    await secondStore.initialize();
    const restartedSettings: AlarmSettings = await secondStore.getSettings();
    assert.equal(restartedSettings.version, 7);
    assert.deepEqual(restartedSettings.pages, migratedSettings.pages);
    assert.deepEqual(restartedSettings.markers, migratedSettings.markers);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('startup refuses to migrate legacy settings with missing assets without rewriting them', async () => {
  const temporaryDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-invalid-migration-'));
  const dataDirectory: string = path.join(temporaryDirectory, 'data');
  const uploadsDirectory: string = path.join(dataDirectory, 'uploads');
  await mkdir(uploadsDirectory, { recursive: true });
  const legacySettings: AlarmSettings = {
    version: 3,
    pages: [{ id: 'legacy-page', name: '舊平面圖', imageUrl: '/uploads/missing.png' }],
    markers: [
      { id: 'marker-1', name: 'Alarm-1', pageId: 'legacy-page', text: '門一', x: 11, y: 21, size: 61, color: '#123456', shouldBlink: true, iconKind: 'sos', iconUrl: '' },
      { id: 'marker-2', name: 'Alarm-2', pageId: 'legacy-page', text: '門二', x: 31, y: 41, size: 81, color: '#654321', shouldBlink: false, iconKind: 'warning', iconUrl: '' },
    ],
    idleImageUrl: '',
  };
  const settingsPath: string = path.join(dataDirectory, 'settings.json');
  const serializedLegacySettings: string = JSON.stringify(legacySettings, null, 2) + '\n';
  await writeFile(settingsPath, serializedLegacySettings, 'utf8');

  try {
    const store: SettingsStore = new SettingsStore(dataDirectory);
    await assert.rejects(() => store.initialize());
    assert.equal(await readFile(settingsPath, 'utf8'), serializedLegacySettings);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

for (const missingKind of ['image', 'pdf', 'legacy'] as const) {
  test('待機缺檔仍可啟動、讀取及修復清單：' + missingKind, async (): Promise<void> => {
    const dataDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-missing-idle-'));
    const settingsPath: string = path.join(dataDirectory, 'settings.json');
    const settings: AlarmSettings = {
      ...EmptySettings,
      version: 7,
      idleImageUrl: missingKind === 'legacy' ? '/uploads/missing.png' : '',
    };
    if (missingKind !== 'legacy') {
      settings.idle = {
        ...DefaultIdleSettings,
        items: [{ id: 'missing', name: '缺少檔案的媒體', kind: missingKind,
          url: missingKind === 'pdf' ? '/uploads/missing.pdf' : '/uploads/missing.png',
          ...(missingKind === 'pdf' ? { pageUrls: ['/uploads/missing-page-1.png'] } : {}),
          durationSeconds: 10 }],
      };
    }
    const originalJson: string = JSON.stringify(settings, null, 2);
    await writeFile(settingsPath, originalJson, 'utf8');
    let runtime: ApplicationRuntime | null = null;
    try {
      runtime = await createApplication(createConfiguration(dataDirectory, ''), { secretProtector: new FakeSecretProtector() });
      const baseUrl: string = await listen(runtime);
      for (const route of ['settings', 'idle-settings', 'display-state', 'media']) {
        assert.equal((await fetch(baseUrl + '/api/' + route)).status, 200, route);
      }
      assert.deepEqual(await runtime.settingsStore.getSettings(), settings);
      assert.equal(await readFile(settingsPath, 'utf8'), originalJson);
      const idleSettings: Awaited<ReturnType<SettingsStore['getIdleSettings']>> = await runtime.settingsStore.getIdleSettings();
      const rejectedResponse: Response = await fetch(baseUrl + '/api/idle-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idleSettings),
      });
      assert.equal(rejectedResponse.status, 400);
      assert.match((await rejectedResponse.json() as { error: string }).error, /missing/);
      assert.equal(await readFile(settingsPath, 'utf8'), originalJson);
      await assert.rejects(runtime.settingsStore.saveSettings(settings), /圖片不存在/);
      if (missingKind === 'pdf') {
        await writeFile(path.join(dataDirectory, 'uploads', 'missing.pdf'), '測試用 PDF 檔案佔位');
        await assert.rejects(runtime.settingsStore.saveIdleSettings(idleSettings), /missing-page-1.png/);
      }
      const repairedResponse: Response = await fetch(baseUrl + '/api/idle-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...idleSettings, items: [] }),
      });
      assert.equal(repairedResponse.status, 200);
      const repairedSettings: AlarmSettings = await runtime.settingsStore.getSettings();
      assert.equal(repairedSettings.version, 8);
      assert.deepEqual(repairedSettings.idle?.items, []);
      assert.equal(repairedSettings.idleImageUrl, '');
      const restartedStore: SettingsStore = new SettingsStore(dataDirectory);
      await restartedStore.initialize();
      assert.deepEqual(await restartedStore.getSettings(), repairedSettings);
    } finally {
      if (runtime !== null) await runtime.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
}

test('容許既有待機缺檔仍拒絕非法路徑與損壞的設定結構', async (): Promise<void> => {
  const dataDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-invalid-idle-'));
  const settingsPath: string = path.join(dataDirectory, 'settings.json');
  try {
    for (const settings of [
      { ...EmptySettings, idleImageUrl: '/uploads/../private.png' },
      { ...EmptySettings, idle: { ...DefaultIdleSettings, items: [{ id: 'bad', name: 'bad', kind: 'image', url: 'https://example.invalid/a.png', durationSeconds: 10 }] } },
      { ...EmptySettings, idle: { ...DefaultIdleSettings, items: 'invalid' } },
    ]) {
      const originalJson: string = JSON.stringify(settings);
      await writeFile(settingsPath, originalJson, 'utf8');
      await assert.rejects(new SettingsStore(dataDirectory).initialize());
      assert.equal(await readFile(settingsPath, 'utf8'), originalJson);
    }
  } finally { await rm(dataDirectory, { recursive: true, force: true }); }
});

test('API 拒絕跨來源設定與上傳，媒體禁止內容嗅探及腳本執行', async (): Promise<void> => {
  const dataDirectory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-security-'));
  const runtime: ApplicationRuntime = await createApplication(createConfiguration(dataDirectory, ''), { secretProtector: new FakeSecretProtector() });
  try {
    const baseUrl: string = await listen(runtime);
    const settingsBefore: AlarmSettings = await runtime.settingsStore.getSettings();
    for (const headers of [
      { Origin: 'http://untrusted.invalid' }, { Origin: 'null' }, { Origin: 'invalid-url' },
      { 'Sec-Fetch-Site': 'cross-site' }, { Origin: baseUrl, 'Sec-Fetch-Site': 'cross-site' },
    ] as Array<Record<string, string>>) {
      for (const route of ['monitoring', 'settings', 'idle-settings', 'uploads', 'media']) {
        const response: Response = await fetch(baseUrl + '/api/' + route, {
          method: ['uploads', 'media'].includes(route) ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json', ...headers }, body: '{"isMonitoring":false}',
        });
        assert.equal(response.status, 403, route);
      }
    }
    assert.equal(runtime.alarmMonitor.isRunning, true);
    assert.deepEqual(await runtime.settingsStore.getSettings(), settingsBefore);
    const sameOriginResponse: Response = await fetch(baseUrl + '/api/monitoring', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'Sec-Fetch-Site': 'same-origin' },
      body: '{"isMonitoring":false}',
    });
    assert.equal(sameOriginResponse.status, 200);
    assert.equal(runtime.alarmMonitor.isRunning, false);
    assert.equal((await fetch(baseUrl + '/api/settings')).status, 200);
    await writeFile(path.join(runtime.settingsStore.getUploadsDirectory(), 'untrusted.png'), '<script>alert(1)</script>');
    const mediaResponse: Response = await fetch(baseUrl + '/uploads/untrusted.png');
    assert.equal(mediaResponse.status, 200);
    assert.match(mediaResponse.headers.get('Content-Type') ?? '', /image\/png/);
    assert.equal(mediaResponse.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(mediaResponse.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'; script-src 'none'");
    assert.equal((await fetch(baseUrl + '/api/display-state')).headers.get('X-Content-Type-Options'), 'nosniff');
  } finally {
    await runtime.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
