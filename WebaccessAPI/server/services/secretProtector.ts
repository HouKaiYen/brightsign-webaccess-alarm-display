import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

export interface SecretProtector {
  protect(plaintext: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
  secureFile(filePath: string): Promise<void>;
}

export class DpapiSecretProtector implements SecretProtector {
  public async protect(plaintext: string): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error('Windows DPAPI 僅能在 Windows 主機使用。');
    }
    return this.runPowerShell(this._protectScript, plaintext);
  }

  public async unprotect(ciphertext: string): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error('Windows DPAPI 僅能在 Windows 主機使用。');
    }
    return this.runPowerShell(this._unprotectScript, ciphertext);
  }

  public async secureFile(filePath: string): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('Windows ACL 僅能在 Windows 主機設定。');
    }
    await this.runPowerShell(this._secureFileScript, filePath);
  }

  private readonly _protectScript: string = [
    "$ErrorActionPreference = 'Stop'",
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    'Add-Type -AssemblyName System.Security',
    'try {',
    '  $plainText = [Console]::In.ReadToEnd()',
    '  $plainBytes = $utf8.GetBytes($plainText)',
    '  $cipherBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '  [Console]::Out.Write([Convert]::ToBase64String($cipherBytes))',
    '  [Array]::Clear($plainBytes, 0, $plainBytes.Length)',
    '} catch {',
    "  [Console]::Error.WriteLine('DPAPI encryption failed')",
    '  exit 1',
    '}',
  ].join('\r\n');

  private readonly _unprotectScript: string = [
    "$ErrorActionPreference = 'Stop'",
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    'Add-Type -AssemblyName System.Security',
    'try {',
    '  $cipherText = [Console]::In.ReadToEnd()',
    '  $cipherBytes = [Convert]::FromBase64String($cipherText)',
    '  $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($cipherBytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '  [Console]::Out.Write($utf8.GetString($plainBytes))',
    '  [Array]::Clear($plainBytes, 0, $plainBytes.Length)',
    '} catch {',
    "  [Console]::Error.WriteLine('DPAPI decryption failed')",
    '  exit 1',
    '}',
  ].join('\r\n');

  private readonly _secureFileScript: string = [
    "$ErrorActionPreference = 'Stop'",
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    'try {',
    '  $settingsPath = [Console]::In.ReadToEnd()',
    '  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '  $existingAcl = Get-Acl -LiteralPath $settingsPath',
    '  $directoryAcl = Get-Acl -LiteralPath ([IO.Path]::GetDirectoryName($settingsPath))',
    "  $allowedSids = @($currentUser.Value, 'S-1-5-18', 'S-1-5-32-544', $existingAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value, $directoryAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value)",
    '  foreach ($existingRule in $existingAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {',
    "    if ($existingRule.AccessControlType -eq 'Allow' -and $existingRule.IdentityReference.Value -like 'S-1-5-21-*') { $allowedSids += $existingRule.IdentityReference.Value }",
    '  }',
    // 只寫入 DACL，避免 Set-Acl 更新既有檔案時要求不必要的稽核權限。
    '  $fileAcl = [Security.AccessControl.FileSecurity]::new()',
    '  $fileAcl.SetAccessRuleProtection($true, $false)',
    '  foreach ($sidValue in ($allowedSids | Select-Object -Unique)) {',
    '    $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)',
    "    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')",
    '    [void]$fileAcl.AddAccessRule($rule)',
    '  }',
    '  [IO.File]::SetAccessControl($settingsPath, $fileAcl)',
    '} catch {',
    "  [Console]::Error.WriteLine('Connection settings ACL update failed')",
    '  exit 1',
    '}',
  ].join('\r\n');

  private runPowerShell(script: string, input: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const childProcess: ChildProcessByStdio<Writable, Readable, null> = spawn('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ], {
        windowsHide: true,
        env: { ...process.env, PSModulePath: path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const outputChunks: Buffer[] = [];
      childProcess.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk));
      childProcess.once('error', () => reject(new Error('無法啟動 Windows DPAPI 加密程序。')));
      childProcess.once('close', (exitCode: number | null) => {
        if (exitCode !== 0) {
          reject(new Error('Windows DPAPI 加解密失敗。'));
          return;
        }
        resolve(Buffer.concat(outputChunks).toString('utf8'));
      });
      childProcess.stdin.on('error', () => undefined);
      childProcess.stdin.end(input, 'utf8');
    });
  }
}
