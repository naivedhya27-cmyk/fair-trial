#!/usr/bin/env bash
# Start the dev server on port 3123 with the YouCam key from Windows Credential Manager. R only reads the key; it passes
# through a pipe into the server's environment and is never printed, logged, written to a file, put in a URL or on a
# command line. Every start uses an empty build cache: after code edits the dev server's cache can hold a stale page
# shell that makes the page reload in a loop (S15).
# Usage: bash scripts/dev-with-key.sh [unit_floor=350] [daily_limit=6] [log=../work/devserver.log]
# With SERVER_TMP set, the server's temp folder (TMP, TEMP, TMPDIR) is that folder.
set -euo pipefail
cd "$(dirname "$0")/.."
floor="${1:-350}"
limit="${2:-6}"
log="${3:-../work/devserver.log}"
[[ "$floor" =~ ^[0-9]+$ && "$limit" =~ ^[0-9]+$ ]] || { echo "floor and limit must be whole numbers" >&2; exit 2; }
if curl -s -o /dev/null --max-time 3 http://localhost:3123/; then
  echo "a server is already on 3123; stop it first (bash scripts/stop-dev.sh)" >&2
  exit 1
fi
rm -rf .next
tmp="${SERVER_TMP:-${TMP:-}}"
key="$(Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("youcam"))')"
[ -n "$key" ] || { echo "no YouCam key in Windows Credential Manager" >&2; exit 1; }
(YOUCAM_API_KEY="$key" YOUCAM_UNIT_FLOOR="$floor" YOUCAM_DAILY_LIMIT="$limit" TMP="$tmp" TEMP="$tmp" TMPDIR="$tmp" \
  npx next dev -p 3123 > "$log" 2>&1 &)
unset key
c=000
for _ in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://localhost:3123/api/status || true)
  [ "$c" = "200" ] && break
  sleep 1
done
echo "server on 3123: floor $floor, daily limit $limit, status http $c $(curl -s --max-time 30 http://localhost:3123/api/status || true)"
