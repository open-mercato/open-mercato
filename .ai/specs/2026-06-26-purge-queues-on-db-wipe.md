# Purge background-job queues on every DB wipe (driver-agnostic) + `mercato queue purge --all`

- **Status**: Draft (deferred implementation)
- **Scope**: OSS
- **Date**: 2026-06-26
- **Risk**: medium (touches every DB-wipe path and the queue layer across both drivers)
- **Priority**: medium (developer-experience papercut: false "Runtime error detected" on a healthy app)
- **Tracking issue**: [#3661](https://github.com/open-mercato/open-mercato/issues/3661)
- **Affected packages**: `@open-mercato/queue`, `@open-mercato/cli`, root `scripts/`, `@open-mercato/create-app` template

## TLDR

When the database is wiped and reseeded (`yarn initialize --reinstall`, `yarn db:greenfield`, standalone `dev --setup --reinstall`), the **persisted background-job queues are left untouched**. The local file-based queue (`.mercato/queue/`) and/or the BullMQ/Redis queue still hold jobs and events that reference rows from the *old* database — rows that no longer exist after the wipe. On the next boot the lazy workers replay those orphaned jobs against the fresh DB, the search indexer fails to load the now-missing records, and the dev splash promotes that worker warning into a blocking **"Runtime error detected"** even though the app itself warmed successfully.

This spec adds a **driver-agnostic queue purge** that runs at **every DB-wipe site**, exposes it as a first-class `mercato queue purge --all` CLI command, and ships a `yarn dev:purge-queue` convenience alias (mirrored into the create-app template). The DB and the queue are wiped together so they can never drift apart.

## Open Questions

> Resolve these with the maintainer before expanding the Implementation Plan. They are architecture-affecting; do not guess.

1. **Should `init --reinstall` purge the queue unconditionally, or only when the queue strategy is resolvable without a booted DI container?** At table-drop time in `init --reinstall` and `db:greenfield` there is **no DI container** (raw `pg.Client`). The driver-agnostic purge must therefore run from primitives (the `createQueue()` factory + env), not from `container.resolve('eventBus')`. Confirm: is it acceptable for the purge helper to construct queues directly from `QUEUE_STRATEGY` / `QUEUE_BASE_DIR` / Redis URL, exactly as the existing `mercato queue clear <name>` command already does (`packages/cli/src/mercato.ts:1659-1665`)? **Proposed answer: yes** — mirror the existing single-queue `clear` bootstrap; do not require DI.
2. **Events queue coverage.** The events queue is cleared today only via DI (`mercato events clear` → `eventBus.clearQueue()`, `packages/cli/src/mercato.ts:1733`). For local file strategy the events queue is just another `.mercato/queue/events/` subdir, so a file-level purge covers it for free. For async/Redis the events queue lives under its own BullMQ queue name. Confirm: should `queue purge --all` (a) purge file-based events for free via the dir sweep, and (b) for async, additionally boot DI to call `eventBus.clearQueue()` **only when a DI container is available** (i.e. in the standalone `dev:purge-queue` path and the post-bootstrap stage of `init`), while the no-DI drop-time path relies on the registered-queue sweep + a known `events` queue name? **Proposed answer: yes**, with `events` added to the swept queue-name set so the no-DI path still clears it for both drivers.
3. **Async/Redis purge granularity.** `init --reinstall` already calls `redis.flushall()` when `REDIS_URL` is set (`packages/cli/src/mercato.ts:~941`). When `QUEUE_STRATEGY=async` and the queue Redis is the *same* instance, `flushall` already nukes the queues — so an explicit per-queue `obliterate()` is redundant there but harmless. When the queue uses a **separate** Redis (`QUEUE_REDIS_URL`) the `flushall` on the app Redis does **not** clear queues. Confirm the purge must target the **queue** connection (`getRedisUrlOrThrow('QUEUE')`), independently of the app Redis flush. **Proposed answer: yes** — purge the queue connection explicitly; never assume the app `flushall` covered it.
4. **Secondary mitigation (splash allowlist).** Even with the purge, a record can legitimately be deleted between enqueue and processing, producing the same non-fatal `[SearchIndexer] Failed to load record for indexing` line. Per the existing lesson *"Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings"*, should this spec **also** add that pattern to the splash non-blocking allowlist (`scripts/dev-runtime-log-policy.mjs` + template copy) as defense-in-depth? **Proposed answer: yes, as a small dedicated Story** — the purge fixes the common case; the allowlist fixes the residual race.

## Problem Statement

### Symptom

Running `yarn dev:greenfield` boots to a red splash:

```
Greenfield dev flow — Runtime error detected
[SearchIndexer] Failed to load record for indexing {
…
[lazy-supervisor] Pending job detected — starting worker for queue "communication-channels-poll-tick"
[SearchIndexer] Failed to load record for indexing {
```

…despite the same run reporting `🚪 Login flow and backend warmed in 100.5s` and a valid `readyUrl`. The app is up; the splash only *looks* failed.

### Root cause

The greenfield/reinstall flow wipes and reseeds the database but never clears the persisted job queues:

- `yarn dev:greenfield` → `runGreenfieldDev()` (`scripts/dev.mjs:1775`) → `yarn initialize --reinstall`.
- `mercato init --reinstall` (`packages/cli/src/mercato.ts:~814-952`) `DROP TABLE … CASCADE`s every table and `redis.flushall()`s the **app** Redis — but does nothing to `.mercato/queue/` or the queue Redis connection.
- The local file queue at `.mercato/queue/events/queue.json` still holds events from the previous database. Observed in the repro: four `customers.customer_person_profile.updated` events from a prior run, referencing tenant/org/record IDs that no longer exist after the reseed.
- On boot, the lazy supervisor starts the `events` / `vector-indexing` workers, replays those events, and `SearchIndexer.indexRecordById` (`packages/search/src/indexer/search-indexer.ts:286-343`) calls `queryEngine.query(...)` for a record under a now-deleted tenant. The query throws; the indexer logs `Failed to load record for indexing` and re-throws (line 336-341).
- The compact dev splash's failure heuristic matches that stderr line and flips to "Runtime error detected".

Net: **the database and the persisted queue are wiped on different schedules** (DB on reinstall, queue never), so they drift. Any DB-wipe without a matching queue-wipe replays orphaned jobs.

### Why fix it at the wipe sites (not only the splash)

Suppressing the splash line (allowlist) hides the symptom but leaves real orphaned jobs in the queue, which still churn failures and waste worker cycles on every boot until they exhaust their retries. The correct fix keeps the two stores consistent: **whenever we wipe the DB, wipe the queue in the same operation.** The splash allowlist is complementary defense-in-depth for the residual enqueue-then-delete race (Open Question 4), not the primary fix.

## Goals / Non-Goals

### Goals

1. A **driver-agnostic** purge that empties every background-job queue, working identically for `QUEUE_STRATEGY=local` (file-based) and `QUEUE_STRATEGY=async` (BullMQ/Redis).
2. Run that purge at **every** DB-wipe site, wired **individually** into `init --reinstall`, `db:greenfield`, the `scripts/dev.mjs` greenfield flow, and the standalone setup-reinstall flow (per maintainer's explicit request — each path calls it, not only a shared helper buried one level down).
3. A first-class CLI command `mercato queue purge --all`.
4. A `yarn dev:purge-queue` convenience alias for manual use, mirrored into the create-app template.
5. No change to queue strategy defaults, retry semantics, or worker concurrency (per `packages/queue/AGENTS.md` "Ask First").

### Non-Goals

- Do **not** purge queues on a normal (non-reinstall) `mercato init`, nor on a normal `yarn dev` / `yarn dev:app` boot. Purge only when the DB is actually wiped or when explicitly invoked.
- Do not change how jobs are enqueued, processed, retried, or how workers are discovered.
- Do not introduce a new queue strategy or a new persistent registry of queue names.
- Do not redesign the dev splash (only an optional small allowlist addition under Open Question 4).

## Proposed Solution

### 1. Shared driver-agnostic purge helper (`@open-mercato/queue`)

Add `purgeAllQueues()` to the queue package — a pure, DI-free function usable from both the CLI and the no-DI drop-time sites.

```ts
// packages/queue/src/purge.ts (new)
import { createQueue } from './factory'
import { getRegisteredQueues } from './worker/registry'
import { resolveQueueStrategy } from './factory'

export type PurgeAllQueuesOptions = {
  /** Defaults to resolveQueueStrategy() (reads QUEUE_STRATEGY). */
  strategy?: 'local' | 'async'
  /** Extra queue names to clear beyond getRegisteredQueues() — e.g. 'events'. */
  extraQueues?: string[]
  /** Local file base dir override (QUEUE_BASE_DIR). */
  baseDir?: string
  /** Async connection override; defaults to getRedisUrlOrThrow('QUEUE'). */
  redisUrl?: string
  logger?: Pick<Console, 'log' | 'warn'>
}

export type PurgeAllQueuesResult = {
  strategy: 'local' | 'async'
  queues: Array<{ name: string; removed: number }>
  totalRemoved: number   // sum of removed; async clear() returns -1 sentinel → reported as 'n/a'
}

export async function purgeAllQueues(options?: PurgeAllQueuesOptions): Promise<PurgeAllQueuesResult>
```

Behavior:
- Resolve the queue name set = `getRegisteredQueues()` ∪ `extraQueues` (default `['events']` so the events queue is always covered for both drivers — Open Question 2).
- For each name, construct the queue via `createQueue(name, strategy, …)` exactly as `mercato queue clear` does (`packages/cli/src/mercato.ts:1659-1665`), call the **existing** `queue.clear()` (local → empties `queue.json` + resets `state.json`; async → `queue.obliterate({ force: true })`), then `close()`.
- Aggregate and return counts. Tolerate per-queue failures: a missing `.mercato/queue/<name>` dir or an unreachable Redis for one queue must not abort the whole purge — log a warning and continue (the DB is already wiped; a best-effort queue purge must not block the reinstall).
- **No new contract on the `Queue` interface** — reuse `clear()`. The only new exported surface is `purgeAllQueues` + its option/result types (treated as a STABLE contract per `BACKWARD_COMPATIBILITY.md` once shipped).
- Export from `packages/queue/src/index.ts`.

> Worker discovery note: `getRegisteredQueues()` is only populated after `registerModuleWorkers()` runs at bootstrap. The no-DI drop-time callers (`init`, `db:greenfield`) must ensure worker metadata is registered before calling the helper, OR the helper falls back to sweeping all `.mercato/queue/*` subdirectories for the local strategy (which needs no registry). **Decision for the Implementation Plan:** for `local`, sweep the filesystem (`QUEUE_BASE_DIR`/`.mercato/queue/*`) so purge works with zero registry dependency; for `async`, require the registered-queue set (+ `extraQueues`) since Redis has no directory to sweep. This keeps the common dev path (local) fully self-contained.

### 2. New CLI command `mercato queue purge --all`

The `queue` "module" is built into `packages/cli/src/mercato.ts` (it is not a discovered `cli.ts` — see the built-in `queue` commands `worker` / `status` / `clear` at `mercato.ts:1538-1740`). Add a fourth built-in command alongside them:

```
mercato queue purge --all            # purge every registered queue + events (driver-agnostic)
mercato queue purge <queueName>      # (optional) single-queue alias of `queue clear`
```

- `--all` → `purgeAllQueues()`, print a per-queue summary table and total.
- Register `purge` in the early-dispatch allowlist next to `['worker', 'status', 'clear']` at `mercato.ts:179` so it runs without requiring full module discovery.
- Help text updated wherever `queue` subcommands are documented.

### 3. Wire purge into each DB-wipe site (individually)

| # | Site | File / anchor | DI booted at wipe time? | Purge call |
|---|------|---------------|--------------------------|------------|
| 1 | `mercato init --reinstall` | `packages/cli/src/mercato.ts` ~877-951 (after `DROP TABLE … CASCADE` loop + `redis.flushall()`) | No (raw `pg.Client`) | `await purgeAllQueues()` (DI-free; local sweep / async via `getRedisUrlOrThrow('QUEUE')`) |
| 2 | `db:greenfield` | `packages/cli/src/lib/db/commands.ts` ~518-551 (after dropping all public + per-module migration tables) | No (raw `pg.Client`) | `await purgeAllQueues()` |
| 3 | `runGreenfieldDev()` | `scripts/dev.mjs` ~1775-1784 | n/a (spawns subcommands) | Covered transitively because it calls `initialize --reinstall` (site 1). **Also** add an explicit `runStage('🧹 Purge stale job queues', ['queue','purge','--all'], …)` step so greenfield calls it individually and visibly (maintainer request). |
| 4 | `runStandaloneSetup()` reinstall | `scripts/dev.mjs` ~1797-1822 | n/a (spawns subcommands) | When `reinstall`, add an explicit `['queue','purge','--all']` runStage step in addition to the `initialize --reinstall` it already runs. |

Sites 1 and 2 make the guarantee hold for **anyone** calling the CLI directly (CI, scripts, manual). Sites 3 and 4 make it explicit and observable in the dev splash progress, per the maintainer's request that greenfield and setup-reinstall "call it individually."

Guard: the purge in site 1 runs **only inside the `if (reinstall)` block** — never on a plain `mercato init`.

### 4. `yarn dev:purge-queue` alias + template mirror

- Root `package.json`: `"dev:purge-queue": "yarn mercato queue purge --all"`.
- `packages/create-app/template/package.json.template`: mirror the same script so scaffolded apps inherit it.
- If a thin `scripts/dev-purge-queue.mjs` wrapper is preferred for parity with `scripts/dev-cache-purge.mjs` (e.g. to print a friendly banner), add it and mirror it into `packages/create-app/template/scripts/`. **Decision:** prefer the one-line yarn alias (no new script file) unless the standalone template cannot resolve `mercato` on PATH — in which case use a wrapper. Capture the chosen approach in the Implementation Plan.

### 5. (Optional, Open Question 4) Splash allowlist hardening

Add `[SearchIndexer] Failed to load record for indexing` (and the analogous `[search.*] Failed to load …`) to the non-blocking runtime-warning allowlist in `scripts/dev-runtime-log-policy.mjs` and the create-app template copy (`packages/create-app/template/scripts/dev-runtime-log-policy.mjs`), per the existing lesson. This prevents the residual enqueue-then-delete race from ever flipping a warmed splash to failed.

## Phasing (Stories)

- **Story A — Driver-agnostic purge primitive.** `purgeAllQueues()` in `@open-mercato/queue` (+ local filesystem sweep, async per-queue obliterate, best-effort error tolerance, exports). Unit tests for both strategies.
- **Story B — CLI command.** `mercato queue purge --all` (+ optional single-queue form), early-dispatch allowlist, help text. Tests for arg parsing and the `--all` path.
- **Story C — Wire into DB-wipe sites.** Sites 1-4 above, with the non-reinstall guard. Tests asserting reinstall/greenfield leave zero residual local jobs.
- **Story D — `dev:purge-queue` alias + template mirror.** Root + template `package.json`, optional wrapper script, mirror.
- **Story E (optional) — Splash allowlist.** Add the indexer-warning patterns to the log policy + template copy, with the existing log-policy tests extended.

Stories A→B→C are ordered (C depends on A; the wiring uses the helper). D and E are independent and can land in parallel after A.

## Implementation Plan (testable Steps)

> Each Step is independently testable. File paths are the touch-list.

1. **A1** — Add `packages/queue/src/purge.ts` exporting `purgeAllQueues()` with the local-filesystem sweep + async registered-queue obliterate, best-effort per-queue error handling, and result aggregation. Export from `packages/queue/src/index.ts`.
2. **A2** — Unit test `packages/queue/src/__tests__/purge.test.ts`: (a) `local` strategy with a seeded temp `QUEUE_BASE_DIR` containing 3 queue subdirs with non-empty `queue.json` → assert all emptied and `state.json` counts reset; (b) `async` strategy with a mocked `createQueue` → assert `clear()`/`obliterate` called per registered queue + `events`; (c) one queue dir missing / one `clear()` rejecting → purge still completes for the rest.
3. **B1** — Add the built-in `queue purge` command in `packages/cli/src/mercato.ts` (next to `worker`/`status`/`clear`), register `purge` in the early-dispatch allowlist (`mercato.ts:179`), update help text.
4. **B2** — Test the command handler: `--all` calls `purgeAllQueues` and prints a summary; bare `queue purge <name>` (if added) clears one queue.
5. **C1** — In `mercato init --reinstall` (`packages/cli/src/mercato.ts`), after the table drops + `redis.flushall()`, call `await purgeAllQueues()` inside the `if (reinstall)` block only. Add a log line.
6. **C2** — In `db:greenfield` (`packages/cli/src/lib/db/commands.ts`), after the public/migration table drops, call `await purgeAllQueues()`.
7. **C3** — In `scripts/dev.mjs` `runGreenfieldDev()`, add an explicit `runStage('🧹 Purge stale job queues', ['queue','purge','--all'], …)` step; in `runStandaloneSetup()` add the same step within the `reinstall` branch.
8. **C4** — Integration-style test: seed `.mercato/queue/events/queue.json` with stale jobs, run the `init --reinstall` queue-purge path (or call `purgeAllQueues()` as the reinstall does), assert the dir is empty afterwards. (See Integration Coverage.)
9. **D1** — Add `dev:purge-queue` to root `package.json` and `packages/create-app/template/package.json.template`; mirror any wrapper script into the template `scripts/` dir.
10. **E1 (optional)** — Add the indexer-warning patterns to `scripts/dev-runtime-log-policy.mjs` + template copy; extend the log-policy unit tests to assert the line is classified non-blocking after ready.

## Integration Coverage

Per root `AGENTS.md` (Documentation and Specifications), the implementer must add these tests as part of the same change. There are **no API routes or UI paths** in this feature (it is CLI + dev-tooling), so coverage is CLI/unit/integration-flavored rather than Playwright UI:

- **Queue purge — local strategy** (`packages/queue/src/__tests__/purge.test.ts`): seed a temp `QUEUE_BASE_DIR` with multiple non-empty queue dirs → `purgeAllQueues({ strategy: 'local' })` empties every `queue.json` and resets `state.json`; a missing dir and a failing queue do not abort the rest.
- **Queue purge — async strategy** (same file, mocked BullMQ): `purgeAllQueues({ strategy: 'async' })` invokes `clear()`/`obliterate({force:true})` for each registered queue plus `events`, against the queue Redis connection (not the app Redis).
- **CLI** (`packages/cli/src/__tests__/queue-purge.test.ts` or the existing CLI test harness): `mercato queue purge --all` resolves the strategy, calls the helper, and prints a summary; exits 0 even if some queues were empty/missing.
- **Reinstall leaves zero residual jobs** (`packages/cli` integration test): given a seeded local queue, the `init --reinstall` purge step (Step C1/C4) results in an empty queue; assert no residual `queue.json` entries remain.
- **Non-reinstall is untouched**: a plain `mercato init` (no `--reinstall`) does **not** empty a seeded queue.
- **(Optional, Story E)** Log-policy test: after the splash is marked ready, a raw `[SearchIndexer] Failed to load record for indexing` line is classified non-blocking and does not demote the session to failed (`scripts/__tests__/dev-runtime-log-policy.test.mjs` or equivalent).

Key dev paths to manually verify (recorded for the implementer): `yarn dev:greenfield` boots to a green/ready splash with no "Runtime error detected"; `yarn dev:purge-queue` empties `.mercato/queue/*` on demand; `yarn mercato queue status <name>` reports 0 waiting after a purge.

## Architectural Review (om-spec-writing lens)

- **Module independence / no cross-module ORM**: N/A — no entities, no DB schema, no migrations. The purge operates on the queue store only.
- **`organization_id` / tenant scoping**: N/A — queue purge is instance-level dev/ops tooling, not tenant data. It runs only at DB-wipe time or on explicit operator command; it never reads tenant rows.
- **Singular naming / FK-only links**: N/A (no entities).
- **Undoability**: Purge is intentionally destructive and runs only alongside a DB wipe (which is itself destructive) or on explicit `--all` invocation. The DB is already gone; there is nothing to preserve. The standalone `dev:purge-queue` is operator-initiated. No accidental-data-loss path on a normal boot (guarded by the `reinstall`-only condition).
- **zod validation**: CLI arg parsing follows the existing `mercato.ts` queue-command style; `--all` is a boolean flag. No external input schema needed.
- **Encryption / sensitive fields**: N/A — no secrets read or written. The helper must never log queue payload contents (which can contain IDs); log only queue names + counts.
- **Canonical primitives**: Reuse `createQueue()`, `resolveQueueStrategy()`, `getRegisteredQueues()`, `getRedisUrlOrThrow('QUEUE')`, and the existing `Queue.clear()` — no bespoke Redis/file access beyond the local-dir sweep, which mirrors `strategies/local.ts` path resolution.
- **Design System / Frontend Architecture Contract**: N/A — no UI.
- **i18n**: CLI/operator log output is developer-facing tooling; prefix any internal `throw new Error(...)` with `[internal]` per the hardcoded-string policy. No user-facing locale strings.

## Migration & Backward Compatibility

- **Additive surfaces (safe)**: new `mercato queue purge` command, new `dev:purge-queue` script, new exported `purgeAllQueues()` helper. No existing command, script, type, or signature changes.
- **`Queue` interface**: unchanged — the helper reuses the existing `clear()` method (`packages/queue/src/types.ts`). No FROZEN/STABLE surface is modified.
- **New stable surface**: once shipped, `purgeAllQueues` and its option/result types are a STABLE contract per `BACKWARD_COMPATIBILITY.md`; future changes follow the deprecation protocol.
- **Behavioral change at wipe sites**: `init --reinstall`, `db:greenfield`, greenfield dev, and setup-reinstall now additionally empty the queue. This is strictly corrective (the queue *should* have been empty after a DB wipe) and only triggers on already-destructive flows — no new data-loss risk on non-wipe paths. Document in `RELEASE_NOTES.md` under the dev-experience section.
- **`packages/queue/AGENTS.md`**: no change to strategy defaults / retry semantics / concurrency (the "Ask First" items are untouched). Add a short "Purging queues" note pointing at `purgeAllQueues` and `mercato queue purge --all`.
- **Rollout**: no env changes required. Respects existing `QUEUE_STRATEGY`, `QUEUE_BASE_DIR`, `REDIS_URL`/`QUEUE_REDIS_URL`.

## File Touch-List (for the implementer)

- `packages/queue/src/purge.ts` *(new)* — `purgeAllQueues()`.
- `packages/queue/src/index.ts` — export the helper.
- `packages/queue/src/__tests__/purge.test.ts` *(new)* — local + async tests.
- `packages/queue/AGENTS.md` — "Purging queues" note.
- `packages/cli/src/mercato.ts` — `queue purge` built-in command + early-dispatch allowlist (`:179`) + help; `init --reinstall` purge call (`:~877-951`).
- `packages/cli/src/lib/db/commands.ts` — `db:greenfield` purge call (`:~518-551`).
- `packages/cli/src/__tests__/queue-purge.test.ts` *(new)* — CLI + reinstall-residual tests.
- `scripts/dev.mjs` — explicit purge `runStage` in `runGreenfieldDev()` (`:~1775`) and `runStandaloneSetup()` reinstall branch (`:~1797`).
- root `package.json` — `dev:purge-queue` script.
- `packages/create-app/template/package.json.template` — mirror `dev:purge-queue`.
- *(optional, Story E)* `scripts/dev-runtime-log-policy.mjs` + `packages/create-app/template/scripts/dev-runtime-log-policy.mjs` + their tests — splash allowlist.
- `RELEASE_NOTES.md` — dev-experience entry.

## References

- Repro & root cause: this session (greenfield splash "Runtime error detected").
- Indexer throw site: `packages/search/src/indexer/search-indexer.ts:336-341`.
- Existing single-queue clear: `packages/cli/src/mercato.ts:1650-1671`.
- Events queue clear (DI): `packages/cli/src/mercato.ts:1728-1736`, `packages/events/src/bus.ts:294`.
- Queue registry: `packages/queue/src/worker/registry.ts:64` (`getRegisteredQueues`).
- Local queue layout: `packages/queue/src/strategies/local.ts` (`.mercato/queue/<name>/queue.json` + `state.json`).
- DB-wipe sites: `packages/cli/src/mercato.ts:~814-952` (`init --reinstall`), `packages/cli/src/lib/db/commands.ts:~423-562` (`db:greenfield`), `scripts/dev.mjs:1775` / `:1797`.
- Related lesson: *"Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings"* (`.ai/lessons.md`).
- Greenfield cache purge precedent: `scripts/dev-cache-purge.mjs` (+ template mirror).
