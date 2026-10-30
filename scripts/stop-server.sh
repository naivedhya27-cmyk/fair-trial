#!/usr/bin/env bash
# Stop the server on port 3123 started by dev-with-key.sh or prod-with-key.sh (only that process tree).
powershell -NoProfile -Command '
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "npx-cli\.js.*next (dev|start) -p 3123" }
foreach ($x in $p) { taskkill /PID $x.ProcessId /T /F | Out-Null }
Start-Sleep -Seconds 2
$left = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "next (dev|start) -p 3123|fairtrial\node_modules\next" }
"stopped " + @($p).Count + " server tree(s); node processes left on 3123: " + @($left).Count
'
