$wsh = New-Object -ComObject WScript.Shell
$desktopLnk = "C:\Users\BACH\Desktop\Oro.lnk"
if (Test-Path $desktopLnk) {
    Remove-Item -Path $desktopLnk -Force
}
$shortcut = $wsh.CreateShortcut($desktopLnk)
$shortcut.TargetPath = "C:\Users\BACH\Desktop\Oro.exe"
$shortcut.WorkingDirectory = "C:\Users\BACH\Desktop"
$shortcut.IconLocation = "C:\Users\BACH\Desktop\Oro.ico,0"
$shortcut.Description = "Oro - Neural Workspace & Agent"
$shortcut.Save()

Write-Host "Created fresh Oro.lnk successfully pointing to Oro.ico,0!"
