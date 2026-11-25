Add-Type -AssemblyName System.Drawing
$exe = 'C:\Users\BACH\Desktop\Oro.exe'
$icoExe = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$icoExe.ToBitmap().Save('C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\now_exe.png')

$lnk = 'C:\Users\BACH\Desktop\Oro.lnk'
$icoLnk = [System.Drawing.Icon]::ExtractAssociatedIcon($lnk)
$icoLnk.ToBitmap().Save('C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\now_lnk.png')

Write-Host "Saved now_exe.png and now_lnk.png"
