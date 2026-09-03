# Turns a source logo image into the full favicon / home-screen icon set.
#
#   powershell -ExecutionPolicy Bypass -File make-icons.ps1 -Source data\logo.png
#
# Trims dead border, squares the art, renders every size the page asks for, and
# builds a multi-entry .ico. Detailed artwork loses its edges when it is scaled
# to 16px, so -TightCrop re-crops the small sizes closer to the subject.

param(
  [Parameter(Mandatory=$true)][string]$Source,
  [double]$TightCrop = 0.0,   # 0 = none. 0.12 crops 12% off each edge for 16/32px.
  [switch]$KeepBorder         # skip the automatic border trim
)

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing

if(-not (Test-Path $Source)){ throw "No image at $Source" }
$out = Join-Path $PSScriptRoot '..\matrixcommandcenter\school'
$out = [IO.Path]::GetFullPath($out)
if(-not (Test-Path $out)){ throw "Deploy folder missing: $out" }

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))
Write-Host "Source: $($src.Width)x$($src.Height)" -ForegroundColor Cyan

# --- trim uniform border (the art usually sits on a big black field) ---
function Get-ContentBox([System.Drawing.Bitmap]$b){
  $bg = $b.GetPixel(1,1)
  $tol = 26
  $near = { param($p) ([math]::Abs($p.R-$bg.R) -le $tol -and [math]::Abs($p.G-$bg.G) -le $tol `
            -and [math]::Abs($p.B-$bg.B) -le $tol -and $p.A -gt 8) -or $p.A -le 8 }
  $l=$b.Width; $r=0; $t=$b.Height; $bt=0
  $step = [Math]::Max(1,[int]($b.Width/400))
  for($y=0;$y -lt $b.Height;$y+=$step){
    for($x=0;$x -lt $b.Width;$x+=$step){
      if(-not (& $near $b.GetPixel($x,$y))){
        if($x -lt $l){$l=$x}; if($x -gt $r){$r=$x}
        if($y -lt $t){$t=$y}; if($y -gt $bt){$bt=$y}
      }
    }
  }
  if($r -le $l -or $bt -le $t){ return [System.Drawing.Rectangle]::new(0,0,$b.Width,$b.Height) }
  $pad = [int]($b.Width*0.01)
  $l=[Math]::Max(0,$l-$pad); $t=[Math]::Max(0,$t-$pad)
  $r=[Math]::Min($b.Width-1,$r+$pad); $bt=[Math]::Min($b.Height-1,$bt+$pad)
  return [System.Drawing.Rectangle]::new($l,$t,$r-$l+1,$bt-$t+1)
}

$box = if($KeepBorder){ [System.Drawing.Rectangle]::new(0,0,$src.Width,$src.Height) } else { Get-ContentBox $src }
Write-Host "Content box: $($box.Width)x$($box.Height) at $($box.X),$($box.Y)"

# square it around the content so nothing is stretched
$side = [Math]::Max($box.Width,$box.Height)
$sq = New-Object System.Drawing.Bitmap($side,$side)
$g = [System.Drawing.Graphics]::FromImage($sq)
$g.Clear($src.GetPixel(1,1))
$g.InterpolationMode='HighQualityBicubic'
$g.DrawImage($src, [int](($side-$box.Width)/2), [int](($side-$box.Height)/2),
             $box, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

function Render([System.Drawing.Bitmap]$from,[int]$size,[double]$crop){
  $s = $from
  $owned = $false
  if($crop -gt 0){
    $inset = [int]($from.Width*$crop)
    $r = [System.Drawing.Rectangle]::new($inset,$inset,$from.Width-2*$inset,$from.Height-2*$inset)
    $s = $from.Clone($r,$from.PixelFormat); $owned = $true
  }
  $b = New-Object System.Drawing.Bitmap($size,$size)
  $gg = [System.Drawing.Graphics]::FromImage($b)
  $gg.InterpolationMode='HighQualityBicubic'
  $gg.SmoothingMode='AntiAlias'; $gg.PixelOffsetMode='HighQuality'
  $gg.DrawImage($s,0,0,$size,$size)
  $gg.Dispose()
  if($owned){ $s.Dispose() }
  return $b
}

foreach($spec in @(@{n='icon-512.png';s=512;c=0.0}, @{n='icon-192.png';s=192;c=0.0},
                   @{n='icon-180.png';s=180;c=0.0}, @{n='icon-32.png';s=32;c=$TightCrop})){
  $b = Render $sq $spec.s $spec.c
  $b.Save((Join-Path $out $spec.n),[System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Host ("  {0,-15} {1,7} bytes" -f $spec.n,(Get-Item (Join-Path $out $spec.n)).Length)
}

# --- multi-entry .ico: 32 (tight) + 256 (full) ---
$p32 = Render $sq 32 $TightCrop
$p256 = Render $sq 256 0.0
function ToPng([System.Drawing.Bitmap]$b){
  $m=New-Object IO.MemoryStream; $b.Save($m,[System.Drawing.Imaging.ImageFormat]::Png)
  $bytes=$m.ToArray(); $m.Dispose(); return $bytes
}
# Cast back to byte[]: PowerShell unrolls an array return into the pipeline, so
# these arrive as Object[] and BinaryWriter.Write silently matches no overload,
# leaving a 40-byte header-only .ico.
$a=[byte[]](ToPng $p32); $c=[byte[]](ToPng $p256)
$p32.Dispose(); $p256.Dispose()
if($a.Length -lt 100 -or $c.Length -lt 100){ throw "PNG encoding produced no data ($($a.Length)/$($c.Length) bytes)" }
$ms=New-Object IO.MemoryStream; $w=New-Object IO.BinaryWriter($ms)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]2)
$off=6+16*2
$w.Write([byte]32);$w.Write([byte]32);$w.Write([byte]0);$w.Write([byte]0)
$w.Write([uint16]1);$w.Write([uint16]32);$w.Write([uint32]$a.Length);$w.Write([uint32]$off)
$w.Write([byte]0);$w.Write([byte]0);$w.Write([byte]0);$w.Write([byte]0)
$w.Write([uint16]1);$w.Write([uint16]32);$w.Write([uint32]$c.Length);$w.Write([uint32]($off+$a.Length))
$w.Write($a); $w.Write($c); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $out 'favicon.ico'),$ms.ToArray())
$w.Dispose(); $ms.Dispose()
Write-Host ("  {0,-15} {1,7} bytes" -f 'favicon.ico',(Get-Item (Join-Path $out 'favicon.ico')).Length)

# A raster logo has no vector equivalent; drop the old hand-drawn SVG so the
# browser cannot prefer a stale mark over the new art.
$svg = Join-Path $out 'favicon.svg'
if(Test-Path $svg){ Remove-Item $svg -Force; Write-Host "  removed stale favicon.svg" -ForegroundColor Yellow }

$sq.Dispose(); $src.Dispose()
Write-Host "Done. Commit and push to deploy." -ForegroundColor Green
