# Queue Purge on DB Wipe

- **Status:** Draft (deferred — not yet implemented)
- **Scope:** OSS
- **Owner module:** `@open-mercato/queue`, `@open-mercato/cli`, root scripts
- **Tracking issue:** _added in a follow-up comment_

## TLDR / Goal

Purge background-job queues (driver-agnostic) whenever the database is wiped, so stale jobs from a previous DB can't be replayed against a freshly-reseeded one. Adds `mercato queue purge --all` + `yarn dev:purge-queue` alias.

## Problem Statement / Why Now

Whenever the database is wiped & reseeded (`yarn initialize --reinstall`, `yarn db:greenfield`, `standalone dev --setup --reinstall`), the persisted background-job queues are left untouched. Stale jobs/events from the old DB get replayed against the fresh DB on next boot, the search indexer fails to load now-missing records, and `yarn dev:greenfield` shows a false "Runtime error detected" splash on an otherwise-healthy app.

Specifically, `yarn dev:greenfield` boots to a false "Runtime error detected" splash: greenfield wipes & reseeds the DB but leaves `.mercato/queue/` populated, so orphaned `customers.customer_person_profile.updated` events get replayed and the search indexer throws (`[SearchIndexer] Failed to load record for indexing`). Captured as a reviewable spec to implement later via `om-implement-spec` / `om-auto-fix-github`.

## Proposed Solution / Scope Captured

- **Driver-agnostic `purgeAllQueues()` helper:** Located in `@open-mercato/queue` (works for both local file + BullMQ/Redis drivers). Reuses the existing `Queue.clear()`.
- **New CLI Command:** Expose a new command `mercato queue purge --all` in `@open-mercato/cli`.
- **Wired into DB-wipe sites:** Called individually during:
  - `init --reinstall`
  - `db:greenfield`
  - The `greenfield` dev flow (root `scripts/dev.mjs`)
  - Standalone `dev --setup --reinstall`
- **Aliases:** Add `yarn dev:purge-queue` alias to root `package.json` + `@open-mercato/create-app` template mirror.
- **Optional defense-in-depth:** Add the indexer warning to the dev-splash non-blocking allowlist.

**Non-goals:**
- No purge on normal `mercato init` / `yarn dev`.
- No change to queue strategy defaults, retry semantics, or worker concurrency.
- No new queue strategy.

**Risk & Priority:**
- Risk: medium (touches every DB-wipe path + the queue layer across both drivers). 
- Priority: medium (dev-experience papercut).

## Open Questions

Confirm these proposed answers with a maintainer before coding:

1. **No-DI purge bootstrap:** To purge queues during DB wipes, we may not have the full DI container booted. **Proposed answer:** Ensure `purgeAllQueues()` can bootstrap the queue driver directly from env/config without requiring the full application DI container.
2. **Events-queue coverage:** Should this purge cover the events queue as well? **Proposed answer:** Yes, the intent is to clear all pending processing, including standard queues and event streams, to ensure a truly clean slate.
3. **Separate queue-Redis:** If Redis is used for queues but a different DB for main storage, how do we handle connection teardown? **Proposed answer:** `purgeAllQueues()` should cleanly open and close its own Redis connection if not passed one.
4. **Splash-allowlist hardening:** Should we add the `SearchIndexer` missing-record warning to the dev splash non-blocking allowlist anyway as defense-in-depth? **Proposed answer:** Yes, this prevents the splash screen from triggering on transient async eventual-consistency issues during normal dev.

## Implementation Plan

1. **Queue Helper:** Create `purgeAllQueues()` in `@open-mercato/queue` that iterates over all registered queues and calls `Queue.clear()`. Ensure it supports both local and async drivers.
2. **CLI Command:** Add `mercato queue purge --all` to `@open-mercato/cli`. Wire it to `purgeAllQueues()`.
3. **Wipe Wiring:** Update `mercato init` (when `--reinstall` is passed), `mercato db:greenfield`, and `dev.mjs` setup scripts to invoke the purge command/helper.
4. **Package.json Aliases:** Add `"dev:purge-queue": "mercato queue purge --all"` to the root `package.json` and the `create-app` template.
5. **Splash Allowlist:** Add the indexer warning to the dev splash non-blocking allowlist.

## Backward Compatibility

No contract surface changes (this spec document only). The eventual implementation is additive (new CLI command, new script, new exported helper; reuses existing `Queue.clear()`).
