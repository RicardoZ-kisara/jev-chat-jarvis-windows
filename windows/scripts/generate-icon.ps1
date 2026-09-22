$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot '../resources'
[IO.Directory]::CreateDirectory($dir) | Out-Null
$bitmap = [Drawing.Bitmap]::new(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$shape = [Drawing.Drawing2D.GraphicsPath]::new()
foreach ($arc in @(@(8,8,64,64,180,90),@(184,8,64,64,270,90),@(184,184,64,64,0,90),@(8,184,64,64,90,90))) { $shape.AddArc($arc[0],$arc[1],$arc[2],$arc[3],$arc[4],$arc[5]) }
$shape.CloseFigure()
$brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#246455'))
$graphics.FillPath($brush,$shape)
$font = [Drawing.Font]::new('Segoe UI',151,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$format = [Drawing.StringFormat]::new()
$format.Alignment = [Drawing.StringAlignment]::Center
$format.LineAlignment = [Drawing.StringAlignment]::Center
$graphics.DrawString('j.',$font,[Drawing.Brushes]::White,[Drawing.RectangleF]::new(0,-9,256,256),$format)
$buffer=[IO.MemoryStream]::new()
$bitmap.Save($buffer,[Drawing.Imaging.ImageFormat]::Png)
$png=$buffer.ToArray()
$file=[IO.File]::Create((Join-Path $dir 'icon.ico'))
$writer=[IO.BinaryWriter]::new($file)
$writer.Write([UInt16]0);$writer.Write([UInt16]1);$writer.Write([UInt16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([UInt16]1);$writer.Write([UInt16]32);$writer.Write([UInt32]$png.Length);$writer.Write([UInt32]22);$writer.Write($png)
$writer.Dispose();$buffer.Dispose();$font.Dispose();$format.Dispose();$shape.Dispose();$brush.Dispose();$graphics.Dispose();$bitmap.Dispose()
Write-Output 'Windows application icon generated.'
