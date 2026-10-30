#!/usr/bin/env bash
# S16 held-out run (once): the 12 held-out judge's paths on a fresh production build, 0 units (live analysis locked by
# a unit floor of 1000; the runner answers every YouCam call). Prereg and bars are in R/s16_score.R. Refuses to run
# twice, or with code that differs from the freeze (work/s16/FREEZE_md5.txt).
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s16
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S16 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s16/FREEZE_md5.txt) || { echo "code differs from the S16 freeze" >&2; exit 1; }
bal() { Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }

bash scripts/stop-server.sh
bash scripts/prod-with-key.sh 1000 6 ../work/prodserver.log || exit 1
before=$(bal)
echo "balance before: $before"
touch "$S/HELD_OUT_SPENT"
mkdir -p "$S/heldout"
node scripts/s16-audit.mjs "$S/paths_heldout.json" "$S/heldout" || echo "runner exited with $?"
after=$(bal)
echo "balance after: $after"
printf '{"before": %s, "after": %s}\n' "$before" "$after" > "$S/heldout/balances.json"
Rscript ../R/s16_score.R D:/devpost_lane/youcam/work/s16/heldout D:/devpost_lane/youcam/work/s16/paths_heldout.json
