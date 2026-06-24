#!/usr/bin/env bash
set -euo pipefail

DEFAULT_HERMES_ROOT="/Users/yichen/Desktop/OntologyBrain/PersonAgent/hermes-agent"
SPEC_PACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PI_AGENT_ROOT="$(cd "$SPEC_PACK_ROOT/.." && pwd)"

HERMES_ROOT="$DEFAULT_HERMES_ROOT"
PI_AGENT_ROOT="$DEFAULT_PI_AGENT_ROOT"
OPENKB_ROOT=""
MODE="source-only"
FORCE=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage: install_business_strategy_workspace_adapter.sh [options]

Options:
  --hermes-root PATH     Source hermes-agent checkout.
  --pi-agent-root PATH   Target PI_AGENT root.
  --openkb-root PATH     OpenKB checkout root. Defaults to PI_AGENT/third_party/OpenKB.
  --mode MODE            source-only or cli-ingest. Default: source-only.
  PYTHON=PATH            Optional Python executable override.
  --force                Overwrite existing adapter/input directories.
  --skip-build           Only copy files; do not build/export scenario_workspace.
  -h, --help             Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hermes-root)
      HERMES_ROOT="${2:?--hermes-root requires a path}"
      shift 2
      ;;
    --pi-agent-root)
      PI_AGENT_ROOT="${2:?--pi-agent-root requires a path}"
      shift 2
      ;;
    --openkb-root)
      OPENKB_ROOT="${2:?--openkb-root requires a path}"
      shift 2
      ;;
    --mode)
      MODE="${2:?--mode requires source-only or cli-ingest}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
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

if [[ "$MODE" != "source-only" && "$MODE" != "cli-ingest" ]]; then
  echo "--mode must be source-only or cli-ingest" >&2
  exit 2
fi

HERMES_ROOT="$(cd "$HERMES_ROOT" && pwd)"
PI_AGENT_ROOT="$(mkdir -p "$PI_AGENT_ROOT" && cd "$PI_AGENT_ROOT" && pwd)"
OPENKB_ROOT="${OPENKB_ROOT:-$PI_AGENT_ROOT/third_party/OpenKB}"

SOURCE_ADAPTER="$HERMES_ROOT/local-skills/business-strategy-workspace-adapter"
SOURCE_SCENARIOS="$HERMES_ROOT/strategy-scenarios"
SOURCE_BIZ_SPEC="$HERMES_ROOT/docs/biz_spec"
TARGET_ADAPTER="$PI_AGENT_ROOT/business-strategy-workspace-adapter"
TARGET_SCENARIOS="$PI_AGENT_ROOT/strategy-scenarios"
TARGET_BIZ_SPEC="$PI_AGENT_ROOT/docs/biz_spec"
TARGET_SPEC_PACK="$PI_AGENT_ROOT/db-archaeologist-pi-spec-pack"
WORKSPACE_PACKAGES="$PI_AGENT_ROOT/.strategy-workspace/workspace-packages"
SCENARIO_WORKSPACE="$TARGET_SPEC_PACK/registry/derived/scenario_workspace"

require_path() {
  local label="$1"
  local path="$2"
  if [[ ! -e "$path" ]]; then
    echo "Missing $label: $path" >&2
    exit 1
  fi
}

require_path "Hermes adapter source" "$SOURCE_ADAPTER"
require_path "Hermes strategy-scenarios source" "$SOURCE_SCENARIOS"
require_path "Hermes marketing insight docs" "$SOURCE_BIZ_SPEC/marketing_insight"
require_path "Hermes meta strategy schema" "$SOURCE_BIZ_SPEC/元策略规范.md"
require_path "PI spec-pack" "$TARGET_SPEC_PACK"

resolve_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    echo "$PYTHON"
    return
  fi
  if [[ -x "$HERMES_ROOT/.venv/bin/python" ]]; then
    echo "$HERMES_ROOT/.venv/bin/python"
    return
  fi
  if [[ -x "$HERMES_ROOT/venv/bin/python" ]]; then
    echo "$HERMES_ROOT/venv/bin/python"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi
  command -v python || true
}

copy_dir() {
  local src="$1"
  local dst="$2"
  if [[ -e "$dst" ]]; then
    if [[ "$FORCE" -ne 1 ]]; then
      echo "Refusing to overwrite existing path: $dst" >&2
      echo "Rerun with --force to replace it." >&2
      exit 1
    fi
    rm -rf "$dst"
  fi
  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
  echo "Installed $src -> $dst"
}

copy_dir "$SOURCE_ADAPTER" "$TARGET_ADAPTER"
copy_dir "$SOURCE_SCENARIOS" "$TARGET_SCENARIOS"
copy_dir "$SOURCE_BIZ_SPEC/marketing_insight" "$TARGET_BIZ_SPEC/marketing_insight"
mkdir -p "$TARGET_BIZ_SPEC"
if [[ -e "$TARGET_BIZ_SPEC/元策略规范.md" && "$FORCE" -ne 1 ]]; then
  echo "Refusing to overwrite existing path: $TARGET_BIZ_SPEC/元策略规范.md" >&2
  echo "Rerun with --force to replace it." >&2
  exit 1
fi
cp "$SOURCE_BIZ_SPEC/元策略规范.md" "$TARGET_BIZ_SPEC/元策略规范.md"
echo "Installed $SOURCE_BIZ_SPEC/元策略规范.md -> $TARGET_BIZ_SPEC/元策略规范.md"

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  echo "Skipped build/export. Installed files only."
  exit 0
fi

require_path "OpenKB root" "$OPENKB_ROOT"

PYTHON_BIN="$(resolve_python)"
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
  echo "Python executable not found: $PYTHON_BIN" >&2
  echo "Set PYTHON=/path/to/python and rerun." >&2
  exit 1
fi

cd "$PI_AGENT_ROOT"

"$PYTHON_BIN" "$TARGET_ADAPTER/scripts/workspace_adapter.py" validate \
  --scenario-index "$TARGET_SCENARIOS/scenario_directory_index.yaml"

"$PYTHON_BIN" "$TARGET_ADAPTER/scripts/workspace_adapter.py" build \
  --scenario-index "$TARGET_SCENARIOS/scenario_directory_index.yaml" \
  --openkb-root "$OPENKB_ROOT" \
  --openkb-mode "$MODE" \
  --output "$WORKSPACE_PACKAGES"

"$PYTHON_BIN" "$TARGET_ADAPTER/scripts/workspace_adapter.py" export-pi \
  --workspace-packages "$WORKSPACE_PACKAGES" \
  --output "$SCENARIO_WORKSPACE"

echo "Ready. PI-Agent scenario workspace:"
echo "  $SCENARIO_WORKSPACE"
