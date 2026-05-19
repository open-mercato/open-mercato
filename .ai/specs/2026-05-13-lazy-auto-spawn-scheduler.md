# Lazy Auto-Spawn Scheduler

## TLDR
- Add `OM_AUTO_SPAWN_SCHEDULER_LAZY=true` as an additive local scheduler mode.
- Keep `AUTO_SPAWN_SCHEDULER` and direct `mercato server dev/start` defaults backward compatible: eager scheduler startup remains the CLI default.
- In lazy mode, the server starts a lightweight supervisor that probes for enabled rows in `scheduled_jobs` and only then launches the existing `mercato scheduler start` process.
- The monorepo `yarn dev` wrapper opts into lazy scheduler mode by default when the env var is unset, matching the lazy worker wrapper behavior.

## Problem
The local scheduler currently starts whenever `AUTO_SPAWN_SCHEDULER !== 'false'` and `QUEUE_STRATEGY=local`, even when there are no enabled schedules. That creates an extra long-lived process, request container, ORM connection, and database polling loop during idle development.

## Solution
Introduce a lazy local scheduler supervisor in `@open-mercato/cli`:

1. Resolve scheduler auto-spawn mode as `off | eager | lazy`.
2. Preserve eager mode for existing CLI/runtime defaults.
3. In lazy mode, poll `scheduled_jobs` with a read-only `select count(*)` probe.
4. When at least one enabled, non-deleted schedule exists, spawn the unchanged command:

```bash
node <mercatoBin> scheduler start
```

The scheduler execution path, advisory locking, queue/command targets, events, and RBAC checks remain owned by the existing scheduler service.

## Backward Compatibility
- `AUTO_SPAWN_SCHEDULER=false` still disables scheduler auto-spawn.
- Existing `mercato scheduler start` remains unchanged.
- Existing `mercato server dev` and `mercato server start` remain eager unless `OM_AUTO_SPAWN_SCHEDULER_LAZY=true` is set.
- `QUEUE_STRATEGY=async` behavior is unchanged; server runtime still does not spawn the local scheduler process.
- No schema, API, module metadata, generated-file, or scheduler service contract changes.

## Environment
| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTO_SPAWN_SCHEDULER` | `true` | Existing master switch. Legacy value wins. |
| `OM_AUTO_SPAWN_SCHEDULER` | unset | New alias when legacy env is unset. |
| `OM_AUTO_SPAWN_SCHEDULER_LAZY` | `false` in CLI | Enables lazy local scheduler startup. |
| `OM_AUTO_SPAWN_SCHEDULER_LAZY_POLL_MS` | `1000` | Lazy probe interval, clamped to at least `250`. |
| `OM_AUTO_SPAWN_SCHEDULER_LAZY_RESTART` | `true` | Restart scheduler after unexpected exit if schedules still exist. |

## Verification
- Unit-test env resolution.
- Unit-test the supervisor for idle, activation, close, probe-error, and restart behavior.
- Unit-test `server dev` wiring to ensure lazy mode does not spawn `scheduler start` eagerly.

## Changelog
### 2026-05-13
- Implemented lazy scheduler auto-spawn with additive env flags and monorepo `yarn dev` opt-in.
