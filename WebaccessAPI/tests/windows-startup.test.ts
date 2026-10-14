import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

test('Windows 自啟動操作失敗時保留錯誤紀錄，不建立排程', { skip: process.platform !== 'win32' }, async (context) => {
  const powerShellPath: string = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const identityScript: string = '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
  const identityResult: { stdout: string; stderr: string } = await executeFile(powerShellPath, ['-NoProfile', '-Command', identityScript], { windowsHide: true });
  if (identityResult.stdout.trim() === 'True') { context.skip('此測試只驗證一般使用者的授權失敗，不在管理員環境建立排程。'); return; }
  const directory: string = await mkdtemp(path.join(os.tmpdir(), 'brightsign-startup-'));
  try {
    await mkdir(path.join(directory, 'tools'));
    await copyFile(path.resolve('scripts/portable/control.ps1'), path.join(directory, 'tools/control.ps1'));
    await writeFile(path.join(directory, 'portable.config.json'), '{"port":3317}');
    await assert.rejects(executeFile(powerShellPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'tools/control.ps1'), '-Action', 'EnableStartup'], { windowsHide: true }));
    const errorLog: string = await readFile(path.join(directory, 'data/startup-management-error.log'), 'utf8');
    assert.match(errorLog, /請以系統管理員身分/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
