#!/usr/bin/env bash
set -euo pipefail

SPEC_PACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SPEC_PACK_ROOT/.env"
SERVICE_NAME="db-arch-web"
HOST_VALUE="0.0.0.0"
PORT_VALUE="4318"
PI_BIN_VALUE="${PI_BIN:-}"
PI_DEFAULT_MODEL_VALUE="${PI_DEFAULT_MODEL:-aicodemirror/gpt-5.5}"
PI_DEFAULT_THINKING_VALUE="${PI_DEFAULT_THINKING:-}"
LIVE_PROBE_VALUE="${LIVE_PROBE:-false}"
RUN_USER="${SUDO_USER:-${USER:-$(id -un)}}"
INSTALL_SYSTEMD=1
START_SERVICE=1
FORCE_ENV=0
RUN_SMOKE=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Installs the DB Archaeologist web service for a Linux server.
Run this from db-archaeologist-pi-spec-pack after cloning/copying the repo.

Options:
  --host HOST              Listen host. Default: 0.0.0.0
  --port PORT              HTTP port. Default: 4318
  --pi-bin PATH            pi executable path. Default: PATH lookup
  --model MODEL            Default pi model. Default: aicodemirror/gpt-5.5
  --thinking LEVEL         Optional pi thinking level: off|minimal|low|medium|high
  --live-probe true|false  Enable live API probes. Default: false
  --user USER              systemd service user. Default: current sudo/user
  --service-name NAME      systemd service name. Default: db-arch-web
  --no-systemd             Only create .env and print manual start command
  --no-start               Install systemd unit but do not start/restart it
  --no-smoke               Skip node web/_smoke.mjs check
  --force-env              Rewrite .env after backing up the existing file
  -h, --help               Show this help

Required after install:
  Edit .env and fill secrets such as AICODEMIRROR_API_KEY and ZICHEN_* values.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST_VALUE="${2:?--host requires a value}"
      shift 2
      ;;
    --port)
      PORT_VALUE="${2:?--port requires a value}"
      shift 2
      ;;
    --pi-bin)
      PI_BIN_VALUE="${2:?--pi-bin requires a path}"
      shift 2
      ;;
    --model)
      PI_DEFAULT_MODEL_VALUE="${2:?--model requires a value}"
      shift 2
      ;;
    --thinking)
      PI_DEFAULT_THINKING_VALUE="${2:?--thinking requires a value}"
      shift 2
      ;;
    --live-probe)
      LIVE_PROBE_VALUE="${2:?--live-probe requires true or false}"
      shift 2
      ;;
    --user)
      RUN_USER="${2:?--user requires a value}"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="${2:?--service-name requires a value}"
      shift 2
      ;;
    --no-systemd)
      INSTALL_SYSTEMD=0
      shift
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    --no-smoke)
      RUN_SMOKE=0
      shift
      ;;
    --force-env)
      FORCE_ENV=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$PORT_VALUE" =~ ^[0-9]+$ ]] || (( PORT_VALUE < 1 || PORT_VALUE > 65535 )); then
  echo "--port must be an integer in 1..65535" >&2
  exit 2
fi

case "$LIVE_PROBE_VALUE" in
  true|false) ;;
  *)
    echo "--live-probe must be true or false" >&2
    exit 2
    ;;
esac

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Need root privileges for: $*" >&2
    echo "Install sudo or rerun as root, or use --no-systemd." >&2
    exit 1
  fi
  sudo "$@"
}

resolve_pi_bin() {
  if [[ -n "$PI_BIN_VALUE" ]]; then
    echo "$PI_BIN_VALUE"
    return
  fi
  if command -v pi >/dev/null 2>&1; then
    command -v pi
    return
  fi
  echo "pi"
}

check_node() {
  require_cmd node
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major > 22 || (major === 22 && minor >= 6)) process.exit(0);
    console.error(`Node >= 22.6 required, got ${process.versions.node}`);
    process.exit(1);
  '
}

write_env_file() {
  local pi_bin="$1"
  local coding_dir="$SPEC_PACK_ROOT/.pi-home/agent"
  mkdir -p "$coding_dir"

  if [[ -f "$ENV_FILE" && "$FORCE_ENV" -eq 1 ]]; then
    local backup="$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
    cp "$ENV_FILE" "$backup"
    echo "Backed up existing .env -> $backup"
    rm -f "$ENV_FILE"
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<EOF
# DB Archaeologist Web deployment environment
HOST=$HOST_VALUE
PORT=$PORT_VALUE
SPEC_PACK_ROOT=$SPEC_PACK_ROOT

# pi runtime
PI_BIN=$pi_bin
PI_CODING_AGENT_DIR=$coding_dir
PI_DEFAULT_MODEL=$PI_DEFAULT_MODEL_VALUE
PI_DEFAULT_THINKING=$PI_DEFAULT_THINKING_VALUE

# Live data probe gate. Keep false unless ZICHEN_* credentials are configured.
LIVE_PROBE=$LIVE_PROBE_VALUE

# Model/API credentials. Fill these on the server; never commit real secrets.
AICODEMIRROR_API_KEY=
ZICHEN_BASE_URL=
ZICHEN_HOST=
ZICHEN_TENANT_ID=
ZICHEN_USER_ID=
ZICHEN_APP_CODE_KEY=
ZICHEN_APP_CODE=
EOF
    chmod 600 "$ENV_FILE"
    echo "Created $ENV_FILE"
    return
  fi

  ensure_env_key HOST "$HOST_VALUE"
  ensure_env_key PORT "$PORT_VALUE"
  ensure_env_key SPEC_PACK_ROOT "$SPEC_PACK_ROOT"
  ensure_env_key PI_BIN "$pi_bin"
  ensure_env_key PI_CODING_AGENT_DIR "$coding_dir"
  ensure_env_key PI_DEFAULT_MODEL "$PI_DEFAULT_MODEL_VALUE"
  ensure_env_key PI_DEFAULT_THINKING "$PI_DEFAULT_THINKING_VALUE"
  ensure_env_key LIVE_PROBE "$LIVE_PROBE_VALUE"
  ensure_env_key AICODEMIRROR_API_KEY ""
  ensure_env_key ZICHEN_BASE_URL ""
  ensure_env_key ZICHEN_HOST ""
  ensure_env_key ZICHEN_TENANT_ID ""
  ensure_env_key ZICHEN_USER_ID ""
  ensure_env_key ZICHEN_APP_CODE_KEY ""
  ensure_env_key ZICHEN_APP_CODE ""
  chmod 600 "$ENV_FILE"
  echo "Updated missing keys in existing $ENV_FILE"
}

ensure_env_key() {
  local key="$1"
  local value="$2"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

install_systemd_service() {
  require_cmd systemctl
  local node_bin
  node_bin="$(command -v node)"
  local service_tmp
  service_tmp="$(mktemp)"
  cat > "$service_tmp" <<EOF
[Unit]
Description=DB Archaeologist Web GUI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$SPEC_PACK_ROOT
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$node_bin web/server.mjs
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

  as_root install -m 0644 "$service_tmp" "/etc/systemd/system/$SERVICE_NAME.service"
  rm -f "$service_tmp"
  as_root systemctl daemon-reload
  as_root systemctl enable "$SERVICE_NAME.service"
  if [[ "$START_SERVICE" -eq 1 ]]; then
    as_root systemctl restart "$SERVICE_NAME.service"
  fi
}

check_node

PI_BIN_RESOLVED="$(resolve_pi_bin)"
if [[ "$PI_BIN_RESOLVED" != "pi" && ! -x "$PI_BIN_RESOLVED" ]]; then
  echo "PI_BIN is not executable: $PI_BIN_RESOLVED" >&2
  exit 1
fi
if [[ "$PI_BIN_RESOLVED" == "pi" ]] && ! command -v pi >/dev/null 2>&1; then
  echo "Warning: pi was not found in PATH. Install pi or edit PI_BIN in $ENV_FILE before starting." >&2
fi

write_env_file "$PI_BIN_RESOLVED"

if [[ "$RUN_SMOKE" -eq 1 ]]; then
  echo "Running web smoke checks..."
  (cd "$SPEC_PACK_ROOT" && node web/_smoke.mjs)
fi

if [[ "$INSTALL_SYSTEMD" -eq 1 ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    install_systemd_service
  else
    echo "systemctl not found; skipping systemd service install."
    INSTALL_SYSTEMD=0
  fi
fi

cat <<EOF

Install complete.

Config:
  $ENV_FILE

Start URL:
  http://<server-ip>:$PORT_VALUE/

Next steps:
  1. Edit $ENV_FILE and fill AICODEMIRROR_API_KEY and any ZICHEN_* credentials.
EOF

if [[ "$INSTALL_SYSTEMD" -eq 1 ]]; then
  cat <<EOF
  2. Restart after env changes:
     sudo systemctl restart $SERVICE_NAME

Useful commands:
  sudo systemctl status $SERVICE_NAME --no-pager
  sudo journalctl -u $SERVICE_NAME -f
EOF
else
  cat <<EOF
  2. Start manually:

Manual start without systemd:
  cd "$SPEC_PACK_ROOT"
  set -a
  . ./.env
  set +a
  node web/server.mjs
EOF
fi
