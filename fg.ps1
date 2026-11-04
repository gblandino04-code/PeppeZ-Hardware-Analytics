# Legge la finestra in primo piano ogni 400ms (anche su processi protetti da Anti-Cheat come Elytra/EAC/BattlEye),
# monitora i processi di gioco attivi in background e mantiene i widget desktop dietro le finestre (HWND_BOTTOM).
param([string]$HwndFile = "")
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public struct WRECT { public int L, T, R, B; }
public static class FG {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out WRECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr hObject);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);

  public static string GetProcPathLimited(int pid) {
    if (pid <= 4) return "";
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION (funziona anche con Anti-Cheat EAC/Elytra/BattlEye)
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      int sz = sb.Capacity;
      if (QueryFullProcessImageNameW(h, 0, sb, ref sz)) return sb.ToString();
    } catch {} finally {
      CloseHandle(h);
    }
    return "";
  }
}
"@
[void][FG]::SetProcessDPIAware()
$wCfg = $null
$wMtime = [DateTime]::MinValue
$tick = 0

while ($true) {
  $tick++
  $o = [ordered]@{ cls = ""; pid = 0; name = ""; exe = ""; title = ""; fs = $false; bl = $false; mode = "Windowed"; x = 0; y = 0; procs = @() }
  $h = [FG]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object Text.StringBuilder 256
    [void][FG]::GetClassName($h, $sb, 256); $o.cls = $sb.ToString()
    $sb2 = New-Object Text.StringBuilder 256
    [void][FG]::GetWindowText($h, $sb2, 256); $o.title = $sb2.ToString()
    $p = 0; [void][FG]::GetWindowThreadProcessId($h, [ref]$p); $o.pid = $p
    if ($p -gt 0) {
      try {
        $gp = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($gp) {
          $o.name = [string]$gp.Name
          if ($gp.Path) { $o.exe = [string]$gp.Path }
        }
      } catch {}
      if (-not $o.exe) {
        $o.exe = [FG]::GetProcPathLimited($p)
      }
      if ((-not $o.exe) -and $o.name) {
        $o.exe = $o.name + ".exe"
      }
    }
    $r = New-Object WRECT
    if ([FG]::GetWindowRect($h, [ref]$r)) {
      $b = [Windows.Forms.Screen]::FromHandle($h).Bounds
      $style = [FG]::GetWindowLong($h, -16)
      $cap = (($style -band 0xC00000) -eq 0xC00000)
      $coversScreen = ($r.L -le ($b.Left + 2) -and $r.T -le ($b.Top + 2) -and $r.R -ge ($b.Right - 2) -and $r.B -ge ($b.Bottom - 2))
      $isGameClass = $o.cls -match '^(UnrealWindow|UnityWndClass|SDL_app|Valve001|Respawn001|CryENGINE|grcWindow|IW8|prism3d|GLFW30)$'
      $o.fs = ($coversScreen -and (-not $cap))
      $o.bl = ($coversScreen -or $isGameClass)
      $o.mode = if ($o.fs) { "Fullscreen / Borderless" } elseif ($coversScreen) { "Massimizzata" } else { "Finestra" }
      $o.x = [int](($r.L + $r.R) / 2); $o.y = [int](($r.T + $r.B) / 2)
    }
  }

  # Ogni ~1.6s raccoglie la lista dei processi con finestra o processi di gioco attivi (per mantenere viva la sessione anche durante Alt+Tab o cambio processo launcher->gioco)
  if (($tick % 4) -eq 1) {
    $pList = @()
    try {
      $all = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -gt 4 -and ($_.MainWindowHandle -ne 0 -or $_.Name -match 'PioneerGame|Shipping|cs2|Fortnite|Sifu|AimLab|Rematch|javaw|minecraft|valorant|r5apex|cod|eldenring|cyberpunk|gtav|bg3|helldivers|overwatch|league|rocketleague|start_protected_game|EasyAntiCheat')
      }
      foreach ($pr in $all) {
        $pPath = ""
        try { $pPath = $pr.Path } catch {}
        if (-not $pPath) { $pPath = [FG]::GetProcPathLimited($pr.Id) }
        $pList += @{
          pid = $pr.Id
          name = [string]$pr.Name
          exe = [string]$pPath
          title = [string]$pr.MainWindowTitle
        }
      }
    } catch {}
    $o.procs = $pList
  }

  if ($HwndFile -and (Test-Path $HwndFile)) {
    try {
      $fi = Get-Item $HwndFile
      if ($fi.LastWriteTimeUtc -ne $wMtime) {
        $wMtime = $fi.LastWriteTimeUtc
        $wCfg = Get-Content $HwndFile -Raw | ConvertFrom-Json
      }
      if ($wCfg -and (-not $wCfg.top) -and $wCfg.hwnds) {
        $lmb = ([FG]::GetAsyncKeyState(1) -band 0x8000) -ne 0
        foreach ($id in $wCfg.hwnds) {
          $ptr = [IntPtr][int64]$id
          if ($ptr -eq [IntPtr]::Zero) { continue }
          if ([FG]::IsIconic($ptr)) { [void][FG]::ShowWindow($ptr, 4) }
          $ex = [FG]::GetWindowLong($ptr, -20)
          if ((($ex -band 0x80) -eq 0) -or (($ex -band 0x40000) -ne 0)) {
            [void][FG]::SetWindowLong($ptr, -20, ($ex -bor 0x80) -band (-bnot 0x40000))
          }
          if (-not ($lmb -and ($h -eq $ptr))) {
            [void][FG]::SetWindowPos($ptr, [IntPtr]1, 0, 0, 0, 0, 0x0013)
          }
        }
      }
    } catch {}
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 3 -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 400
}
