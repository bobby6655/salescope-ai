#!/usr/bin/env bash
set -euo pipefail
APP_DIR=${1:?Usage: rollback.sh /opt/salescope}
[[ "$APP_DIR" =~ ^/[A-Za-z0-9_./-]+$ && "$APP_DIR" != / && "$APP_DIR" != *..* ]] || exit 2
previous_dir=$(cat "$APP_DIR/previous-release")
previous_image=$(cat "$APP_DIR/previous-image")
bash "$previous_dir/activate-release.sh" "$APP_DIR" "$previous_image" "$previous_dir"
