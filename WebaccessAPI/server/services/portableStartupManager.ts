import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

export class PortableStartupManager {
  private readonly _packageDirectory: string | undefined = process.env['PORTABLE_PACKAGE_DIRECTORY'];
  private readonly _powerShellPath: string = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

  public get isPortable(): boolean { return this._packageDirectory !== undefined; }

  public async getIsEnabled(): Promise<boolean | null> {
    if (this._packageDirectory === undefined) return null;
    const script: string = `${this.getTaskNameScript()}\r\n$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue\r\n[Console]::Out.Write($(if ($null -ne $task -and $task.State -ne 'Disabled') { 'true' } else { 'false' }))`;
    const output: string = await this.runPowerShell(script);
    if (output.trim() !== 'true' && output.trim() !== 'false') throw new Error('無法讀取開機自啟動狀態。');
    return output.trim() === 'true';
  }

  public async setIsEnabled(isEnabled: boolean): Promise<void> {
    if (this._packageDirectory === undefined) throw new Error('只有免安裝包支援設定開機自啟動。');
    const controlPath: string = this.quotePowerShell(path.join(this._packageDirectory, 'tools/control.ps1'));
    const action: string = isEnabled ? 'EnableStartup' : 'DisableStartup';
    const script: string = [
      "$ErrorActionPreference = 'Stop'",
      '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
      '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
      `if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { & ${controlPath} -Action ${action} }`,
      'else {',
      `  $controlPath = ${controlPath}`,
      `  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $controlPath + '" -Action ${action}'`,
      "  $elevatedProcess = Start-Process -FilePath ($env:SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru",
      "  if ($elevatedProcess.ExitCode -ne 0) { throw '管理員操作失敗，請查看 data\\startup-management-error.log。' }",
      '}',
    ].join('\r\n');
    await this.runPowerShell(script);
  }

  private getTaskNameScript(): string {
    return [
      "$ErrorActionPreference = 'Stop'",
      `$packageDirectory = ${this.quotePowerShell(this._packageDirectory ?? '')}`,
      '$sha = [Security.Cryptography.SHA256]::Create()',
      "try { $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($packageDirectory.ToLowerInvariant())))).Replace('-', '').Substring(0, 12) } finally { $sha.Dispose() }",
      '$taskName = "BrightSignAlarm-$hash"',
    ].join('\r\n');
  }

  private quotePowerShell(value: string): string { return `'${value.replace(/'/g, "''")}'`; }

  private async runPowerShell(script: string): Promise<string> {
    try {
      const result: { stdout: string; stderr: string } = await executeFile(this._powerShellPath, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024, env: { ...process.env, PSModulePath: path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
      return result.stdout;
    } catch {
      throw new Error('Windows 自啟動操作未完成。若已同意管理員授權，請查看 data\\startup-management-error.log；若未產生紀錄，請重新執行並完成授權。');
    }
  }
}
