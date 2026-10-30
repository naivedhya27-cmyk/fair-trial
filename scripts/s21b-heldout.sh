#!/usr/bin/env bash
# S21b held-out run (once; prereg and bars in R/s21b_score.R), 0 units, against https://fair-trial.vercel.app in the
# production configuration:
#   1. the production configuration set and the frozen files deployed; the monitor; the judges' check (B3)
#   2. a CI run started on the frozen commit (B4)
#   3. the face finder on fresh phones (B1), then the S16, S17 and S18 audits on fresh paths under the rerun rule (B2)
#   4. a clone of the public repository without credentials, its scan, the claim linter, the CI result (B4)
#   5. the monitor once more, then the scorer
# Refuses to run twice, with code that differs from the freeze (work/s21b/FREEZE_md5.txt), or with a commit other than
# the frozen one (work/s21b/FREEZE_commit.txt). The judges' code goes only into an environment: R reads it from Windows
# Credential Manager.
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s21b
H=$S/heldout
BASE=https://fair-trial.vercel.app
HOST=fair-trial.vercel.app
REPO=naivedhya27-cmyk/fair-trial
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S21b held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s21b/FREEZE_md5.txt) || { echo "code differs from the S21b freeze" >&2; exit 1; }
COMMIT=$(cat "$S/FREEZE_commit.txt")
[ "$(git rev-parse HEAD)" = "$COMMIT" ] && [ -z "$(git status --porcelain)" ] || { echo "the app folder is not the frozen commit" >&2; exit 1; }
touch "$S/HELD_OUT_SPENT"
mkdir -p "$H"
HW=$(cd "$H" && pwd -W)
bal() { sleep 5; Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
judge() { Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("fairtrial_judge"))'; }
serving() { MSYS_NO_PATHCONV=1 vercel api "/v13/deployments/$HOST" 2> /dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s.slice(s.indexOf('{'))).id)}catch{console.log('')}})"; }
FACES=$(Rscript -e 'set.seed(2026103158); cat(sprintf("D:/devpost_lane/youcam/work/faces2/g%02d.jpg", sample(12, 8)), sep = ",")')
FACE_PHONE=$(Rscript -e 'set.seed(2026103159); cat(sprintf("D:/devpost_lane/youcam/work/faces2/g%02d.jpg", sample(12, 1)))')
echo "faces: finder $FACES; judges' check $FACE_PHONE"
b0=$(bal)

# 1. the production configuration, the frozen files deployed, the monitor, the judges' check
mkdir -p "$H/deploy"
Rscript ../R/s21_env.R production > "$H/deploy/env.log" 2>&1 || { echo "production environment not set (see deploy/env.log)" >&2; exit 1; }
bash scripts/s20-deploy.sh "$H/deploy" || { echo "deploy failed" >&2; exit 1; }
DEP=$(node -e "console.log(require('$HW/deploy/deploy.json').deployment.id)")
MSYS_NO_PATHCONV=1 vercel api "/v6/deployments/$DEP/files" > "$H/deploy/api_files.json" 2> /dev/null
for _ in $(seq 1 60); do
  [ "$(serving)" = "$DEP" ] && break
  sleep 5
done
echo "deployment $DEP; the address serves $(serving)"
Rscript ../R/s21_monitor.R "$DEP" "$BASE" "$HW/monitor.csv"
JUDGE_PROBE="$(judge)" node scripts/s21-judges.mjs production "$HW/judges_production.json" "$BASE" "$FACE_PHONE" || echo "judges runner exited with $?"

# 2. a CI run on the frozen commit
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run ci.yml --repo "$REPO" --ref main
RUN=""
for _ in $(seq 1 30); do
  RUN=$(gh run list --repo "$REPO" --workflow ci.yml --event workflow_dispatch --limit 5 --json databaseId,headSha,createdAt \
    --jq "[.[] | select(.headSha == \"$COMMIT\" and .createdAt >= \"$T0\")][0].databaseId // empty")
  [ -n "$RUN" ] && break
  sleep 5
done
echo "CI run ${RUN:-not found}"

# 3. the face finder, then the audits under the rerun rule
node scripts/s21b-finder.mjs "$HW/finder.json" "$BASE" "$FACES" || echo "finder runner exited with $?"
Rscript ../R/s20_paths.R "$HW/paths" 2026103162 2026103161 2026103164 2026103163 2026103165 || exit 1
bash scripts/s21b-audits.sh "$H/paths" "$H/audits" "$BASE"

# 4. the public repository: main on GitHub, an anonymous clone, its scan, the claim linter, the CI result
GIT_TERMINAL_PROMPT=0 git -c credential.helper= ls-remote "https://github.com/$REPO.git" refs/heads/main > "$H/remote_main.txt"
rm -rf "$H/clone"
GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -c credential.helper= clone -q "https://github.com/$REPO.git" "$H/clone" || echo "anonymous clone failed"
(cd "$H/clone" && git rev-parse HEAD > ../clone_head.txt && git ls-files -z | xargs -0 md5sum) > "$H/clone_md5.txt"
Rscript ../R/s21_scan.R "$HW/clone" "$HW/scan.json"
npx tsx tools/claim-lint/cli.ts --json > "$H/claims.json"
npx tsx tools/claim-lint/cli.ts --json README.md docs/VALIDATION.md THIRD_PARTY_NOTICES.md > "$H/claims_docs.json"
if [ -n "$RUN" ]; then
  gh run watch "$RUN" --repo "$REPO" --exit-status --interval 30 > "$H/ci_watch.log" 2>&1
  gh run view "$RUN" --repo "$REPO" --json databaseId,event,headSha,status,conclusion,jobs,url > "$H/ci_run.json"
fi

# 5. the monitor once more, the balance, and the scorer
Rscript ../R/s21_monitor.R "$DEP" "$BASE" "$HW/monitor.csv"
b1=$(bal)
printf '{"start": %s, "end": %s}\n' "$b0" "$b1" > "$H/balances.json"
echo "balance $b0 -> $b1"
Rscript ../R/s21b_score.R "$HW"
