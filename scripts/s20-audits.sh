#!/usr/bin/env bash
# S20: the S16, S17 and S18 audits against a deployed site (prereg in R/s20_score.R), each scored by its own step's
# scorer, unchanged. Every YouCam call the pages make is answered by the runners, so the audits spend 0 units; the
# balance is read before and after each one (balances.json, as the S16-S18 held-out runs wrote it).
# Usage (from the app folder): bash scripts/s20-audits.sh <pathsDir> <outDir> <base>
#   <pathsDir> holds paths_s16.json, paths_s17.json and s18/ (R/s20_paths.R)
set -uo pipefail
P=$(cd "$1" && pwd -W)
mkdir -p "$2"
O=$(cd "$2" && pwd -W)
BASE="$3"
bal() { Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
audit() { # <name> <script> <paths> <out>
  local b0 b1
  b0=$(bal)
  echo "$1: balance before $b0; start $(date +%H:%M:%S)"
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$2" "$3" "$4" "$BASE" > "$4.log" 2>&1 || echo "$1 runner exited with $?"
  b1=$(bal)
  echo "$1: balance after $b1; end $(date +%H:%M:%S)"
  mkdir -p "$4"
  printf '{"before": %s, "after": %s}\n' "$b0" "$b1" > "$4/balances.json"
}
audit S16 scripts/s16-audit.mjs "$P/paths_s16.json" "$O/s16"
Rscript ../R/s16_score.R "$O/s16" "$P/paths_s16.json" > "$O/s16_score.log" 2>&1
audit S17 scripts/s17-audit.mjs "$P/paths_s17.json" "$O/s17"
Rscript ../R/s17_score.R "$O/s17" "$P/paths_s17.json" > "$O/s17_score.log" 2>&1
audit S18 scripts/s18-audit.mjs "$P/s18/paths_heldout.json" "$O/s18"
Rscript ../R/s18_score.R "$O/s18" "$P/s18/expected_heldout.json" "$O/s17" > "$O/s18_score.log" 2>&1
for s in s16 s17 s18; do echo "$s all bars met: $(node -e "try { console.log(require('$O/$s/bars.json').all_met) } catch { console.log('no bars.json') }")"; done
