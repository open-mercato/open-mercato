#!/bin/sh
# The maintenance profile requires explicit persistent storage; never repairs it.
set -eu
umask 077
recovery_root=/var/lib/open-mercato/recovery
fail() { echo "ERROR: $1" >&2; exit 3; }
[ -d "$recovery_root" ] && [ ! -L "$recovery_root" ] || fail 'Recovery volume is missing or is a symbolic link.'
awk -v root="$recovery_root" '$5 == root { found=($6 ~ /(^|,)rw(,|$)/) } END { exit !found }' /proc/self/mountinfo || fail 'Mount a writable persistent recovery volume before running maintenance.'
filesystem=$(stat -f -c %T "$recovery_root")
case "$filesystem" in
  overlay|overlayfs|tmpfs|ramfs|devtmpfs|proc|procfs|sysfs|cgroup*|mqueue|fusectl|debugfs|tracefs|securityfs)
    fail 'Recovery storage must persist beyond the maintenance container; ephemeral or virtual filesystems are refused.' ;;
esac
[ "$(stat -c %u "$recovery_root")" = "$(id -u)" ] || fail 'Recovery volume owner must match the current maintenance UID; no ownership repair was attempted.'
[ "$(stat -c %a "$recovery_root")" = 700 ] || fail 'Recovery volume must have mode 0700; no permission repair was attempted.'
[ -w "$recovery_root" ] || fail 'Recovery volume is not writable by the maintenance UID.'
if [ -n "${DATABASE_URL:-}" ]; then
  node -e 'try { const host = new URL(process.env.DATABASE_URL).hostname; process.exit(["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) ? 0 : 1) } catch { process.exit(1) }' || fail 'Maintenance DATABASE_URL must use PostgreSQL network-namespace loopback; no hostname or TLS-policy rewrite was attempted.'
fi
[ "$#" -gt 0 ] || fail 'Supply the installed backup or application CLI command.'
exec "$@"
