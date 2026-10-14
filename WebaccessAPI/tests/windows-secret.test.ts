import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import type { ServerConfiguration } from '../server/config/environment.js';
import { ConnectionSettingsStore } from '../server/services/connectionSettingsStore.js';
import { DpapiSecretProtector } from '../server/services/secretProtector.js';

test('Windows 實際 DPAPI 中文密碼及受限檔案可在重新啟動後讀回與更新', { skip: process.platform !== 'win32' }, async () => {
  const directory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-加密 重啟-'));
  const configuration: ServerConfiguration = { host: '127.0.0.1', port: 0, dataDirectory: directory, distDirectory: directory, webAccessApiBase: '', webAccessProject: '', webAccessUsername: '', webAccessPassword: '', pollIntervalMs: 1000, requestTimeoutMs: 1000 };
  try {
    const store: ConnectionSettingsStore = new ConnectionSettingsStore(directory, configuration, new DpapiSecretProtector());
    await store.initialize();
    await store.saveSettings({ version: 1, apiBase: 'http://127.0.0.1/WaWebService/Json', project: '測試', username: 'qa', password: 'QA-中文暫存密碼' });
    assert.equal((await readFile(path.join(directory, 'connection-settings.json'), 'utf8')).includes('QA-中文暫存密碼'), false);
    const restartedConfiguration: ServerConfiguration = { ...configuration, webAccessPassword: '' };
    const restartedStore: ConnectionSettingsStore = new ConnectionSettingsStore(directory, restartedConfiguration, new DpapiSecretProtector());
    await restartedStore.initialize();
    assert.equal(restartedStore.getPublicSettings().hasPassword, true);
    assert.equal(restartedConfiguration.webAccessPassword, 'QA-中文暫存密碼');
    await restartedStore.saveSettings({ version: 2, apiBase: 'http://127.0.0.1/WaWebService/Json', project: '測試二', username: 'qa' });
    assert.equal(restartedConfiguration.webAccessPassword, 'QA-中文暫存密碼');
    assert.equal(restartedStore.getPublicSettings().version, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Windows 重新限制設定檔權限仍保留既有使用者，且不授權 Everyone', { skip: process.platform !== 'win32' }, async () => {
  const directory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-acl-'));
  const settingsPath: string = path.join(directory, 'connection-settings.json');
  const executeFile = promisify(execFile);
  const previousUserSid: string = 'S-1-5-21-111111111-222222222-333333333-1001';
  try {
    await writeFile(settingsPath, '{}');
    const escapedPath: string = settingsPath.replace(/'/g, "''");
    const addRuleScript: string = `$acl = Get-Acl -LiteralPath '${escapedPath}'; $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('${previousUserSid}'), 'FullControl', 'Allow'); [void]$acl.AddAccessRule($rule); [IO.File]::SetAccessControl('${escapedPath}', $acl)`;
    await executeFile('powershell.exe', ['-NoProfile', '-Command', addRuleScript], { windowsHide: true, env: { ...process.env, PSModulePath: path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
    await new DpapiSecretProtector().secureFile(settingsPath);
    const inspectScript: string = `$acl = Get-Acl -LiteralPath '${escapedPath}'; [Console]::Out.Write(($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }) -join ',')`;
    const result: { stdout: string; stderr: string } = await executeFile('powershell.exe', ['-NoProfile', '-Command', inspectScript], { windowsHide: true, env: { ...process.env, PSModulePath: path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
    assert.ok(result.stdout.includes(previousUserSid));
    assert.equal(result.stdout.split(',').includes('S-1-1-0'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
