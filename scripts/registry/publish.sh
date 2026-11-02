#!/bin/sh
# Compatibility wrapper. The implementation is the cross-platform Node
# script scripts/registry/publish.mjs — edit that file, not this one.
exec node "$(dirname "$0")/publish.mjs" "$@"
