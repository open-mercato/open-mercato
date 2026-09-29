#!/bin/sh
# Compatibility entry point. The generated package script calls Node directly.
exec node "$(dirname "$0")/install-skills.mjs" "$@"
