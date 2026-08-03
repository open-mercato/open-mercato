---
title: "db:generate re-emits unrelated migrations from stale snapshots"
modules: ["ai_assistant","cli"]
areas: ["module-data","debugging"]
topics: ["database-migrations","generated-files","regeneration"]
---

# db:generate re-emits unrelated migrations from stale snapshots

**Context**: Generating a migration for the documents module also produced an `ai_assistant` migration and snapshot edit.

**Problem**: The `ai_assistant` snapshot is stale on `develop`, so EVERY `yarn db:generate` re-emits an unrelated `ai_assistant` migration and snapshot change even when targeting another module.

**Rule**: Delete the stray migration and `git restore` its snapshot before staging; never stage it. Never run `yarn db:migrate` just to make the generator quiet.

**Applies to**: any module whose snapshot has drifted from its entities on the base branch.
