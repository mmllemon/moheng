[CmdletBinding()]
param(
    [switch]$SkipDatabaseMigration,
    [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$apiRoot = Join-Path $repoRoot 'apps\api'
$apiEnv = Join-Path $apiRoot '.env'

Write-Host '筑衡 Windows 原生部署准备' -ForegroundColor Cyan

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw '未检测到 Node.js。请先安装 Node.js 24 LTS，并重新打开 PowerShell。'
}
$nodeVersion = (& $nodeCommand.Source -p 'process.versions.node').Trim()
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 24) {
    throw "当前 Node.js 版本为 $nodeVersion；本项目部署基线要求 Node.js 24 或更高的 LTS 版本。"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw '未检测到 npm.cmd。请修复 Node.js 安装后重试。'
}

if (-not (Test-Path $apiEnv)) {
    Copy-Item (Join-Path $apiRoot '.env.example') $apiEnv
    Write-Host "已创建配置文件：$apiEnv" -ForegroundColor Yellow
    Write-Host '请先编辑该文件，配置 PostgreSQL 连接串、JWT_SECRET 和管理员初始密码，然后重新运行本脚本。' -ForegroundColor Yellow
    return
}

$envText = Get-Content -Raw -Path $apiEnv
if ($envText -match 'change-this-database-password|replace-with-at-least-32-random-bytes|SEED_ADMIN_PASSWORD=ChangeMe123!') {
    throw "检测到示例密钥或密码仍未修改，请先编辑 $apiEnv。"
}

Write-Host "Node.js: $nodeVersion"
Write-Host '安装工作区依赖……'
Push-Location $repoRoot
try {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败。请检查网络、代理和 npm registry 配置。' }

    Write-Host '生成 Prisma Client……'
    & npm.cmd run db:generate
    if ($LASTEXITCODE -ne 0) { throw 'Prisma Client 生成失败。' }

    Write-Host '构建 API 和前端……'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw '项目构建失败，请检查上方错误输出。' }

    if (-not $SkipDatabaseMigration) {
        Write-Host '应用数据库迁移……'
        & npm.cmd run db:deploy
        if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败。请检查 PostgreSQL 服务和 DATABASE_URL。' }
    }

    if (-not $SkipSeed) {
        Write-Host '初始化管理员账号和可选演示数据……'
        & npm.cmd run db:seed
        if ($LASTEXITCODE -ne 0) { throw '数据库种子初始化失败。' }
    }
}
finally {
    Pop-Location
}

Write-Host '准备完成。可运行 scripts\windows\start-windows.ps1 启动系统。' -ForegroundColor Green
