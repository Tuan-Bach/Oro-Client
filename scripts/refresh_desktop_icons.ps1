Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class ShellNotifier {
    [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

    public const int SHCNE_ASSOCCHANGED = 0x08000000;
    public const int SHCNE_UPDATEITEM = 0x00002000;
    public const int SHCNF_FLUSH = 0x1000;
    public const int SHCNF_IDLIST = 0x0000;

    public static void Flush() {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

function Replace-FileAtomic($src, $dest) {
    if (Test-Path $dest) {
        $tempOld = "$dest.old"
        if (Test-Path $tempOld) { Remove-Item $tempOld -Force -ErrorAction SilentlyContinue }
        Move-Item $dest $tempOld -Force -ErrorAction SilentlyContinue
    }
    Copy-Item $src $dest -Force
    if (Test-Path "$dest.old") { Remove-Item "$dest.old" -Force -ErrorAction SilentlyContinue }
}

$appDir = "C:\Users\BACH\.gemini\antigravity\scratch\oro"
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$icoPath = Join-Path $appDir "resources\icon.ico"
$srcExe = Join-Path $appDir "Oro.exe"
$launcherCs = Join-Path $appDir "src\launcher\OroLauncher.cs"
$desktopExe = "C:\Users\BACH\Desktop\Oro.exe"
$desktopLnk = "C:\Users\BACH\Desktop\Oro.lnk"
$desktopIco = "C:\Users\BACH\Desktop\Oro.ico"

# 1. Recompile Oro.exe with embedded win32icon
Write-Host "Compiling Oro.exe with win32icon..."
& $csc /target:winexe /optimize+ /win32icon:$icoPath /out:$srcExe $launcherCs

# 2. Copy Oro.exe to Desktop atomically
Write-Host "Copying Oro.exe to Desktop..."
Replace-FileAtomic $srcExe $desktopExe

# 3. Copy icon.ico to Desktop atomically
Replace-FileAtomic $icoPath $desktopIco
Replace-FileAtomic $icoPath "C:\Users\BACH\Desktop\Oro_Round.ico"
Replace-FileAtomic $icoPath "C:\Users\BACH\Desktop\Oro_App.ico"

# 4. Update Oro.lnk shortcut
$wsh = New-Object -ComObject WScript.Shell
if (Test-Path $desktopLnk) {
    Remove-Item -Path $desktopLnk -Force
}
$shortcut = $wsh.CreateShortcut($desktopLnk)
$shortcut.TargetPath = $desktopExe
$shortcut.WorkingDirectory = "C:\Users\BACH\Desktop"
$shortcut.IconLocation = "$desktopIco,0"
$shortcut.Description = "Oro - Neural Workspace & Agent"
$shortcut.Save()

# 5. Touch files to trigger Explorer change detection
(Get-Item $desktopExe).LastWriteTime = Get-Date
(Get-Item $desktopIco).LastWriteTime = Get-Date
(Get-Item $desktopLnk).LastWriteTime = Get-Date

# 6. Flush Shell Icon Cache
[ShellNotifier]::Flush()
Start-Process -FilePath "C:\Windows\System32\ie4uinit.exe" -ArgumentList "-show" -Wait -ErrorAction SilentlyContinue
[ShellNotifier]::Flush()

Write-Host "Desktop Oro.exe, shortcuts, and Shell icon cache successfully updated and notified!"
