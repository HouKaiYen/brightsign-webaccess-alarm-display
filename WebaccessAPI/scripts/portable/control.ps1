param(
    [ValidateSet('Start', 'Stop', 'Settings', 'EnableStartup', 'DisableStartup', 'RepairPermissions', 'Tray')]
    [string]$Action = 'Start',
    [switch]$NoTray
)

$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
$packageDirectory = Split-Path -Parent $PSScriptRoot
$applicationDirectory = Join-Path $packageDirectory 'app'
$nodePath = Join-Path $packageDirectory 'runtime\node.exe'
$configurationPath = Join-Path $packageDirectory 'portable.config.json'
$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
[int]$port = $configuration.port
if ($port -lt 1 -or $port -gt 65535) { throw 'portable.config.json 的 port 必須介於 1 至 65535。' }
$dataDirectory = Join-Path $packageDirectory 'data'
$processRecordPath = Join-Path $dataDirectory 'portable-process.json'
$pathBytes = [Text.Encoding]::UTF8.GetBytes($packageDirectory.ToLowerInvariant())
$shaAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $pathHash = ([BitConverter]::ToString($shaAlgorithm.ComputeHash($pathBytes))).Replace('-', '').Substring(0, 12) }
finally { $shaAlgorithm.Dispose() }
$taskName = "BrightSignAlarm-$pathHash"
$trayTaskName = "BrightSignAlarmTray-$pathHash"

function Get-PortableProcess {
    if (!(Test-Path -LiteralPath $processRecordPath)) { return $null }
    $record = Get-Content -LiteralPath $processRecordPath -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.processId)" -ErrorAction SilentlyContinue
    if ($null -eq $candidate -or $candidate.ExecutablePath -ne $nodePath -or
        $candidate.CommandLine -notlike '*server/index.ts*' -or
        $candidate.CreationDate.ToUniversalTime().ToString('o') -ne $record.createdAt) { return $null }
    return $candidate
}

function Start-PortableApplication {
    if ($null -ne (Get-PortableProcess)) { Write-Output '警報系統已啟動。'; return }
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $env:HOST = '0.0.0.0'
    $env:PORTABLE_PACKAGE_DIRECTORY = $packageDirectory
    $env:PORT = [string]$port
    $env:DATA_DIRECTORY = $dataDirectory
    $env:DIST_DIRECTORY = Join-Path $applicationDirectory 'dist'
    $process = Start-Process -FilePath $nodePath -ArgumentList @('--import', 'tsx', 'server/index.ts') -WorkingDirectory $applicationDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataDirectory 'startup.log') -RedirectStandardError (Join-Path $dataDirectory 'startup-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) { throw '啟動失敗，請查看 data\startup-error.log，確認連接埠未被其他程式占用。' }
        if (!$ready) {
            try { $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 1; $ready = $health.ok -eq $true } catch { }
        }
        if ($ready) { break }
    }
    if (!$ready) { Stop-Process -Id $process.Id; throw '服務啟動逾時，請查看 data 內的啟動紀錄。' }
    $ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    @{ processId = $process.Id; createdAt = $ownedProcess.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $processRecordPath -Encoding UTF8
    Write-Output "警報系統已啟動。設定：http://localhost:$port/settings；播放器：http://主機IP:$port/display"
}

function Start-TrayIfInteractive {
    if ($NoTray -or !(Get-Process -Id $PID).SessionId -or ![Environment]::UserInteractive) { return }
    $trayScript = Join-Path $PSScriptRoot 'tray.ps1'
    if (Test-Path -LiteralPath $trayScript) {
        Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$trayScript`"") -WindowStyle Hidden
    }
}

try {
switch ($Action) {
    'Tray' { Start-TrayIfInteractive }
    'RepairPermissions' { & (Join-Path $PSScriptRoot 'repair-connection-permissions.ps1') }
    'Start' { Start-PortableApplication; Start-TrayIfInteractive }
    'Settings' { Start-PortableApplication; Start-TrayIfInteractive; Start-Process "http://localhost:$port/settings" }
    'Stop' {
        $startupTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $startupTask -and $startupTask.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
        $ownedProcess = Get-PortableProcess
        if ($null -ne $ownedProcess) { Stop-Process -Id $ownedProcess.ProcessId; Write-Output '警報系統已停止。' }
        else { Write-Output '警報系統尚未啟動。' }
    }
    'EnableStartup' {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '請以系統管理員身分執行「啟用開機自啟動」。' }
        # 工作排程直接監督後端行程，當它意外終止時才能自動重啟。
        $startupScript = Join-Path $PSScriptRoot 'run-at-startup.ps1'
        $taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startupScript`"" -WorkingDirectory $packageDirectory
        $taskTrigger = New-ScheduledTaskTrigger -AtStartup
        $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -User 'SYSTEM' -RunLevel Highest -Description 'BrightSign WebAccess 可攜式警報系統' -Force | Out-Null
        # The service runs as SYSTEM at boot; the tray must run in each user's interactive session.
        $trayScript = Join-Path $PSScriptRoot 'tray.ps1'
        $trayAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$trayScript`"" -WorkingDirectory $packageDirectory
        $trayTrigger = New-ScheduledTaskTrigger -AtLogOn
        $trayPrincipal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
        $traySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $trayTaskName -Action $trayAction -Trigger $trayTrigger -Principal $trayPrincipal -Settings $traySettings -Description 'BrightSign WebAccess 登入後顯示系統匣' -Force | Out-Null
        Write-Output '已啟用 Windows 開機自啟動，登入後會顯示系統匣。'
    }
    'DisableStartup' {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $task) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
        $trayTask = Get-ScheduledTask -TaskName $trayTaskName -ErrorAction SilentlyContinue
        if ($null -ne $trayTask) {
            Unregister-ScheduledTask -TaskName $trayTaskName -Confirm:$false
        }
        Write-Output '已取消此資料夾的開機自啟動。'
    }
}
} catch {
    if ($Action -in @('EnableStartup', 'DisableStartup', 'RepairPermissions')) {
        New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
        ($_ | Out-String) | Set-Content -LiteralPath (Join-Path $dataDirectory 'startup-management-error.log') -Encoding UTF8
    }
    throw
}
