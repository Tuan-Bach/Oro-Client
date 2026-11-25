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

# 1. Recompile Oro.exe with win32icon
Write-Host "1. Recompiling Oro.exe with win32icon..."
& $csc /target:winexe /optimize+ /win32icon:$icoPath /out:$srcExe $launcherCs

# 2. Copy Oro.exe and icons to Desktop atomically
Write-Host "2. Copying Oro.exe and icons to Desktop..."
Replace-FileAtomic $srcExe $desktopExe
Replace-FileAtomic $icoPath $desktopIco
Replace-FileAtomic $icoPath "C:\Users\BACH\Desktop\Oro_Round.ico"
Replace-FileAtomic $icoPath "C:\Users\BACH\Desktop\Oro_App.ico"

# 3. Update Desktop shortcut
Write-Host "3. Updating Oro.lnk shortcut..."
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

# 4. Touch files
(Get-Item $desktopExe).LastWriteTime = Get-Date
(Get-Item $desktopIco).LastWriteTime = Get-Date
(Get-Item $desktopLnk).LastWriteTime = Get-Date

# 5. Stop Explorer to unlock iconcache databases
Write-Host "5. Stopping explorer process to unlock iconcache..."
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 6. Delete iconcache databases
Write-Host "6. Removing cached icon databases..."
$cacheDir = "$env:LOCALAPPDATA\Microsoft\Windows\Explorer"
Get-ChildItem -Path $cacheDir -Filter "iconcache*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $cacheDir -Filter "thumbcache*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue

# 7. Restart Explorer
Write-Host "7. Restarting explorer..."
Start-Process explorer
Start-Sleep -Seconds 2

# 8. Trigger Windows icon cache rebuild utilities
Write-Host "8. Calling ie4uinit & shell flush..."
Start-Process -FilePath "C:\Windows\System32\ie4uinit.exe" -ArgumentList "-show" -Wait -ErrorAction SilentlyContinue
[ShellNotifier]::Flush()

Write-Host "Done! Desktop Oro.exe and shortcuts updated and icon cache completely purged!"