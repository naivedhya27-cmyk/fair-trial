#!/usr/bin/env bash
# S21b: the S16, S17 and S18 audits against a deployed site (prereg in R/s21b_score.R), runners and scorers unchanged,
# each with the network probe beside it (scripts/s21b-probe.mjs). An S16 or S17 path that crashed is run again, alone,
# when its crash record shows a request to the site outside /api/ in flight for 10 s or more (R/s21b_merge.R pick), up
# to 5 passes in all; the merged record (R/s21b_merge.R merge) is what the step's scorer reads. A crash without that
# evidence stands, and so does a path that still crashes in its fifth pass. S18's B7 reads the merged S17.
# Every YouCam call the pages make is answered by the runners, so the audits spend 0 units.
# Usage (from the app folder): bash scripts/s21b-audits.sh <pathsDir> <outDir> <base>
#   <pathsDir> holds paths_s16.json, paths_s17.json and s18/ (R/s20_paths.R)
set -uo pipefail
P=$(cd "$1" && pwd -W)
mkdir -p "$2"
O=$(cd "$2" && pwd -W)
BASE="$3"
bal() { Rscript -e 'source("D:/devpost_lane/youcam/R/yc_lib.R"); cat(yc_credit()$total)'; }
audit() { # <name> <script> <paths> <out> [only]: one runner pass with the probe beside it
  local b0 b1
  mkdir -p "$4"
  b0=$(bal)
  rm -f "$4.stop"
  node scripts/s21b-probe.mjs "$4.probe.csv" "$4.stop" "$BASE" &
  local probe=$!
  echo "$1: balance before $b0; start $(date +%H:%M:%S)${5:+ (paths $5)}"
  case "$1" in
    S16*) S16_ONLY="${5:-}" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$2" "$3" "$4" "$BASE" > "$4.log" 2>&1 || echo "$1 runner exited with $?" ;;
    S17*) S17_ONLY="${5:-}" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$2" "$3" "$4" "$BASE" > "$4.log" 2>&1 || echo "$1 runner exited with $?" ;;
    *) node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$2" "$3" "$4" "$BASE" > "$4.log" 2>&1 || echo "$1 runner exited with $?" ;;
  esac
  touch "$4.stop"
  wait "$probe"
  b1=$(bal)
  echo "$1: balance after $b1; end $(date +%H:%M:%S)"
  printf '{"before": %s, "after": %s}\n' "$b0" "$b1" > "$4/balances.json"
}
with_reruns() { # <name> <script> <paths> <out>: the first pass, then the stalled paths again, up to 5 passes in all;
  # the record after the last pass is <out>/merged
  audit "$1" "$2" "$3" "$4/first"
  local cur="$4/first" ids n=0
  while ids=$(Rscript ../R/s21b_merge.R pick "$cur" "$BASE") && [ -n "$ids" ]; do
    if [ "$n" -ge 4 ]; then
      echo "$1: $ids crashed with the link stalled in all 5 passes; those crashes stand"
      break
    fi
    n=$((n + 1))
    echo "$1: pass $((n + 1)) for $ids (crash records show the link stalled)"
    audit "$1 rerun $n" "$2" "$3" "$4/rerun$n" "$ids"
    Rscript ../R/s21b_merge.R merge "$cur" "$4/rerun$n" "$4/merged$n"
    cur="$4/merged$n"
  done
  [ "$n" -eq 0 ] && echo "$1: no path to rerun"
  rm -rf "$4/merged"
  cp -r "$cur" "$4/merged"
}
with_reruns S16 scripts/s16-audit.mjs "$P/paths_s16.json" "$O/s16"
Rscript ../R/s16_score.R "$O/s16/merged" "$P/paths_s16.json" > "$O/s16_score.log" 2>&1
with_reruns S17 scripts/s17-audit.mjs "$P/paths_s17.json" "$O/s17"
Rscript ../R/s17_score.R "$O/s17/merged" "$P/paths_s17.json" > "$O/s17_score.log" 2>&1
audit S18 scripts/s18-audit.mjs "$P/s18/paths_heldout.json" "$O/s18"
Rscript ../R/s18_score.R "$O/s18" "$P/s18/expected_heldout.json" "$O/s17/merged" > "$O/s18_score.log" 2>&1
for s in s16/merged s17/merged s18; do echo "$s all bars met: $(node -e "try { console.log(require('$O/$s/bars.json').all_met) } catch { console.log('no bars.json') }")"; done
