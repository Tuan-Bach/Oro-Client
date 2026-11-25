Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class ShellNotifier {
    [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

    public const int SHCNE_ASSOCCHANGED = 0x08000000;
    public const int SHCNE_UPDATEITEM = 0x00002000;
    public const int SHCNF_FLUSH = 0x1000;

    public static void Flush() {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

Write-Host "Restarting Explorer to refresh visual desktop icons..."
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Flushing Shell icon cache..."
[ShellNotifier]::Flush()
Start-Process -FilePath "C:\Windows\System32\ie4uinit.exe" -ArgumentList "-show" -Wait -ErrorAction SilentlyContinue
[ShellNotifier]::Flush()

Write-Host "Explorer restarted and icon cache notified."
