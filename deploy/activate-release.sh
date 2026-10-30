#!/usr/bin/env bash
set -euo pipefail
APP_DIR=${1:?APP_DIR}
IMAGE=${2:?IMAGE}
RELEASE_DIR=${3:?RELEASE_DIR}
[[ "$APP_DIR" =~ ^/[A-Za-z0-9_./-]+$ && "$APP_DIR" != / && "$APP_DIR" != *..* ]] || exit 2
[[ "$RELEASE_DIR" == "$APP_DIR"/releases/* && "$RELEASE_DIR" != *..* ]] || exit 2
[[ "$IMAGE" =~ ^ghcr.io/[a-z0-9_./-]+:[a-f0-9]{40}$ ]] || exit 2
test -s "$APP_DIR/.env.production"
test -s "$RELEASE_DIR/compose.yml"
chmod 600 "$APP_DIR/.env.production"
export CONFIG_FILE="$APP_DIR/.env.production" APP_IMAGE="$IMAGE"
previous_dir=$(cat "$APP_DIR/current-release" 2>/dev/null || true)
previous_image=$(cat "$APP_DIR/current-image" 2>/dev/null || true)
compose=(docker compose --env-file "$CONFIG_FILE" -p salescope -f "$RELEASE_DIR/compose.yml")
healthy=false
if "${compose[@]}" up -d --wait --wait-timeout 120; then
  if "${compose[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then healthy=true; fi
fi
if [[ "$healthy" != true ]]; then
  if [[ -n "$previous_dir" && -n "$previous_image" ]]; then
    APP_IMAGE="$previous_image" docker compose --env-file "$CONFIG_FILE" -p salescope -f "$previous_dir/compose.yml" up -d --wait --wait-timeout 120
  fi
  echo '新版本健康检查失败，已有版本已尝试恢复。' >&2
  exit 1
fi
if [[ -n "$previous_dir" && "$previous_dir" != "$RELEASE_DIR" ]]; then
  printf '%s\n' "$previous_dir" > "$APP_DIR/previous-release"
  printf '%s\n' "$previous_image" > "$APP_DIR/previous-image"
fi
printf '%s\n' "$RELEASE_DIR" > "$APP_DIR/current-release"
printf '%s\n' "$IMAGE" > "$APP_DIR/current-image"
echo "已激活镜像 $IMAGE；客户数据保持在独立持久卷。"
