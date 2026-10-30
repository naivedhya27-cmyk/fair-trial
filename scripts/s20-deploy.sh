#!/usr/bin/env bash
# S20 deploy (prereg in R/s20_score.R): the repository's files, as git would commit them (tracked and untracked, ignored
# files left out: no node_modules, .next, copied MediaPipe files or test output), copied into a fresh deploy folder and
# sent to Vercel as a production deployment of the project "fair-trial" (Minal's Hobby scope). Vercel installs and
# builds them. The YouCam key is set separately (R/s20_env.R); nothing here reads or prints it.
# Usage (from the app folder): bash scripts/s20-deploy.sh <outDir>
# Writes <outDir>/deploy_files.txt (the files and their md5s), deploy.json (the CLI's answer) and deploy.log.
set -uo pipefail
OUT=$(mkdir -p "$1" && cd "$1" && pwd)
PROJECT=fair-trial
DIR=$(mktemp -d -p "$(dirname "$OUT")" deploy.XXXXXX)
git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "$f"; done | sort > "$OUT/files.txt"
tar -cf - -T "$OUT/files.txt" | (cd "$DIR" && tar -xf -)
(cd "$DIR" && xargs -d '\n' md5sum < "$OUT/files.txt") > "$OUT/deploy_files.txt"
echo "deploy folder $(cd "$DIR" && pwd -W): $(wc -l < "$OUT/files.txt") files" | tee "$OUT/deploy.log"
# no `vercel link`: it writes a project token into .env.local; --project names the project instead
vercel deploy --prod --yes --json --project "$PROJECT" --cwd "$DIR" > "$OUT/deploy.json" 2>> "$OUT/deploy.log"
code=$?
echo "vercel deploy exit $code" | tee -a "$OUT/deploy.log"
# the CLI leaves a helper running in the folder for a moment, and Windows won't remove a folder in use
for _ in 1 2 3 4 5 6 7 8 9 10; do rm -rf "$DIR" 2>/dev/null && break; sleep 3; done
exit $code
