Add-Type -AssemblyName System.Drawing

$outDir = "C:\_dCode\SingBox\src-tauri\icons"

# Create a 256x256 base image
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(30, 41, 59))

$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(59, 130, 246))
$g.FillEllipse($brush, 40, 40, 176, 176)

$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font("Segoe UI", 72, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 0, 256, 256)
$g.DrawString("S", $font, $whiteBrush, $rect, $sf)
$g.Dispose()

# Save PNG versions
$bmp.Save("$outDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

$bmp32 = New-Object System.Drawing.Bitmap($bmp, 32, 32)
$bmp32.Save("$outDir\32x32.png", [System.Drawing.Imaging.ImageFormat]::Png)

$bmp128 = New-Object System.Drawing.Bitmap($bmp, 128, 128)
$bmp128.Save("$outDir\128x128.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp128.Save("$outDir\128x128@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Build ICO with embedded PNGs
$sizes = @(16, 32, 48)
$pngByteArrays = New-Object System.Collections.ArrayList

foreach ($s in $sizes) {
    $resized = New-Object System.Drawing.Bitmap($bmp, $s, $s)
    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()
    $resized.Dispose()
    [void]$pngByteArrays.Add($pngBytes)
    Write-Host "Size ${s}x${s}: $($pngBytes.Length) bytes"
}

$numImages = $sizes.Count
$headerSize = 6
$dirEntrySize = 16
$dataStartOffset = $headerSize + ($numImages * $dirEntrySize)

# Build the ICO binary
$ico = New-Object System.IO.MemoryStream

# ICONDIR: 6 bytes
$icoHeader = [System.BitConverter]::GetBytes([System.UInt16]0)     # Reserved
$ico.Write($icoHeader, 0, 2)
$icoType = [System.BitConverter]::GetBytes([System.UInt16]1)       # Type = ICO
$ico.Write($icoType, 0, 2)
$icoCount = [System.BitConverter]::GetBytes([System.UInt16]$numImages)
$ico.Write($icoCount, 0, 2)

# Calculate offsets for each image
$currentOffset = $dataStartOffset
for ($i = 0; $i -lt $numImages; $i++) {
    $s = $sizes[$i]
    $imgData = [byte[]]$pngByteArrays[$i]
    $imgSize = $imgData.Length

    # ICONDIRENTRY: 16 bytes
    $ico.WriteByte([byte]$s)          # Width
    $ico.WriteByte([byte]$s)          # Height
    $ico.WriteByte([byte]0)           # Color count
    $ico.WriteByte([byte]0)           # Reserved
    $planes = [System.BitConverter]::GetBytes([System.UInt16]1)
    $ico.Write($planes, 0, 2)        # Color planes
    $bpp = [System.BitConverter]::GetBytes([System.UInt16]32)
    $ico.Write($bpp, 0, 2)           # Bits per pixel
    $sizeBytes = [System.BitConverter]::GetBytes([System.UInt32]$imgSize)
    $ico.Write($sizeBytes, 0, 4)     # Image data size
    $offsetBytes = [System.BitConverter]::GetBytes([System.UInt32]$currentOffset)
    $ico.Write($offsetBytes, 0, 4)   # Offset to image data

    $currentOffset += $imgSize
}

# Write all PNG image data
for ($i = 0; $i -lt $numImages; $i++) {
    $imgData = [byte[]]$pngByteArrays[$i]
    $ico.Write($imgData, 0, $imgData.Length)
}

# Save ICO
$icoBytes = $ico.ToArray()
$ico.Dispose()
[System.IO.File]::WriteAllBytes("$outDir\icon.ico", $icoBytes)

Write-Host "icon.ico size: $($icoBytes.Length) bytes"
Write-Host "Done!"

$bmp.Dispose()
$bmp32.Dispose()
$bmp128.Dispose()
