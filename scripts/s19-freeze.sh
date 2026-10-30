#!/usr/bin/env bash
# S19 freeze: md5 of every repository file of the app (git ls-files, tracked and untracked, ignored files left out),
# the S19 R scripts and the claim bank, into work/s19/FREEZE_md5.txt (paths from the lane folder). Usage (app folder):
#   bash scripts/s19-freeze.sh
set -euo pipefail
cd "$(dirname "$0")/.."
LIST=$(git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "fairtrial/$f"; done)
cd ..
{ echo "$LIST"; ls R/s19_*.R; echo work/s19/bank.json; } | sort | xargs -d '\n' md5sum > work/s19/FREEZE_md5.txt
echo "frozen $(wc -l < work/s19/FREEZE_md5.txt) files at $(date +%H:%M:%S)"
