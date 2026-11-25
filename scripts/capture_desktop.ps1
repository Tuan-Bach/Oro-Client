Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

# Crop the top-left portion where desktop icons usually sit (e.g. 350x450)
$crop = New-Object System.Drawing.Bitmap 360, 420
$cropGraphics = [System.Drawing.Graphics]::FromImage($crop)
$srcRect = New-Object System.Drawing.Rectangle 0, 0, 360, 420
$destRect = New-Object System.Drawing.Rectangle 0, 0, 360, 420
$cropGraphics.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$crop.Save("C:\Users\BACH\.gemini\antigravity\brain\accffe1d-09e9-4f01-8d4d-e311253ccb34\actual_desktop_screenshot.png")
Write-Host "Captured desktop screenshot to actual_desktop_screenshot.png"
