#!/usr/bin/env bash
# S19 clean room, Linux (prereg in R/s19_score.R), run inside WSL Ubuntu:
#   wsl -d Ubuntu -- bash /mnt/d/devpost_lane/youcam/fairtrial/scripts/s19-cleanroom-linux.sh <files.txt> <outDir>
# Copies the listed repository files (git ls-files, made on the Windows side) into a fresh folder under /tmp, puts the
# official Node 22 build beside it, runs `npm ci` and `npm run ci`, then the end-to-end smoke. System libraries the browser
# needs and WSL lacks are fetched from Ubuntu's archive without root and loaded from the room. Writes logs and exit codes
# to <outDir> (a /mnt path).
set -u
LIST="$1"
OUT="$2"
APP_SRC=/mnt/d/devpost_lane/youcam/fairtrial
ROOM=/tmp/ftci-$$
NODE_V=v22.23.2
NODE_DIR=/tmp/ftci-node-$NODE_V
mkdir -p "$OUT" "$ROOM/app"
log() { echo "$*" | tee -a "$OUT/linux_steps.log"; }

if [ ! -x "$NODE_DIR/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-x64.tar.xz" -o /tmp/node-$NODE_V.tar.xz || { log "node download failed"; exit 2; }
  mkdir -p "$NODE_DIR" && tar -xJf /tmp/node-$NODE_V.tar.xz -C "$NODE_DIR" --strip-components=1 && rm /tmp/node-$NODE_V.tar.xz
fi
export PATH="$NODE_DIR/bin:$PATH"
log "node $(node --version), npm $(npm --version), $(uname -sr)"

# the repository files only: tracked and untracked, ignored files left out (list made by git on the Windows side)
tr -d '\r' < "$LIST" > "$ROOM/files.txt"
(cd "$APP_SRC" && tar -cf - -T "$ROOM/files.txt") | (cd "$ROOM/app" && tar -xf -)
log "copied $(wc -l < "$ROOM/files.txt") files; node_modules present: $([ -e "$ROOM/app/node_modules" ] && echo yes || echo no); .next present: $([ -e "$ROOM/app/.next" ] && echo yes || echo no); mediapipe present: $([ -e "$ROOM/app/public/mediapipe" ] && echo yes || echo no)"

cd "$ROOM/app"
npm ci > "$OUT/linux_npm_ci.log" 2>&1
echo $? > "$OUT/linux_npm_ci.exit"
log "npm ci exit $(cat "$OUT/linux_npm_ci.exit")"
npm run ci > "$OUT/linux_ci.log" 2>&1
echo $? > "$OUT/linux_ci.exit"
log "npm run ci exit $(cat "$OUT/linux_ci.exit")"

# the smoke needs the browser and its system libraries
npx playwright install chromium > "$OUT/linux_pw_install.log" 2>&1
SHELL_BIN=$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-*/chrome-headless-shell 2>/dev/null | tail -1)
if [ -z "$SHELL_BIN" ]; then
  echo skipped_no_browser > "$OUT/linux_e2e.exit"
  log "e2e not run: the browser did not install (see linux_pw_install.log)"
else
  MISSING=$(ldd "$SHELL_BIN" | grep -c "not found" || true)
  log "browser libraries missing: $MISSING"
  if [ "$MISSING" != "0" ]; then
    # CI installs them as root (playwright install --with-deps); without root, fetch the Ubuntu packages that hold them
    # with private package lists, unpack them inside the room and point the loader at them; nothing goes on the system
    ldd "$SHELL_BIN" | grep "not found" > "$OUT/linux_e2e_missing_libs.txt"
    PKGS=$(awk '{print $1}' "$OUT/linux_e2e_missing_libs.txt" | sed -E 's/^libnspr4\.so$/libnspr4/; s/^libnss(3|util3)\.so$|^libsmime3\.so$/libnss3/; s/^libasound\.so\.2$/libasound2t64/' | sort -u | tr '\n' ' ')
    A="$ROOM/libs"
    mkdir -p "$A/lists/partial" "$A/cache/archives/partial" "$A/debs" "$A/root"
    O=(-o "Dir::State::Lists=$A/lists" -o "Dir::Cache=$A/cache" -o "Debug::NoLocking=1")
    apt-get "${O[@]}" update > "$OUT/linux_libs_fetch.log" 2>&1
    (cd "$A/debs" && apt-get "${O[@]}" download $PKGS) >> "$OUT/linux_libs_fetch.log" 2>&1
    for d in "$A"/debs/*.deb; do [ -f "$d" ] && dpkg -x "$d" "$A/root"; done
    ls "$A/debs" >> "$OUT/linux_libs_fetch.log"
    export LD_LIBRARY_PATH="$A/root/usr/lib/x86_64-linux-gnu"
    MISSING=$(ldd "$SHELL_BIN" | grep -c "not found" || true)
    log "fetched without root: $PKGS; browser libraries still missing: $MISSING"
  fi
  if [ "$MISSING" = "0" ]; then
    npm run e2e > "$OUT/linux_e2e.log" 2>&1
    echo $? > "$OUT/linux_e2e.exit"
    log "npm run e2e exit $(cat "$OUT/linux_e2e.exit")"
  else
    echo skipped > "$OUT/linux_e2e.exit"
    log "e2e skipped: the browser's libraries are missing (see linux_e2e_missing_libs.txt)"
  fi
fi
cd /tmp && rm -rf "$ROOM"
log "done"
