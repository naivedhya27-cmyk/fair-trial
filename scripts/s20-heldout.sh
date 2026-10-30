#!/usr/bin/env bash
# S20 held-out run (once; prereg and bars in R/s20_score.R): set the production environment, deploy the frozen files
# to Vercel production, then against https://fair-trial.vercel.app from fresh browsers: the monitor, the S16, S17 and S18
# audits on fresh paths (0 units), the live path (the S14 refusals and one live analysis, 9 units), the policy check on
# claim bank v2, the monitor again, and the scorer. Refuses to run twice, or with code that differs from the freeze
# (work/s20/FREEZE_md5.txt). The key goes only into environments, as in S14: R reads it from Windows Credential Manager.
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s20
H=$S/heldout
BASE=https://fair-trial.vercel.app
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S20 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s20/FREEZE_md5.txt) || { echo "code differs from the S20 freeze" >&2; exit 1; }
touch "$S/HELD_OUT_SPENT"
mkdir -p "$H/deploy"
HW=$(cd "$H" && pwd -W)
bal() { sleep 5; Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
key() { Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("youcam"))'; }

# 1. what is deployed: the frozen files' sha1s (Vercel names a deployed file by its sha1)
git ls-files --cached --others --exclude-standard | while read -r f; do [ -f "$f" ] && echo "$f"; done | sort | xargs -d '\n' sha1sum > "$H/deploy/sha1.txt"
# 2. the environment, then the deploy, and Vercel's own record of both
Rscript ../R/s20_env.R 30 3 > "$H/deploy/env.log" 2>&1 || { echo "environment not set (see deploy/env.log)" >&2; exit 1; }
bash scripts/s20-deploy.sh "$H/deploy" || { echo "deploy failed" >&2; exit 1; }
DEP=$(node -e "console.log(require('$HW/deploy/deploy.json').deployment.id)")
echo "deployment $DEP"
MSYS_NO_PATHCONV=1 vercel api "/v6/deployments/$DEP/files" > "$H/deploy/api_files.json" 2> /dev/null
MSYS_NO_PATHCONV=1 vercel api /v9/projects/fair-trial > "$H/deploy/project.json" 2> /dev/null
for _ in $(seq 1 30); do [ "$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/status")" = "200" ] && break; sleep 2; done
Rscript ../R/s20_monitor.R "$DEP" "$BASE" "$HW/monitor.csv"

# 3. the S16, S17 and S18 audits on fresh paths
Rscript ../R/s20_paths.R "$HW/paths" 2026103142 2026103141 2026103144 2026103143 2026103145 || exit 1
bash scripts/s20-audits.sh "$H/paths" "$H/audits" "$BASE"

# 4. the live path: the refusals, then one analysis on a face drawn by seed
FACE=$(Rscript -e 'set.seed(2026103148); cat(sprintf("D:/devpost_lane/youcam/work/faces2/g%02d.jpg", sample(12, 1)))')
b0=$(bal)
YOUCAM_KEY_PROBE="$(key)" node scripts/s20-live.mjs once "$H/live_once.json" "$FACE" "$BASE" wrinkle,texture,redness,moisture || echo "live runner exited with $?"
b1=$(bal)
printf '{"before": %s, "after": %s, "face": "%s"}\n' "$b0" "$b1" "$FACE" > "$H/live_balances.json"
echo "live path: balance $b0 -> $b1 ($FACE)"

# 5. the policy on claim bank v2
node scripts/s19-sites.mjs "$H/sites.json" || exit 1
Rscript ../R/s19_mutants.R "$H/sites.json" "$S/bank.json" . "$H/mutants.json" 2026103146 100 claims || exit 1
Rscript ../R/s19_mutants.R "$H/sites.json" "$S/bank.json" . "$H/nearmiss.json" 2026103147 100 near || exit 1
npx tsx scripts/s19-mutants.ts "$H/mutants.json" "$H/mutants_result.json"
npx tsx scripts/s19-mutants.ts "$H/nearmiss.json" "$H/nearmiss_result.json"
npx tsx tools/claim-lint/cli.ts --json > "$H/pristine.json"

# 6. the monitor once more, then the scorer
Rscript ../R/s20_monitor.R "$DEP" "$BASE" "$HW/monitor.csv"
Rscript ../R/s20_score.R "$HW"
