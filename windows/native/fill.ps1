param([Parameter(Mandatory=$true)][Int64]$TargetHandle)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($payload.text) -or $payload.text.Length -gt 500) { throw 'Invalid reply.' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JevWindow {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
}
'@
    Start-Sleep -Seconds 5
    $handle = [IntPtr]$TargetHandle
    if (-not [JevWindow]::IsWindow($handle) -or [JevWindow]::GetForegroundWindow() -ne $handle) { throw 'Target window is not focused. Nothing was inserted.' }
    $title = [Text.StringBuilder]::new(1024)
    [void][JevWindow]::GetWindowText($handle, $title, $title.Capacity)
    if ($title.ToString() -ne $payload.title) { throw 'Window title changed. Capture the intended conversation again.' }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if ($root.Current.ProcessId -ne $payload.processId) { throw 'QQ process changed. Capture the QQ conversation again.' }
    $owner = Get-Process -Id $root.Current.ProcessId
    $synthetic = $payload.testProcessId -gt 0 -and $root.Current.ProcessId -eq $payload.testProcessId -and $title.ToString() -eq 'Jev QA Synthetic QQ'
    if ($owner.ProcessName -notin @('QQ','QQNT') -and -not $synthetic) { throw 'Only QQ windows are supported.' }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $focused -or $focused.Current.ProcessId -ne $root.Current.ProcessId) { throw 'Target input is not focused.' }
    $ancestor = $focused
    $belongs = $false
    for ($i=0; $i -lt 64 -and $null -ne $ancestor; $i++) {
        if ($ancestor.Equals($root)) { $belongs = $true; break }
        $ancestor = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($ancestor)
    }
    if (-not $belongs -or $focused.Current.IsPassword -or -not $focused.Current.IsEnabled -or $focused.Current.IsOffscreen) { throw 'This input cannot be safely filled.' }
    if ($focused.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit -and $focused.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document) { throw 'Focus a text input first.' }
    # Reject controls naming payments, secrets, search, address bars, or command entry.
    $label = $focused.Current.Name + ' ' + $focused.Current.AutomationId
    if ($label -match '(?i)password|payment|transfer|amount|address|search|terminal|command|密码|转账|红包|收款|金额|地址|搜索|命令') { throw 'This control is not a supported chat input.' }
    $pattern = $null
    if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw 'This app does not expose a writable input. Use Copy and paste manually.' }
    if ($pattern.Current.IsReadOnly -or -not [string]::IsNullOrEmpty($pattern.Current.Value)) { throw 'The input is read-only or already contains a draft. Nothing was overwritten.' }
    if ([JevWindow]::GetForegroundWindow() -ne $handle -or -not ([System.Windows.Automation.AutomationElement]::FocusedElement).Equals($focused)) { throw 'Focus changed. Nothing was inserted.' }
    $pattern.SetValue([string]$payload.text)
    # No key events, InvokePattern, paste shortcut or send-button automation.
    # Some providers publish Value asynchronously. Re-read only; never write twice.
    $verified = $false
    for ($i=0; $i -lt 20; $i++) {
        if ($pattern.Current.Value -eq $payload.text) { $verified = $true; break }
        Start-Sleep -Milliseconds 50
    }
    if (-not $verified) { throw 'Insertion could not be verified. Inspect the input before retrying.' }
    @{ok=$true} | ConvertTo-Json -Compress
} catch {
    @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
