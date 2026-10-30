#!/usr/bin/env bash
# S21 freeze: md5 of every repository file of the app (git ls-files, tracked and untracked, ignored files left out), the
# S21 R scripts and the earlier steps' R scripts the S21 run calls, into work/s21/FREEZE_md5.txt (paths from the lane
# folder), and the commit in work/s21/FREEZE_commit.txt. Refuses while the app folder holds changes git has not
# committed, or while main differs from GitHub's: the repository the judges get must be the frozen files.
# Usage (app folder): bash scripts/s21-freeze.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "commit first: the app folder holds changes git has not committed" >&2; exit 1; }
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "push first: main differs from origin/main" >&2; exit 1; }
LIST=$(git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "fairtrial/$f"; done)
COMMIT=$(git rev-parse HEAD)
cd ..
mkdir -p work/s21
{ echo "$LIST"; ls R/s21_*.R; printf '%s\n' R/s16_paths.R R/s16_score.R R/s17_paths.R R/s17_score.R R/s18_demo.R R/s18_paths.R R/s18_score.R \
    R/s20_paths.R R/yc_lib.R R/keys_lib.R; } | sort | xargs -d '\n' md5sum > work/s21/FREEZE_md5.txt
echo "$COMMIT" > work/s21/FREEZE_commit.txt
echo "frozen $(wc -l < work/s21/FREEZE_md5.txt) files at $(date +%H:%M:%S), commit ${COMMIT:0:7}"
