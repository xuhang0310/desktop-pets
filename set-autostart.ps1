# 悬浮便签 · 开机自启开关（Unicode 安全，无代码页问题）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File set-autostart.ps1 -On
#       powershell -NoProfile -ExecutionPolicy Bypass -File set-autostart.ps1 -Off
param([switch]$On)

$appDir  = $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'TodoWidget.lnk'

# 清理历史遗留（早期版本留下的启动项）
foreach ($legacy in @('TodoWidget.cmd', '悬浮便签.cmd', '悬浮便签.lnk')) {
  $p = Join-Path $startup $legacy
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
}

if (-not $On) {
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue }
  Write-Output '开机自启已关闭'
  exit 0
}

$vbs = Join-Path $appDir 'run-supervised.vbs'
if (-not (Test-Path -LiteralPath $vbs)) {
  Write-Output "缺少守护脚本: $vbs"
  exit 1
}

try {
  $sh = New-Object -ComObject WScript.Shell
  $s  = $sh.CreateShortcut($lnk)
  $s.TargetPath       = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $s.Arguments        = '"' + $vbs + '"'
  $s.WorkingDirectory = $appDir
  $s.IconLocation     = (Join-Path $appDir 'tray.ico') + ',0'
  $s.Description      = '悬浮便签 · 桌面待办'
  $s.WindowStyle      = 1
  $s.Save()
} catch {
  Write-Output ("创建快捷方式失败: " + $_.Exception.Message)
  exit 1
}

if (Test-Path -LiteralPath $lnk) {
  Write-Output "开机自启已开启: $lnk"
  exit 0
} else {
  Write-Output '创建失败：快捷方式未生成'
  exit 1
}
