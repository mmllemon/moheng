[CmdletBinding()]
param(
    [string]$NodeExecutable = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiRoot = Join-Path $repoRoot 'apps\api'
$logDir = Join-Path $apiRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $apiRoot

if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
    $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
}
$NodeExecutable = (Resolve-Path $NodeExecutable).Path

# The scheduled task keeps this PowerShell host alive with the API and appends output to one log.
& $NodeExecutable 'dist/src/server.js' *>> (Join-Path $logDir 'api-service.log')
exit $LASTEXITCODE
