#!/usr/bin/env bash
# S14 held-out run (once): the live end-to-end test of the server proxy against the YouCam API. Prereg and bars are in
# R/s14_score.R. Refuses to run twice, or with code that differs from the freeze (work/s14/FREEZE_md5.txt).
# The key is read by R and passed through a pipe into environments only (dev-with-key.sh; the runner's in-memory scan).
set -uo pipefail
cd "$(dirname "$0")/.."
S=../work/s14
[ -e "$S/HELD_OUT_SPENT" ] && { echo "the S14 held-out run is already spent" >&2; exit 1; }
(cd .. && md5sum -c --quiet work/s14/FREEZE_md5.txt) || { echo "code differs from the S14 freeze" >&2; exit 1; }

read -r face concerns < <(Rscript ../R/s14_draw.R)
echo "draw: $face $concerns"
bal() { sleep 5; Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
key() { Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("youcam"))'; }
mkdir -p "$S/server_tmp"
export SERVER_TMP
SERVER_TMP="$(cd "$S/server_tmp" && pwd -W)"

b0=$(bal)
echo "balance before: $b0"
touch "$S/run_start.marker" "$S/HELD_OUT_SPENT"

bash scripts/stop-dev.sh
bash scripts/dev-with-key.sh 350 1 "$S/server_live.log"
YOUCAM_KEY_PROBE="$(key)" node scripts/s14-e2e.mjs live "$S/live.json" "$face" "$concerns" || echo "live runner exited with $?"
b1=$(bal)
echo "balance after server A: $b1"

bash scripts/stop-dev.sh
bash scripts/dev-with-key.sh 1000000 6 "$S/server_low.log"
YOUCAM_KEY_PROBE="$(key)" node scripts/s14-e2e.mjs low "$S/low.json" "$face" "$concerns" || echo "low runner exited with $?"
b2=$(bal)
echo "balance after server B: $b2"
bash scripts/stop-dev.sh

printf '{"b0": %s, "b1": %s, "b2": %s}\n' "$b0" "$b1" "$b2" > "$S/balances.json"
Rscript ../R/s14_score.R
unset SERVER_TMP
bash scripts/dev-with-key.sh 350 6 ../work/devserver.log
