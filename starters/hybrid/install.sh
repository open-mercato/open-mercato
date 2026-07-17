#!/usr/bin/env bash
# Open Mercato — hybrid dev environment installer for Linux/macOS.
#
# Hybrid = the app and the MCP server run natively on this machine (yarn dev),
# while OpenCode + postgres/redis/meilisearch run in containers.
#
# Standalone (no clone yet):
#   curl -fsSL https://raw.githubusercontent.com/open-mercato/open-mercato/main/starters/hybrid/install.sh | bash
# Inside a clone:
#   ./starters/hybrid/install.sh [--branch <name>] [--dir <path>] [--skip-db]
#                                [--skip-llm-prompt] [--non-interactive] [--no-start]
#
# This bootstrap only ensures git, Node 24, and corepack yarn, then hands off
# to `node starters/lib/install.mjs` (the shared, cross-platform pipeline).
# Docker itself is detected but never installed here — install Docker Desktop,
# Rancher Desktop, colima, or a native engine with the compose v2 plugin.
set -euo pipefail

REPO_URL="https://github.com/open-mercato/open-mercato.git"
NODE_MAJOR=24
BRANCH="main"
CLONE_DIR=""
FORWARD_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) CLONE_DIR="$2"; shift 2 ;;
    --skip-db|--skip-llm-prompt|--non-interactive|--no-start) FORWARD_ARGS+=("$1"); shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[install]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) fail "Unsupported OS: $OS. On Windows use starters/hybrid/install.bat instead." ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  arm64|aarch64) NODE_ARCH="arm64" ;;
  *) fail "Unsupported CPU architecture: $ARCH" ;;
esac

# --- git ---------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  if [ "$OS" = "Darwin" ]; then
    fail "git is missing. Install the Xcode Command Line Tools (xcode-select --install) or Homebrew git, then re-run."
  fi
  fail "git is missing. Install it with your package manager (e.g. sudo apt install git / sudo dnf install git), then re-run."
fi

# --- locate or clone the repo ------------------------------------------------
find_repo_root() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && grep -q '"name": "open-mercato"' "$dir/package.json" 2>/dev/null; then
      printf '%s' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

if REPO_ROOT="$(find_repo_root)"; then
  log "Using existing clone: $REPO_ROOT"
else
  TARGET="${CLONE_DIR:-$PWD/open-mercato}"
  if [ -d "$TARGET/.git" ]; then
    log "Using existing clone: $TARGET"
  else
    log "Cloning open-mercato ($BRANCH) into $TARGET ..."
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET"
  fi
  REPO_ROOT="$TARGET"
fi
cd "$REPO_ROOT"

# --- Node 24 -----------------------------------------------------------------
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" -ne "$NODE_MAJOR" ]; then
  if [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    log "Installing Node $NODE_MAJOR via Homebrew ..."
    brew install "node@$NODE_MAJOR"
    BREW_NODE="$(brew --prefix "node@$NODE_MAJOR")/bin"
    export PATH="$BREW_NODE:$PATH"
    warn "Added $BREW_NODE to PATH for this session. Persist it in your shell profile:"
    warn "  export PATH=\"$BREW_NODE:\$PATH\""
  else
    # Distro-agnostic official tarball into the user's home — no sudo needed.
    NODE_DIST_INDEX="https://nodejs.org/dist/index.json"
    NODE_PREFIX="$HOME/.local/share/open-mercato/node"
    OS_SLUG=$([ "$OS" = "Darwin" ] && echo darwin || echo linux)
    log "Resolving latest Node $NODE_MAJOR release ..."
    NODE_VERSION="$(curl -fsSL "$NODE_DIST_INDEX" | grep -o "\"v$NODE_MAJOR\.[0-9]*\.[0-9]*\"" | head -1 | tr -d '"')"
    [ -n "$NODE_VERSION" ] || fail "Could not resolve a Node $NODE_MAJOR version from nodejs.org."
    TARBALL="node-$NODE_VERSION-$OS_SLUG-$NODE_ARCH.tar.gz"
    BASE_URL="https://nodejs.org/dist/$NODE_VERSION"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    log "Downloading $TARBALL ..."
    curl -fsSL "$BASE_URL/$TARBALL" -o "$TMP_DIR/$TARBALL"
    log "Verifying checksum ..."
    curl -fsSL "$BASE_URL/SHASUMS256.txt" -o "$TMP_DIR/SHASUMS256.txt"
    (cd "$TMP_DIR" && { command -v sha256sum >/dev/null 2>&1 && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c - ; } || { command -v shasum >/dev/null 2>&1 && grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c - ; }) \
      || fail "Checksum verification failed for $TARBALL."
    mkdir -p "$NODE_PREFIX"
    tar -xzf "$TMP_DIR/$TARBALL" -C "$NODE_PREFIX" --strip-components=1
    export PATH="$NODE_PREFIX/bin:$PATH"
    warn "Installed Node $NODE_VERSION to $NODE_PREFIX (PATH updated for this session)."
    warn "Persist it in your shell profile:"
    warn "  export PATH=\"$NODE_PREFIX/bin:\$PATH\""
  fi
fi
[ "$(node_major)" -eq "$NODE_MAJOR" ] || fail "Node $NODE_MAJOR is required (found $(node -v 2>/dev/null || echo none))."
log "Node $(node -v) ready"

# --- yarn via corepack -------------------------------------------------------
if ! command -v corepack >/dev/null 2>&1; then
  fail "corepack is missing from this Node install — reinstall Node $NODE_MAJOR from nodejs.org."
fi
corepack enable >/dev/null 2>&1 || warn "corepack enable failed (PATH not writable?) — continuing; yarn may still resolve via corepack shims."
YARN_SPEC="$(node -p "require('./package.json').packageManager.split('+')[0]")"
log "Activating $YARN_SPEC via corepack ..."
corepack prepare "$YARN_SPEC" --activate
log "yarn $(yarn --version) ready"

# --- docker (detect only) ----------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  warn "Docker with the compose v2 plugin was not found."
  if [ "$OS" = "Darwin" ]; then
    warn "Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) or colima + docker/compose via Homebrew."
  else
    warn "Install Docker Engine + compose plugin (https://docs.docker.com/engine/install/) and add yourself to the docker group."
  fi
  warn "Re-run this installer after Docker is available."
  exit 2
fi

# --- hand off to the shared pipeline ----------------------------------------
exec node starters/lib/install.mjs "${FORWARD_ARGS[@]+"${FORWARD_ARGS[@]}"}"
