[CmdletBinding()]
param(
    [switch]$BootstrapDependencies,
    [switch]$ApplyDatabaseMigrations,
    [string]$HealthUrl = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Invoke-RequiredCommand {
    param([Parameter(Mandatory = $true)][string]$Label, [Parameter(Mandatory = $true)][string]$Command, [Parameter(Mandatory = $true)][string[]]$Arguments)
    Write-Host "`n[WP8] $Label" -ForegroundColor Cyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "WP8 门禁失败：$Label（退出码 $LASTEXITCODE）" }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw '未检测到 node.exe。请先安装 Node.js 24 LTS。' }
$nodeVersion = (& $nodeCommand.Source -p 'process.versions.node').Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 24) { throw "当前 Node.js 为 $nodeVersion；项目要求 Node.js 24 或更高版本，WP8 验收已中止。" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '未检测到 npm.cmd，请修复 Node.js/npm 安装。' }
Write-Host "Node.js $nodeVersion" -ForegroundColor Green

$lockFile = Join-Path $repoRoot 'package-lock.json'
if (-not (Test-Path $lockFile)) {
    if (-not $BootstrapDependencies) {
        throw '仓库尚无 package-lock.json。首次准备请执行 .\scripts\windows\verify-release-candidate.ps1 -BootstrapDependencies；生成后请审查并提交锁文件，再进行正式发布。'
    }
    Invoke-RequiredCommand -Label '生成依赖锁文件并安装工作区依赖（首次准备）' -Command 'npm.cmd' -Arguments @('install')
    if (-not (Test-Path $lockFile)) { throw 'npm install 未生成 package-lock.json，不能继续执行可重复构建门禁。' }
    Write-Warning '已生成 package-lock.json。正式发布前请审查并提交此文件。'
} else {
    Invoke-RequiredCommand -Label '使用锁文件安装依赖' -Command 'npm.cmd' -Arguments @('ci')
}

Invoke-RequiredCommand -Label '发布候选静态与源码契约' -Command 'npm.cmd' -Arguments @('run', 'validate:release-candidate')
Invoke-RequiredCommand -Label 'Prisma Schema 校验' -Command 'npm.cmd' -Arguments @('exec', '--workspace=@cms/api', '--', 'prisma', 'validate', '--schema', 'prisma/schema.prisma')
Invoke-RequiredCommand -Label 'Prisma Client 生成' -Command 'npm.cmd' -Arguments @('run', 'db:generate')
Invoke-RequiredCommand -Label '完整 TypeScript 类型检查' -Command 'npm.cmd' -Arguments @('run', 'lint')
Invoke-RequiredCommand -Label 'API 单元测试' -Command 'npm.cmd' -Arguments @('test')
Invoke-RequiredCommand -Label 'API 与 Web 生产构建' -Command 'npm.cmd' -Arguments @('run', 'build')

if ($ApplyDatabaseMigrations) {
    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { throw '请求执行数据库迁移，但当前会话没有设置 DATABASE_URL。请确认目标数据库并通过 .env 提供连接配置。' }
    Write-Warning '即将对 DATABASE_URL 指向的数据库执行迁移。请确认已完成备份且连接的是目标环境。'
    Invoke-RequiredCommand -Label '应用数据库迁移' -Command 'npm.cmd' -Arguments @('run', 'db:deploy')
    Invoke-RequiredCommand -Label '确认迁移状态' -Command 'npm.cmd' -Arguments @('exec', '--workspace=@cms/api', '--', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma')
}

if (-not [string]::IsNullOrWhiteSpace($HealthUrl)) {
    Write-Host "`n[WP8] API/数据库健康检查：$HealthUrl" -ForegroundColor Cyan
    $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 5
    $payload = if ($health.data) { $health.data } else { $health }
    if ($payload.status -ne 'ok' -or $payload.database -ne 'ok') { throw "健康检查未通过：$($health | ConvertTo-Json -Depth 8 -Compress)" }
    Write-Host 'API 与 PostgreSQL 健康检查通过。' -ForegroundColor Green
}

Write-Host "`nWP8 自动构建门禁已通过。仍须按 docs/阶段验收记录-v2.0.0-rc.1.md 完成浏览器 E2E、权限/金额集成测试、Windows 原生部署与备份恢复演练；本脚本不会自动声称这些人工/环境门禁通过。" -ForegroundColor Yellow
