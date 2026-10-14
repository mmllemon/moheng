[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiRoot = Join-Path $repoRoot 'apps\api'
$pidFile = Join-Path $apiRoot 'logs\api.pid'
$serverScript = [IO.Path]::GetFullPath((Join-Path $apiRoot 'dist\src\server.js'))

if (-not (Test-Path $pidFile)) {
    Write-Host '未发现 start-windows.ps1 创建的 PID 文件；系统可能未通过该脚本启动。' -ForegroundColor Yellow
    exit 0
}

$pidValue = 0
$pidText = (Get-Content $pidFile -Raw).Trim()
if (-not [int]::TryParse($pidText, [ref]$pidValue) -or $pidValue -le 0) {
    throw "PID 文件内容无效：$pidFile。请检查后手工修复或移除。"
}

$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
if (-not $processInfo) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host '记录的 API 进程已退出，已清理过期 PID 文件。' -ForegroundColor Yellow
    exit 0
}

$commandLine = [string]$processInfo.CommandLine
$isThisApi = $processInfo.Name -ieq 'node.exe' -and
    $commandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
if (-not $isThisApi) {
    throw "PID=$pidValue 当前并非可确认的墨衡 API 进程。为避免误杀其他程序，未停止进程，也未删除 PID 文件。请核对进程命令行后手工处理。"
}

$targetProcess = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if (-not $targetProcess) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host '目标进程已退出，已清理 PID 文件。' -ForegroundColor Yellow
    exit 0
}
try {
    $cimStart = [datetime]$processInfo.CreationDate
    $handleStart = $targetProcess.StartTime
    if ([Math]::Abs(($handleStart - $cimStart).TotalSeconds) -gt 2) {
        throw 'PID 对应进程在身份核验期间发生变化。'
    }
} catch {
    throw "无法确认 PID=$pidValue 的进程身份和启动时间；为避免误杀其他进程，已中止停止操作。"
}

# Kill through the already-open Process handle, not by PID lookup a second time.
# This narrows the PID-reuse race between command-line verification and termination.
try { $targetProcess.Kill() } catch { throw "停止 PID=$pidValue 失败：$($_.Exception.Message)" }
if (-not $targetProcess.WaitForExit(5000)) {
    throw "已发送停止命令，但 PID=$pidValue 仍未退出。请检查进程状态后再清理 PID 文件。"
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "已停止并验证墨衡 API 进程 PID=$pidValue。" -ForegroundColor Green
