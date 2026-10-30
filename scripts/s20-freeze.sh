#!/usr/bin/env bash
# S20 freeze: md5 of every repository file of the app (git ls-files, tracked and untracked, ignored files left out), the
# S20 R scripts, the earlier steps' R scripts the S20 run calls, and the claim bank v2, into work/s20/FREEZE_md5.txt
# (paths from the lane folder). Usage (app folder): bash scripts/s20-freeze.sh
set -euo pipefail
cd "$(dirname "$0")/.."
LIST=$(git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "fairtrial/$f"; done)
cd ..
{ echo "$LIST"; ls R/s20_*.R; printf '%s\n' R/s16_paths.R R/s16_score.R R/s17_paths.R R/s17_score.R R/s18_demo.R R/s18_paths.R R/s18_score.R \
    R/s19_mutants.R R/yc_lib.R R/keys_lib.R work/s20/bank.json; } | sort | xargs -d '\n' md5sum > work/s20/FREEZE_md5.txt
echo "frozen $(wc -l < work/s20/FREEZE_md5.txt) files at $(date +%H:%M:%S)"
