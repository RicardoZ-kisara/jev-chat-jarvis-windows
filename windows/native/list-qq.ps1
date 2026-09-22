param([Int32]$TestProcessId = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class JevQQWindows {
 public delegate bool Callback(IntPtr hwnd, IntPtr data);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr data);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
 public static IntPtr[] Handles() { var found=new List<IntPtr>(); EnumWindows((h,d)=>{if(IsWindowVisible(h))found.Add(h);return true;},IntPtr.Zero); return found.ToArray(); }
}
'@
    $windows = @()
    foreach ($handle in [JevQQWindows]::Handles()) {
        [UInt32]$ownerId = 0
        [void][JevQQWindows]::GetWindowThreadProcessId($handle,[ref]$ownerId)
        try { $process = Get-Process -Id $ownerId -ErrorAction Stop } catch { continue }
        $title = [Text.StringBuilder]::new(1024)
        [void][JevQQWindows]::GetWindowText($handle,$title,$title.Capacity)
        if ([string]::IsNullOrWhiteSpace($title.ToString())) { continue }
        $synthetic = $TestProcessId -gt 0 -and $ownerId -eq $TestProcessId -and $title.ToString() -eq 'Jev QA Synthetic QQ'
        if ($process.ProcessName -notin @('QQ','QQNT') -and -not $synthetic) { continue }
        $windows += @{id=('window:'+$handle.ToInt64()+':0');name=$title.ToString();processId=[Int32]$ownerId}
    }
    @{ok=$true;windows=@($windows)} | ConvertTo-Json -Compress -Depth 4
} catch { @{ok=$false;error='Cannot enumerate QQ windows.'} | ConvertTo-Json -Compress; exit 1 }
