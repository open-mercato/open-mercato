#!/bin/sh
# Compatibility wrapper. The implementation is the cross-platform Node
# script scripts/clean-packages.mjs — edit that file, not this one.
exec node "$(dirname "$0")/clean-packages.mjs" "$@"
