#!/bin/sh
# Placeholder shipped by the bare scaffold.
#
# The real installer lives in the agentic overlay and is copied over this file
# by `create-mercato-app` (agentic setup) or by `mercato agentic:init`. If you
# are reading this message, that step has not run for this app yet, so there is
# nothing to install skills from.
set -e

cat <<'MESSAGE'
Agent skills are not set up for this app yet.

`yarn install-skills` installs the shared open-mercato/skills collection, which
requires the agentic setup files. Run:

    yarn mercato agentic:init

then re-run `yarn install-skills`. (Scaffolding with --skip-agentic-setup or
--agents none intentionally leaves this app without agent tooling.)
MESSAGE
