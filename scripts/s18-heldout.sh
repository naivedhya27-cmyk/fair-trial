#!/usr/bin/env bash
# S18 held-out run (once): the demo trial audit on 6 held-out demo datasets (drawn now by R/s18_demo.R, seed 2026103019)
# and, for B7, the S17 audit's 14 development paths, both on a fresh production build, 0 units (live analysis locked by
# a unit floor of 1000; the demo makes no analysis call). Prereg and bars are in R/s18_score.R. Refuses to run twice, or
# with code that differs from the freeze (work/s18/FREEZE_md5.txt).
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s18
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S18 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s18/FREEZE_md5.txt) || { echo "code differs from the S18 freeze" >&2; exit 1; }
bal() { Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }

touch "$S/HELD_OUT_SPENT"
Rscript ../R/s18_demo.R heldout || exit 1
Rscript ../R/s18_paths.R heldout || exit 1
bash scripts/stop-server.sh
bash scripts/prod-with-key.sh 1000 6 ../work/prodserver.log || exit 1
before=$(bal)
echo "balance before: $before"
mkdir -p "$S/heldout/b7"
node scripts/s18-audit.mjs "$S/paths_heldout.json" "$S/heldout" || echo "runner exited with $?"
node scripts/s17-audit.mjs ../work/s17/paths_dev.json "$S/heldout/b7" || echo "S17 runner exited with $?"
after=$(bal)
echo "balance after: $after"
printf '{"before": %s, "after": %s}\n' "$before" "$after" > "$S/heldout/balances.json"
cp "$S/heldout/balances.json" "$S/heldout/b7/balances.json"
Rscript ../R/s17_score.R D:/devpost_lane/youcam/work/s18/heldout/b7 D:/devpost_lane/youcam/work/s17/paths_dev.json > "$S/heldout/b7/score.txt" 2>&1
tail -14 "$S/heldout/b7/score.txt"
Rscript ../R/s18_score.R D:/devpost_lane/youcam/work/s18/heldout D:/devpost_lane/youcam/work/s18/expected_heldout.json D:/devpost_lane/youcam/work/s18/heldout/b7
