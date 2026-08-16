# ============================================================================
# dsh-win-notify - native Windows toast (WinRT) script
#
# How it works (the same classic approach node-notifier uses):
#   1. Windows only shows toasts for "registered" apps. A classic (non-packaged)
#      app gets its AUMID identity from a Start Menu shortcut named <AppId>.lnk.
#      On first run we create that shortcut (target: powershell.exe, hidden
#      window, icon shell32.dll,137).
#   2. Then Windows.UI.Notifications.ToastNotificationManager shows the toast
#      using the ToastText02 template (one title line + one message line).
#
# IMPORTANT: this must run under Windows PowerShell 5.1 (powershell.exe).
# pwsh / PowerShell 7 cannot load WinRT types (ContentType=WindowsRuntime).
#
# Title/message are passed as Base64 (-Title64 / -Message64) to avoid command
# line quoting and encoding issues entirely. The script prints nothing on
# success and throws on failure (the caller catches it).
# ============================================================================
param(
    [string]$Title64 = '',
    [string]$Message64 = '',
    [string]$AppId = 'DSH.Notify'
)

$ErrorActionPreference = 'Stop'

function Decode-B64([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '' }
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s))
}

$title = Decode-B64 $Title64
$message = Decode-B64 $Message64

# --- 1. make sure the AUMID shortcut exists (otherwise toasts are dropped) ---
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnk = Join-Path $startMenu ($AppId + '.lnk')
if (-not (Test-Path $lnk)) {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = (Get-Command powershell.exe).Source
    $sc.Arguments = '-NoProfile -WindowStyle Hidden -Command "exit"'
    $sc.IconLocation = 'shell32.dll,137'
    $sc.Description = 'DSH notification toast host'
    $sc.Save()
}

# --- 2. load WinRT types ---
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

# --- 3. ToastText02: one title line + one message line ---
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName('text')
$null = $textNodes.Item(0).AppendChild($template.CreateTextNode($title))
$null = $textNodes.Item(1).AppendChild($template.CreateTextNode($message))

$toast = New-Object Windows.UI.Notifications.ToastNotification $template
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId)
$notifier.Show($toast)
