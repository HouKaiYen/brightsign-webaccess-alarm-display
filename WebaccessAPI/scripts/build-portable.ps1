param([string]$RuntimePath = (Get-Command node).Source)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectDirectory 'artifacts'
$version = (& $RuntimePath --version).Trim()
if ($version -notmatch '^v24\.[0-9]+\.[0-9]+$') { throw '請使用 Node.js 24 x64 官方執行檔打包。' }
if ((& $RuntimePath -p 'process.arch').Trim() -ne 'x64') { throw '只支援 Windows x64 執行環境。' }
$manifest = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
$manifestMatch = [regex]::Match($manifest, '(?m)^([0-9a-f]{64})\s+win-x64/node\.exe\s*$')
$runtimeHashAlgorithm = [Security.Cryptography.SHA256]::Create()
$runtimeStream = [IO.File]::OpenRead($RuntimePath)
try { $runtimeHash = ([BitConverter]::ToString($runtimeHashAlgorithm.ComputeHash($runtimeStream))).Replace('-', '').ToLowerInvariant() } finally { $runtimeStream.Dispose(); $runtimeHashAlgorithm.Dispose() }
if (!$manifestMatch.Success -or $runtimeHash -ne $manifestMatch.Groups[1].Value) { throw 'Node.js 執行檔與官方 SHA256 不符，停止打包。' }
$buildName = 'BrightSignAlarm-win-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$stagingDirectory = Join-Path $outputDirectory $buildName
$applicationDirectory = Join-Path $stagingDirectory 'app'
New-Item -ItemType Directory -Path $applicationDirectory,(Join-Path $stagingDirectory 'runtime'),(Join-Path $stagingDirectory 'data') -Force | Out-Null
Push-Location -LiteralPath $projectDirectory
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw '網頁建置失敗。' }
    foreach ($directory in @('server', 'shared', 'dist')) { Copy-Item -LiteralPath (Join-Path $projectDirectory $directory) -Destination $applicationDirectory -Recurse }
    foreach ($file in @('package.json', 'package-lock.json')) { Copy-Item -LiteralPath (Join-Path $projectDirectory $file) -Destination $applicationDirectory }
    Copy-Item -LiteralPath $RuntimePath -Destination (Join-Path $stagingDirectory 'runtime\node.exe')
    $license = (Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$version/LICENSE" -UseBasicParsing).Content
    [IO.File]::WriteAllText((Join-Path $stagingDirectory 'runtime\LICENSE.txt'), $license, [Text.UTF8Encoding]::new($false))
    Push-Location -LiteralPath $applicationDirectory
    try { & npm.cmd ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw '正式環境套件準備失敗。' } }
    finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable') -Destination (Join-Path $stagingDirectory 'tools') -Recurse
    [IO.File]::WriteAllText((Join-Path $stagingDirectory 'portable.config.json'), "{`r`n  `"port`": 3006`r`n}`r`n", [Text.UTF8Encoding]::new($false))
    $launchers = [ordered]@{ '啟動警報系統.cmd'='Start'; '停止警報系統.cmd'='Stop'; '開啟設定頁.cmd'='Settings'; '啟用開機自啟動.cmd'='EnableStartup'; '取消開機自啟動.cmd'='DisableStartup'; '修復連線設定權限.cmd'='RepairPermissions' }
    foreach ($launcher in $launchers.GetEnumerator()) {
        $text = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0tools\control.ps1`" -Action $($launcher.Value)`r`nif errorlevel 1 pause`r`n"
        [IO.File]::WriteAllText((Join-Path $stagingDirectory $launcher.Key), $text, [Text.Encoding]::ASCII)
    }
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'README.md') -Destination (Join-Path $stagingDirectory '使用說明.md')
    $zipPath = "$stagingDirectory.zip"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagingDirectory, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)
    Write-Output "可攜式套件：$zipPath"
} finally { Pop-Location }
