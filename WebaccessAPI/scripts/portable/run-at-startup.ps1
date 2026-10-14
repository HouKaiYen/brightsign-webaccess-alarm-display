$ErrorActionPreference = 'Stop'
$packageDirectory = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'control.ps1') -Action Start
$record = Get-Content -LiteralPath (Join-Path $packageDirectory 'data\portable-process.json') -Raw | ConvertFrom-Json
$runningProcess = Get-Process -Id $record.processId -ErrorAction Stop
$runningProcess.WaitForExit()
exit $runningProcess.ExitCode
