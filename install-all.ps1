# ═══════════════════════════════════════════════════════════════════
# install-all.ps1 — 一键把本仓库全部 dsh-* 插件装进 DSH profile
# 用法：在仓库根目录打开 PowerShell，运行  ./install-all.ps1
# 安装完成后重启 DSH Web 即生效（详见 Install.md）
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
  Write-Host "==> dsh plugin --profile $profile add $($b.Name)" -ForegroundColor Yellow
  dsh plugin --profile $profile add $b.FullName
  if ($LASTEXITCODE -ne 0) {
    Write-Host "安装 $($b.Name) 失败，已中止。" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

Write-Host '全部安装完成。请重启 DSH Web 使插件生效。' -ForegroundColor Green
