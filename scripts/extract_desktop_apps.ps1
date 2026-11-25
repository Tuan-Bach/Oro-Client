Add-Type -AssemblyName System.Drawing

$apps = @(
    "Docker Desktop.lnk",
    "GitHub Desktop.lnk",
    "Discord.lnk",
    "Oro.lnk"
)

foreach ($app in $apps) {
    $path = "C:\Users\BACH\Desktop\" + $app
    if (Test-Path $path) {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
        $bmp = $icon.ToBitmap()
        $out = "C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\" + $app.Replace(" ", "_").Replace(".lnk", ".png")
        $bmp.Save($out)
        Write-Host "Saved $out : size $($bmp.Width)x$($bmp.Height)"
    }
}
