$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$packageDirectory = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $packageDirectory 'portable.config.json') -Raw | ConvertFrom-Json
[int]$port = $config.port
if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid service port.' }
$hash = [Security.Cryptography.SHA256]::Create()
try { $key = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($packageDirectory.ToLowerInvariant())))).Replace('-', '') }
finally { $hash.Dispose() }
$created = $false
$mutex = [Threading.Mutex]::new($true, "Local\BrightSignAlarmTray-$key", [ref]$created)
if (!$created) { $mutex.Dispose(); exit }

$tray = [Windows.Forms.NotifyIcon]::new()
$menu = [Windows.Forms.ContextMenuStrip]::new()
$status = $menu.Items.Add('正在檢查服務狀態…')
$status.Enabled = $false
[void]$menu.Items.Add('-')
$settings = $menu.Items.Add('開啟設定頁')
$start = $menu.Items.Add('啟動服務')
$restart = $menu.Items.Add('重新啟動服務')
$stop = $menu.Items.Add('停止服務')
[void]$menu.Items.Add('-')
$exit = $menu.Items.Add('結束系統匣程式')
$tray.ContextMenuStrip = $menu
$tray.Icon = [Drawing.SystemIcons]::Information
$tray.Text = 'BrightSign 警報系統'
$tray.Visible = $true

function Update-Status {
    try {
        $response = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($response.ok -ne $true) { throw 'Not ready' }
        $status.Text = '服務狀態：運行中'
        $tray.Text = 'BrightSign 警報系統：運行中'
        $tray.Icon = [Drawing.SystemIcons]::Information
    } catch {
        $status.Text = '服務狀態：未回應'
        $tray.Text = 'BrightSign 警報系統：未回應'
        $tray.Icon = [Drawing.SystemIcons]::Warning
    }
}
function Invoke-Control([string]$action) {
    if ($null -ne $script:controlProcess) { return }
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = Join-Path $PSScriptRoot 'control.ps1'
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $exe
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Action {1} -NoTray' -f $script, $action
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $script:controlProcess = [Diagnostics.Process]::Start($info)
    $start.Enabled = $false; $stop.Enabled = $false; $restart.Enabled = $false
    $status.Text = '正在執行服務操作…'
}
function Show-Error($message) {
    [void][Windows.Forms.MessageBox]::Show($message, 'BrightSign 警報系統', 'OK', 'Error')
}
$settings.Add_Click({ Start-Process "http://localhost:$port/settings" })
$tray.Add_DoubleClick({ Start-Process "http://localhost:$port/settings" })
$script:controlProcess = $null
$script:restartPending = $false
$start.Add_Click({ try { Invoke-Control 'Start' } catch { Show-Error $_.Exception.Message } })
$stop.Add_Click({ try { Invoke-Control 'Stop' } catch { Show-Error $_.Exception.Message } })
$restart.Add_Click({ try { $script:restartPending = $true; Invoke-Control 'Stop' } catch { $script:restartPending = $false; Show-Error $_.Exception.Message } })
$exit.Add_Click({ [Windows.Forms.Application]::ExitThread() })
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 10000
$timer.Add_Tick({ if ($null -eq $script:controlProcess) { Update-Status } })
$operationTimer = [Windows.Forms.Timer]::new()
$operationTimer.Interval = 500
$operationTimer.Add_Tick({
    if ($null -eq $script:controlProcess -or !$script:controlProcess.HasExited) { return }
    $exitCode = $script:controlProcess.ExitCode
    $script:controlProcess.Dispose()
    $script:controlProcess = $null
    $start.Enabled = $true; $stop.Enabled = $true; $restart.Enabled = $true
    if ($exitCode -ne 0) {
        $script:restartPending = $false
        Show-Error '服務操作失敗。若服務由系統管理員或 SYSTEM 啟動，請以管理員身分執行系統匣。'
    } elseif ($script:restartPending) {
        $script:restartPending = $false
        try { Invoke-Control 'Start' } catch { Show-Error $_.Exception.Message }
    }
    if ($null -eq $script:controlProcess) { Update-Status }
})
try {
    Update-Status
    $timer.Start()
    $operationTimer.Start()
    [Windows.Forms.Application]::Run()
} finally {
    $timer.Stop(); $timer.Dispose(); $operationTimer.Stop(); $operationTimer.Dispose(); $tray.Visible = $false; $tray.Dispose(); $menu.Dispose()
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
