---
title: "Ephemeral restarts need full process and port cleanup"
modules: ["cli"]
areas: ["testing","debugging"]
topics: ["dev-runtime","testing","runtime-startup"]
---

# Ephemeral restarts need full process and port cleanup

**Context**: `test:integration:ephemeral:start` frequently fails the SECOND run with "Application process exited before readiness (exit 1)".

**Problem**: A prior `packages/cli/bin/mercato server start` child lingers, and `pkill -f "mercato test:ephemeral"` does NOT match it.

**Rule**: Before restarting, `pkill -9 -f "mercato server start"`, free the port (`for pid in $(lsof -tiTCP:5001); do kill -9 $pid; done`), `docker rm -f` the stale postgres/ryuk containers, and remove `apps/mercato/.mercato/*.lock`, then retry.

**Applies to**: every local ephemeral integration run.
