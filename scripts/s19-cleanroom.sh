#!/usr/bin/env bash
# S19 clean rooms (prereg in R/s19_score.R): the repository's files, as git would commit them (tracked and untracked,
# ignored files left out), copied into fresh folders, then `npm ci` and `npm run ci` on Windows and on Linux (WSL
# Ubuntu, scripts/s19-cleanroom-linux.sh), and the end-to-end smoke. Usage (from the app folder):
#   bash scripts/s19-cleanroom.sh <outDir>
set -u
mkdir -p "$1"
OUT=$(cd "$1" && pwd)        # /d/... for this shell
OUT_W=$(cd "$1" && pwd -W)   # D:/... for Windows and WSL
APP=$(pwd)
APP_W=$(pwd -W)
git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "$f"; done > "$OUT/files.txt"
echo "files: $(wc -l < "$OUT/files.txt")" | tee "$OUT/windows_steps.log"

# Windows: the room sits beside <outDir> (drive D), not in the user's temp folder (drive C was 99% full on 30 Oct)
ROOM=$(mktemp -d -p "$(dirname "$OUT")" room.XXXXXX)
tar -cf - -T "$OUT/files.txt" | (cd "$ROOM" && tar -xf -)
cd "$ROOM"
echo "room $(pwd -W) ($(df -h . | tail -1 | awk '{print $4}') free); node $(node --version), npm $(npm --version); node_modules present: $([ -e node_modules ] && echo yes || echo no); .next present: $([ -e .next ] && echo yes || echo no); mediapipe present: $([ -e public/mediapipe ] && echo yes || echo no)" | tee -a "$OUT/windows_steps.log"
npm ci > "$OUT/windows_npm_ci.log" 2>&1; echo $? > "$OUT/windows_npm_ci.exit"
npm run ci > "$OUT/windows_ci.log" 2>&1; echo $? > "$OUT/windows_ci.exit"
npm run e2e > "$OUT/windows_e2e.log" 2>&1; echo $? > "$OUT/windows_e2e.exit"
echo "windows: npm ci $(cat "$OUT/windows_npm_ci.exit"); npm run ci $(cat "$OUT/windows_ci.exit"); npm run e2e $(cat "$OUT/windows_e2e.exit")" | tee -a "$OUT/windows_steps.log"
cd "$APP"
rm -rf "$ROOM"

# Linux (WSL Ubuntu), with paths as WSL sees them; MSYS must not rewrite them on the way
to_wsl() { echo "$1" | sed -E 's#^([A-Za-z]):/#/mnt/\L\1/#'; }
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash "$(to_wsl "$APP_W")/scripts/s19-cleanroom-linux.sh" "$(to_wsl "$OUT_W")/files.txt" "$(to_wsl "$OUT_W")"
echo "linux: npm ci $(cat "$OUT/linux_npm_ci.exit" 2>/dev/null); npm run ci $(cat "$OUT/linux_ci.exit" 2>/dev/null); e2e $(cat "$OUT/linux_e2e.exit" 2>/dev/null)" | tee -a "$OUT/windows_steps.log"
