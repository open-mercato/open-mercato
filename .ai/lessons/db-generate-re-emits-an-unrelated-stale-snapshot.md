---
title: "Local tooling gotchas: stale snapshots and ephemeral restarts"
modules: ["cli","ai_assistant"]
areas: ["module-data","testing","debugging"]
topics: ["database-migrations","dev-runtime","regeneration"]
---

# Local tooling gotchas: stale snapshots and ephemeral restarts

## db:generate re-emits unrelated migrations from stale snapshots

**Context**: Generating a migration for the documents module also produced an `ai_assistant` migration and snapshot edit.

**Problem**: The `ai_assistant` snapshot is stale on `develop`, so EVERY `yarn db:generate` re-emits an unrelated `ai_assistant` migration and snapshot change even when targeting another module.

**Rule**: Delete the stray migration and `git restore` its snapshot before staging; never stage it. Never run `yarn db:migrate` just to make the generator quiet.

**Applies to**: any module whose snapshot has drifted from its entities on the base branch.

## Ephemeral restarts need full process and port cleanup

**Context**: `test:integration:ephemeral:start` frequently fails the SECOND run with "Application process exited before readiness (exit 1)".

**Problem**: A prior `packages/cli/bin/mercato server start` child lingers, and `pkill -f "mercato test:ephemeral"` does NOT match it.

**Rule**: Before restarting, `pkill -9 -f "mercato server start"`, free the port (`for pid in $(lsof -tiTCP:5001); do kill -9 $pid; done`), `docker rm -f` the stale postgres/ryuk containers, and remove `apps/mercato/.mercato/*.lock`, then retry.

**Applies to**: every local ephemeral integration run.
