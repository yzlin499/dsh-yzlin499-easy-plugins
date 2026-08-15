# ═══════════════════════════════════════════════════════════════════
# uninstall-all.ps1 — 一键卸载本仓库全部 dsh-* 插件
# 用法：在仓库根目录打开 PowerShell，运行  ./uninstall-all.ps1
# ═══════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'

$profile = 'web'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundles = Get-ChildItem -Path $root -Directory -Filter 'dsh-*' | Sort-Object Name

if (-not $bundles) {
  Write-Host '未找到任何 dsh-* 插件包，请确认在仓库根目录运行。' -ForegroundColor Red
  exit 1
}

Write-Host "目标 profile: $profile" -ForegroundColor Cyan
foreach ($b in $bundles) {
  Write-Host "==> dsh plugin --profile $profile remove $($b.Name)" -ForegroundColor Yellow
  dsh plugin --profile $profile remove $b.Name
  if ($LASTEXITCODE -ne 0) {
    Write-Host "卸载 $($b.Name) 失败，已中止。" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

Write-Host '全部卸载完成。请重启 DSH Web 使变更生效。' -ForegroundColor Green
