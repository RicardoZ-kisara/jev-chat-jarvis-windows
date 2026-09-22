param([Parameter(Mandatory=$true)][Int64]$TargetHandle)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Drawing
    Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JevCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
    [void][JevCapture]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $handle = [IntPtr]$TargetHandle
    [UInt32]$ownerId = 0
    [void][JevCapture]::GetWindowThreadProcessId($handle,[ref]$ownerId)
    if ($ownerId -ne $payload.processId) { throw 'QQ window process changed. Refresh the list.' }
    if (-not [JevCapture]::IsWindow($handle) -or [JevCapture]::IsIconic($handle)) { throw 'Restore the selected window before capturing.' }
    $title = [Text.StringBuilder]::new(1024)
    [void][JevCapture]::GetWindowText($handle, $title, $title.Capacity)
    if ($title.ToString() -ne $payload.title) { throw 'Window changed. Refresh the window list.' }
    $rect = [JevCapture+Rect]::new()
    if (-not [JevCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot read window bounds.' }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 10 -or $height -lt 10 -or $width -gt 10000 -or $height -gt 10000) { throw 'Unsupported window size.' }
    $bitmap = [Drawing.Bitmap]::new($width,$height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    try { $success = [JevCapture]::PrintWindow($handle,$dc,2) }
    finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
    if (-not $success) { $bitmap.Dispose(); throw 'Window does not support capture. Paste the conversation manually.' }
    $stream = [IO.MemoryStream]::new()
    try { $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png); $encoded=[Convert]::ToBase64String($stream.ToArray()) }
    finally { $stream.Dispose(); $bitmap.Dispose() }
    [void][JevCapture]::GetWindowText($handle, $title, $title.Capacity)
    if ($title.ToString() -ne $payload.title) { throw 'Window changed during capture. Try again.' }
    [void][JevCapture]::GetWindowThreadProcessId($handle,[ref]$ownerId)
    if ($ownerId -ne $payload.processId) { throw 'QQ window process changed during capture.' }
    @{ok=$true;image=$encoded} | ConvertTo-Json -Compress
} catch { @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
