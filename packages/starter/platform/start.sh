#!/usr/bin/env bash
# Open Mercato starter — macOS/Linux bootstrap.
#
# The only job of this script is to guarantee Node 24, then hand off to the
# cross-platform starter CLI (packages/starter/bin/om-start.mjs), which does
# everything else: doctor, corporate TLS trust, env/secrets, install, infra
# containers, database, and the supervised dev runtime.
#
# Inside a clone:   ./packages/starter/platform/start.sh [command] [flags]
# Standalone:       curl -fsSL https://raw.githubusercontent.com/open-mercato/open-mercato/main/packages/starter/platform/start.sh | bash
#
# Env: OM_NODE_DIST_MIRROR — base URL mirroring https://nodejs.org/dist for
# proxy-blocked networks (defaults to the official CDN).
set -euo pipefail

NODE_MAJOR=24
NODE_DIST_BASE="${OM_NODE_DIST_MIRROR:-https://nodejs.org/dist}"

log()  { printf '\033[36m[starter]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[starter]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31m[starter]\033[0m %s\n' "$*" >&2; exit 1; }

# Two-tone Open Mercato wordmark (7-bit ASCII — safe on any terminal).
if [ -t 1 ]; then
  printf '\n'
  printf '\033[2;36m   ___  ____  _____ _   _ \033[0m\033[36m  __  __ _____ ____   ____    _  _____ ___\033[0m\n'
  printf '\033[2;36m  / _ \\|  _ \\| ____| \\ | |\033[0m\033[36m |  \\/  | ____|  _ \\ / ___|  / \\|_   _/ _ \\\033[0m\n'
  printf '\033[2;36m | | | | |_) |  _| |  \\| |\033[0m\033[36m | |\\/| |  _| | |_) | |     / _ \\ | || | | |\033[0m\n'
  printf '\033[2;36m | |_| |  __/| |___| |\\  |\033[0m\033[36m | |  | | |___|  _ <| |___ / ___ \\| || |_| |\033[0m\n'
  printf '\033[2;36m  \\___/|_|   |_____|_| \\_|\033[0m\033[36m |_|  |_|_____|_| \\_\\\\____/_/   \\_\\_| \\___/\033[0m\n'
  printf '\n   \033[2mplatform bootstrap - guarantees Node %s, then hands off to the starter CLI\033[0m\n\n' "$NODE_MAJOR"
fi

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) fail "Unsupported OS: $OS. On Windows run packages\\starter\\platform\\start.cmd instead." ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  arm64|aarch64) NODE_ARCH="arm64" ;;
  *) fail "Unsupported CPU architecture: $ARCH" ;;
esac

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

install_node() {
  if [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    log "Installing Node $NODE_MAJOR via Homebrew ..."
    brew install "node@$NODE_MAJOR"
    BREW_NODE="$(brew --prefix "node@$NODE_MAJOR")/bin"
    export PATH="$BREW_NODE:$PATH"
    warn "Added $BREW_NODE to PATH for this session — persist it in your shell profile."
    return
  fi
  # Distro-agnostic official tarball into the user's home — no sudo, checksum
  # verified. curl uses the system trust store, so a corporate CA deployed by
  # IT is honored automatically.
  NODE_PREFIX="$HOME/.local/share/open-mercato/node"
  OS_SLUG=$([ "$OS" = "Darwin" ] && echo darwin || echo linux)
  log "Resolving latest Node $NODE_MAJOR release ..."
  NODE_VERSION="$(curl -fsSL "$NODE_DIST_BASE/index.json" | grep -o "\"v$NODE_MAJOR\.[0-9]*\.[0-9]*\"" | head -1 | tr -d '"')"
  [ -n "$NODE_VERSION" ] || fail "Could not resolve a Node $NODE_MAJOR version from $NODE_DIST_BASE. Behind a proxy? Set HTTPS_PROXY, or point OM_NODE_DIST_MIRROR at an internal mirror."
  TARBALL="node-$NODE_VERSION-$OS_SLUG-$NODE_ARCH.tar.gz"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  log "Downloading $TARBALL ..."
  curl -fsSL "$NODE_DIST_BASE/$NODE_VERSION/$TARBALL" -o "$TMP_DIR/$TARBALL"
  curl -fsSL "$NODE_DIST_BASE/$NODE_VERSION/SHASUMS256.txt" -o "$TMP_DIR/SHASUMS256.txt"
  (cd "$TMP_DIR" && { command -v sha256sum >/dev/null 2>&1 && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c - ; } || { command -v shasum >/dev/null 2>&1 && grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c - ; }) \
    || fail "Checksum verification failed for $TARBALL."
  mkdir -p "$NODE_PREFIX"
  tar -xzf "$TMP_DIR/$TARBALL" -C "$NODE_PREFIX" --strip-components=1
  export PATH="$NODE_PREFIX/bin:$PATH"
  warn "Installed Node $NODE_VERSION to $NODE_PREFIX (PATH updated for this session)."
  warn "Persist it:  export PATH=\"$NODE_PREFIX/bin:\$PATH\""
}

if [ "$(node_major)" -ne "$NODE_MAJOR" ]; then
  install_node
fi
[ "$(node_major)" -eq "$NODE_MAJOR" ] || fail "Node $NODE_MAJOR is required (found $(node -v 2>/dev/null || echo none))."
log "Node $(node -v) ready"

# Locate the repo: walk up from this script first (in-clone use), then from
# the working directory (curl-standalone use).
find_root_from() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/starters/docker/compose.infra.yml" ]; then
      printf '%s' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
REPO_ROOT="$(find_root_from "$SCRIPT_DIR" || find_root_from "$PWD" || true)"

if [ -n "${REPO_ROOT:-}" ]; then
  exec node "$REPO_ROOT/packages/starter/bin/om-start.mjs" "$@"
fi

# Standalone: no clone yet — npx fetches the published starter, which clones
# and continues. --use-system-ca keeps this working behind corporate TLS
# interception when the CA is in the system store.
log "No checkout found — bootstrapping via npx @open-mercato/starter ..."
NODE_OPTIONS="${NODE_OPTIONS:-} --use-system-ca" exec npx --yes @open-mercato/starter "$@"
