#!/usr/bin/env bash
# S15 held-out run (once): 10 guided capture sessions on new faces, then one drawn photo through the live API. Prereg and
# bars are in R/s15_score.R. Refuses to run twice, or with code that differs from the freeze (work/s15/FREEZE_md5.txt).
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s15
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S15 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s15/FREEZE_md5.txt) || { echo "code differs from the S15 freeze" >&2; exit 1; }
live=$(Rscript ../R/s15_draw.R)
echo "live draw: $live"
bal() { sleep 5; Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }

# a fresh server: a dev server that has seen code edits can serve a stale page shell that reloads in a loop
bash scripts/stop-dev.sh
bash scripts/dev-with-key.sh 350 6 ../work/devserver.log
before=$(bal)
echo "balance before: $before"
touch "$S/HELD_OUT_SPENT"
mkdir -p "$S/heldout"
node scripts/s15-capture.mjs "$S/sessions_heldout.json" "$S/heldout" "live=$live" || echo "runner exited with $?"
after=$(bal)
echo "balance after: $after"
printf '{"before": %s, "after": %s}\n' "$before" "$after" > "$S/heldout/balances.json"
Rscript ../R/s15_score.R D:/devpost_lane/youcam/work/s15/heldout D:/devpost_lane/youcam/work/s15/sessions_heldout.json ledger
