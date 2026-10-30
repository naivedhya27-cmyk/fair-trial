#!/usr/bin/env bash
# Build and start the production server on port 3123 (the build judges get), with the YouCam key from Windows Credential
# Manager passed as in dev-with-key.sh: R reads it and it goes into the server's environment by command substitution,
# never printed, logged, written to a file, put in a URL or on a command line. Every start builds from an empty cache.
# Usage: bash scripts/prod-with-key.sh [unit_floor=350] [daily_limit=6] [log=../work/prodserver.log]
set -euo pipefail
cd "$(dirname "$0")/.."
floor="${1:-350}"
limit="${2:-6}"
log="${3:-../work/prodserver.log}"
[[ "$floor" =~ ^[0-9]+$ && "$limit" =~ ^[0-9]+$ ]] || { echo "floor and limit must be whole numbers" >&2; exit 2; }
if curl -s -o /dev/null --max-time 3 http://localhost:3123/; then
  echo "a server is already on 3123; stop it first (bash scripts/stop-server.sh)" >&2
  exit 1
fi
rm -rf .next
if ! npx next build > "${log%.log}_build.log" 2>&1; then
  echo "build failed; see ${log%.log}_build.log" >&2
  exit 1
fi
key="$(Rscript -e 'source("D:/devpost_lane/youcam/R/keys_lib.R"); cat(key_get("youcam"))')"
[ -n "$key" ] || { echo "no YouCam key in Windows Credential Manager" >&2; exit 1; }
(YOUCAM_API_KEY="$key" YOUCAM_UNIT_FLOOR="$floor" YOUCAM_DAILY_LIMIT="$limit" npx next start -p 3123 > "$log" 2>&1 &)
unset key
c=000
for _ in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://localhost:3123/api/status || true)
  [ "$c" = "200" ] && break
  sleep 1
done
echo "production server on 3123: floor $floor, daily limit $limit, status http $c $(curl -s --max-time 30 http://localhost:3123/api/status || true)"
