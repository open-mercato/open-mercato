#!/bin/sh
# Compatibility wrapper. The implementation is the cross-platform Node
# validator scripts/validate-skills-tiers.mjs — edit that file, not this one.
exec node "$(dirname "$0")/validate-skills-tiers.mjs" "$@"
