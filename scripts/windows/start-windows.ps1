[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiRoot = Join-Path $repoRoot 'apps\api'
$apiEnv = Join-Path $apiRoot '.env'
$pidFile = Join-Path $apiRoot 'logs\api.pid'
$logDir = Join-Path $apiRoot 'logs'
$serverScriptPath = Join-Path $apiRoot 'dist\src\server.js'

if (-not (Test-Path $apiEnv)) {
    throw '未找到 apps/api/.env。请先运行 scripts/windows/prepare-windows.ps1 完成环境配置。'
}
if (-not (Test-Path $serverScriptPath)) {
    throw '未找到编译产物。请先运行 scripts/windows/prepare-windows.ps1。'
}
$serverScript = (Resolve-Path $serverScriptPath).Path

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$node = (Resolve-Path $nodeCommand.Source).Path

if (Test-Path $pidFile) {
    $oldPid = 0
    $pidText = (Get-Content $pidFile -Raw).Trim()
    if ([int]::TryParse($pidText, [ref]$oldPid) -and $oldPid -gt 0) {
        $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
        if ($oldProcess) {
            $commandLine = [string]$oldProcess.CommandLine
            $sameEntryPoint = $oldProcess.Name -ieq 'node.exe' -and
                $commandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
            if ($sameEntryPoint) {
                throw "系统似乎已在运行，PID=$oldPid。请先运行 stop-windows.ps1。"
            }
            throw "PID 文件中的 PID=$oldPid 当前属于其他或无法验证的进程。为避免误杀其他程序，启动已中止；请核对进程后再处理 $pidFile。"
        }
    }
    # The PID no longer exists or the file is malformed. Never kill a process
    # merely because a stale PID file happens to contain its PID.
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$outLog = Join-Path $logDir 'api.out.log'
$errLog = Join-Path $logDir 'api.err.log'

$port = 3001
$portMatch = [regex]::Match((Get-Content $apiEnv -Raw), '(?m)^PORT=(\d+)\s*$')
if ($portMatch.Success) { $port = [int]$portMatch.Groups[1].Value }

# Refuse to launch if another process already owns the port. A healthy HTTP response
# alone is not proof that this invocation's process started successfully.
$existingListeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if ($existingListeners.Count -gt 0) {
    $ownerDetails = foreach ($listener in $existingListeners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        [pscustomobject]@{
            LocalAddress = $listener.LocalAddress
            Port = $listener.LocalPort
            PID = $listener.OwningProcess
            Process = if ($owner) { $owner.Name } else { 'unknown' }
            CommandLine = if ($owner) { [string]$owner.CommandLine } else { '' }
        }
    }
    $detailText = ($ownerDetails | Format-Table -AutoSize | Out-String).Trim()
    throw ("端口 $port 已被其他进程监听。为防止把旧实例的健康状态误认为本次启动成功，已拒绝启动。监听信息：" + [Environment]::NewLine + $detailText)
}

$healthUrl = "http://127.0.0.1:$port/health"
$healthy = $false

# Use an absolute entry point so later stop/start scripts can verify process identity.
$process = Start-Process -FilePath $node -ArgumentList @("`"$serverScript`"") -WorkingDirectory $apiRoot -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Set-Content -Path $pidFile -Value $process.Id -Encoding ascii

# A live process is not sufficient: the app must bind its port and reach PostgreSQL.
for ($attempt = 1; $attempt -le 20; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { break }
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
        $process.Refresh()
        $ownedListener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Where-Object { [int]$_.OwningProcess -eq $process.Id } |
            Select-Object -First 1)
        if (-not $process.HasExited -and $ownedListener.Count -gt 0 -and
            $health.success -eq $true -and $health.data.status -eq 'ok' -and $health.data.database -eq 'ok') {
            $healthy = $true
            break
        }
    } catch {
        # The API may still be starting; retry until the bounded health deadline.
    }
    Start-Sleep -Seconds 1
}

if (-not $healthy) {
    $process.Refresh()
    if (-not $process.HasExited) {
        # Safe: this is the exact process object returned by this Start-Process call.
        try { $process.Kill() } catch { }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    throw "API 未能在 20 秒内通过数据库健康检查：$healthUrl。请检查日志：$outLog 和 $errLog"
}

Write-Host "墨衡 API 已启动且健康检查通过，PID=$($process.Id)" -ForegroundColor Green
Write-Host "系统地址：http://localhost:$port"
Write-Host "健康检查：$healthUrl"
Write-Host "API 文档：http://localhost:$port/docs/"
Write-Host "日志目录：$logDir"
