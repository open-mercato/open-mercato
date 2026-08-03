#!/bin/sh
# Compatibility entry point for scripts and people that still invoke the
# historical shell path. Generated apps and create-app itself call Node
# directly, so Windows never depends on this wrapper.
exec node "$(dirname "$0")/install-skills.mjs" "$@"
