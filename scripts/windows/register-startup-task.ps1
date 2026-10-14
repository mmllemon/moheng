[CmdletBinding()]
param(
    [string]$TaskName = 'ZhuhengCostManagement'
)

$ErrorActionPreference = 'Stop'
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '请使用“以管理员身份运行”的 PowerShell 执行此脚本。'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiRoot = Join-Path $repoRoot 'apps\api'
if (-not (Test-Path (Join-Path $apiRoot '.env'))) { throw '缺少 apps\api\.env，请先完成配置。' }
if (-not (Test-Path (Join-Path $apiRoot 'dist\src\server.js'))) { throw '缺少编译产物，请先运行 prepare-windows.ps1。' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$runner = Join-Path $PSScriptRoot 'run-api.ps1'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -NodeExecutable `"$node`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $apiRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description '墨衡施工单位成本管理系统 API（Windows 原生）' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "开机启动任务已注册并启动：$TaskName" -ForegroundColor Green
Write-Host "日志位置：$apiRoot\logs\api-service.log"
