param([string]$UserSid = '')
$ErrorActionPreference = 'Stop'
$packageDirectory = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $packageDirectory 'data\connection-settings.json'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($UserSid -eq '') { $UserSid = $identity.User.Value }
if ($UserSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { throw '請使用案場 Windows 使用者執行修復。' }
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $scriptPath = $PSCommandPath.Replace("'", "''")
    $command = "& '$scriptPath' -UserSid '$UserSid'; if (-not `$?) { exit 1 }"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encodedCommand) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw '權限修復未完成，請確認管理員授權。' }
    Write-Output '已修復連線設定權限，請重新開啟警報系統。'
    return
}
if (!(Test-Path -LiteralPath $settingsPath)) { throw '找不到此套件的 data\connection-settings.json。' }
# 只恢復原啟動使用者及系統管理者的權限，不讀取或修改加密設定內容。
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
foreach ($sidValue in @($UserSid,'S-1-5-18','S-1-5-32-544')) {
    $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')
    [void]$acl.AddAccessRule($rule)
}
[IO.File]::SetAccessControl($settingsPath,$acl)
Write-Output '連線設定檔權限修復完成。'
