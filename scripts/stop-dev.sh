#!/usr/bin/env bash
# Stop the dev server on port 3123 started by dev-with-key.sh (only that process tree: npx ... next dev -p 3123).
powershell -NoProfile -Command '
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "npx-cli\.js.*next dev -p 3123" }
foreach ($x in $p) { taskkill /PID $x.ProcessId /T /F | Out-Null }
Start-Sleep -Seconds 2
$left = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "next dev -p 3123|fairtrial\\node_modules\\next" }
"stopped " + @($p).Count + " server tree(s); node processes left on 3123: " + @($left).Count
'
