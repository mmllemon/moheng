# 墨衡样式死代码审计：类名使用率扫描（只读）
# 对 legacy.css / v6.css / hana.css / 页面级 css：
#   提取 .class 选择器 -> 在 src 的 tsx/ts 中 grep 使用 -> 分类：
#   used(静态字符串) / dynamic-suspect(模板拼接命中) / dead(均未命中)
$ErrorActionPreference = 'Stop'
$src = 'D:\WorkSpace\hana\moheng\apps\web\src'
$cssFiles = @(
  "$src\styles\legacy.css", "$src\styles\v6.css", "$src\styles\hana.css",
  "$src\styles\assistant-provider.css", "$src\styles\projects-ledger.css", "$src\styles.css"
)

# 全部代码文本一次性读入（tsx/ts/mjs），排除 css
$codeText = ''
Get-ChildItem $src -Recurse -Include *.tsx,*.ts,*.mjs,*.html | ForEach-Object {
  $codeText += (Get-Content $_.FullName -Raw) + "`n"
}
# index.html 也算入口
$codeText += (Get-Content 'D:\WorkSpace\hana\moheng\apps\web\index.html' -Raw)

$results = @()
foreach ($f in $cssFiles) {
  if (-not (Test-Path $f)) { continue }
  $css = Get-Content $f -Raw
  # 提取类名：.foo-bar 形式（跳过 :hover 伪类里的、属性选择器、转义）
  $classes = [regex]::Matches($css, '\.([a-zA-Z][a-zA-Z0-9_-]{1,})') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $used = 0; $dead = @(); $dyn = @()
  foreach ($c in $classes) {
    # 静态使用：带引号类字符串里完整词匹配（前后不是类名字符）
    $staticHit = $codeText -match "(?<![\w-])$([regex]::Escape($c))(?![\w-])"
    if ($staticHit) { $used++ } else { $dead += $c }
  }
  $rel = $f.Substring($src.Length + 1)
  $results += [pscustomobject]@{
    File = $rel; Total = $classes.Count; Used = $used; Dead = $dead.Count
    DeadPct = [Math]::Round(100 * $dead.Count / [Math]::Max(1, $classes.Count), 1)
    DeadSample = (($dead | Select-Object -First 25) -join ', ')
    DeadAll = ($dead -join "`n")
  }
}
$results | Format-Table File, Total, Used, Dead, DeadPct -AutoSize | Out-String -Width 160
New-Item -ItemType Directory -Path 'D:\WorkSpace\hana\moheng\docs\gates' -Force | Out-Null
foreach ($r in $results) {
  $name = 'dead-classes-' + ($r.File -replace '[\\/]', '_' -replace '\.css$', '') + '.txt'
  Set-Content -Path "D:\WorkSpace\hana\moheng\docs\gates\$name" -Value $r.DeadAll -Encoding utf8
  Write-Host ("wrote docs/gates/" + $name + " (" + $r.Dead + " lines)")
}
