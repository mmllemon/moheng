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

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已删除开机启动任务：$TaskName" -ForegroundColor Green
} else {
    Write-Host "没有找到任务：$TaskName" -ForegroundColor Yellow
}
