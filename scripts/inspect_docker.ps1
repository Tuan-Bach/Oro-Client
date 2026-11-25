Add-Type -AssemblyName System.Drawing
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut('C:\Users\BACH\Desktop\Docker Desktop.lnk')
Write-Host "Docker Target: " $lnk.TargetPath
Write-Host "Docker IconLocation: " $lnk.IconLocation

$iconPath = $lnk.TargetPath
if ($lnk.IconLocation -and (Test-Path ($lnk.IconLocation.Split(',')[0]))) {
    $iconPath = $lnk.IconLocation.Split(',')[0]
}

if (Test-Path $iconPath) {
    $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
    $bmp = $ico.ToBitmap()
    $bmp.Save('C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\extracted_docker_icon.png')
    Write-Host "Extracted docker icon to extracted_docker_icon.png"
}
