#!/usr/bin/env bash
# S21 held-out run (once; prereg and bars in R/s21_score.R), 0 units, against https://fair-trial.vercel.app:
#   1. the test configuration (public floor 100000) set and the frozen files deployed; the judges' check (B2, B3)
#   2. the production configuration set and deployed again; the monitor; the public phone in production (B3)
#   3. the repository made public and a CI run started on the frozen commit (B5)
#   4. the face finder on fresh phones (B1), then the S16, S17 and S18 audits on fresh paths (B4)
#   5. a clone of the public repository without credentials, its scan, the claim linter, the CI result (B5)
#   6. the monitor once more, then the scorer
# Refuses to run twice, with code that differs from the freeze (work/s21/FREEZE_md5.txt), or with a commit other than
# the frozen one (work/s21/FREEZE_commit.txt). The judges' code goes only into an environment, as the key did in S14
# and S20: R reads it from Windows Credential Manager.
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s21
H=$S/heldout
BASE=https://fair-trial.vercel.app
REPO=naivedhya27-cmyk/fair-trial
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S21 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s21/FREEZE_md5.txt) || { echo "code differs from the S21 freeze" >&2; exit 1; }
COMMIT=$(cat "$S/FREEZE_commit.txt")
[ "$(git rev-parse HEAD)" = "$COMMIT" ] && [ -z "$(git status --porcelain)" ] || { echo "the app folder is not the frozen commit" >&2; exit 1; }
touch "$S/HELD_OUT_SPENT"
mkdir -p "$H"
HW=$(cd "$H" && pwd -W)
bal() { sleep 5; Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
judge() { Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("fairtrial_judge"))'; }
deploy() { # <configuration>: set it, deploy the frozen files, wait until the address serves that configuration
  local floor=200 dep
  [ "$1" = test ] && floor=100000
  mkdir -p "$H/deploy_$1"
  Rscript ../R/s21_env.R "$1" > "$H/deploy_$1/env.log" 2>&1 || { echo "$1 environment not set (see deploy_$1/env.log)" >&2; exit 1; }
  bash scripts/s20-deploy.sh "$H/deploy_$1" || { echo "$1 deploy failed" >&2; exit 1; }
  dep=$(node -e "console.log(require('$HW/deploy_$1/deploy.json').deployment.id)")
  MSYS_NO_PATHCONV=1 vercel api "/v6/deployments/$dep/files" > "$H/deploy_$1/api_files.json" 2> /dev/null
  for _ in $(seq 1 60); do
    [ "$(curl -s --max-time 20 "$BASE/api/status" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).floors.public)}catch{console.log('')}})")" = "$floor" ] && break
    sleep 5
  done
  echo "$1: deployment $dep serves public floor $floor"
  DEP=$dep
}
FACES=$(Rscript -e 'set.seed(2026103156); cat(sprintf("D:/devpost_lane/youcam/work/faces2/g%02d.jpg", sample(12, 8)), sep = ",")')
FACE_POST=$(Rscript -e 'set.seed(2026103157); cat(sprintf("D:/devpost_lane/youcam/work/faces2/g%02d.jpg", sample(12, 1)))')
echo "faces: finder $FACES; analysis requests $FACE_POST"
b0=$(bal)

# 1. the test configuration
deploy test
JUDGE_PROBE="$(judge)" node scripts/s21-judges.mjs test "$HW/judges_test.json" "$BASE" "$FACE_POST" || echo "judges runner (test) exited with $?"
b1=$(bal)

# 2. the production configuration
deploy production
DEP_P=$DEP
Rscript ../R/s21_monitor.R "$DEP_P" "$BASE" "$HW/monitor.csv"
JUDGE_PROBE="$(judge)" node scripts/s21-judges.mjs production "$HW/judges_production.json" "$BASE" "$FACE_POST" || echo "judges runner (production) exited with $?"

# 3. the repository made public, and a CI run on the frozen commit
gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences
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

# 4. the face finder, then the audits
node scripts/s21-finder.mjs "$HW/finder.json" "$BASE" "$FACES" || echo "finder runner exited with $?"
Rscript ../R/s20_paths.R "$HW/paths" 2026103152 2026103151 2026103154 2026103153 2026103155 || exit 1
bash scripts/s20-audits.sh "$H/paths" "$H/audits" "$BASE"

# 5. the public repository: an anonymous clone, its scan, the claim linter, the CI result
curl -s https://api.github.com/repos/$REPO > "$H/repo_public.json"
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

# 6. the monitor once more, the balance, and the scorer
Rscript ../R/s21_monitor.R "$DEP_P" "$BASE" "$HW/monitor.csv"
b2=$(bal)
printf '{"start": %s, "after_test": %s, "end": %s}\n' "$b0" "$b1" "$b2" > "$H/balances.json"
echo "balance $b0 -> $b1 -> $b2"
Rscript ../R/s21_score.R "$HW"
