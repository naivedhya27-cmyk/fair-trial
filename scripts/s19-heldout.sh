#!/usr/bin/env bash
# S19 held-out run (once; prereg and bars in R/s19_score.R): 300 bad-claim mutants (seed 2026103031) and 100 near-miss
# mutants (seed 2026103032) on the frozen app's user-text sites, the linter on the pristine tree, 1,000 engine cases
# (seed 2026103033) against the R twin, and the clean rooms on Windows and Linux. 0 YouCam units: nothing here
# analyses a photo. Refuses to run twice, or with code that differs from the freeze (work/s19/FREEZE_md5.txt).
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s19
H=$S/heldout
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S19 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s19/FREEZE_md5.txt) || { echo "code differs from the S19 freeze" >&2; exit 1; }
touch "$S/HELD_OUT_SPENT"
mkdir -p "$H"

node scripts/s19-sites.mjs "$H/sites.json" || exit 1
Rscript ../R/s19_mutants.R "$H/sites.json" "$S/bank.json" . "$H/mutants.json" 2026103031 300 claims || exit 1
Rscript ../R/s19_mutants.R "$H/sites.json" "$S/bank.json" . "$H/nearmiss.json" 2026103032 100 near || exit 1
npx tsx scripts/s19-mutants.ts "$H/mutants.json" "$H/mutants_result.json"
npx tsx scripts/s19-mutants.ts "$H/nearmiss.json" "$H/nearmiss_result.json"
npx tsx tools/claim-lint/cli.ts --json > "$H/pristine.json"
Rscript ../R/s19_engine.R 2026103033 1000 "$H/engine_cases.json" || exit 1
npx tsx scripts/s19-engine.ts "$H/engine_cases.json" "$H/engine_ts.json"
bash scripts/s19-cleanroom.sh "$H/cleanroom"
Rscript ../R/s19_score.R D:/devpost_lane/youcam/work/s19/heldout
