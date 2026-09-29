#!/bin/sh
# Compatibility wrapper. The implementation is the cross-platform Node
# installer scripts/install-skills.mjs — edit that file, not this one.
exec node "$(dirname "$0")/install-skills.mjs" "$@"
