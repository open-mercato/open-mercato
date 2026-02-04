# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## Don't bypass framework-provided automation with per-call-site reimplementations

**Context**: SPEC-018 — 38 command files each manually constructed `changes` diffs in `buildLog` using `buildChanges()` and `diffCustomFieldChanges()`, even though the CommandBus already inferred changes automatically from `snapshotBefore`/`snapshotAfter`.

**Problem**: Manual diffs used hardcoded field-key lists. When entities gained new fields, nested structures, or custom fields, nobody updated the 38 manual key lists. Audit logs reported "No tracked field changes" despite real differences visible in snapshots.

**Rule**: When a framework layer (CommandBus, CRUD factory, query engine, etc.) provides automatic behavior, don't reimplement it at individual call sites. Provide the inputs the framework needs (e.g., snapshots) and let it do the work. If the automatic behavior is insufficient, improve the framework — don't scatter workarounds across dozens of files.

**Applies to**: Any situation where a shared utility/bus/factory already handles a concern (diffing, validation, side effects, indexing) and you're tempted to add per-module logic that duplicates it.

## Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.
