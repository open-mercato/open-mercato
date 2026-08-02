# Handoff — 2026-06-17-inbound-webhook-handlers

**Last updated:** 2026-06-17T04:30:00Z
**Branch:** feat/inbound-webhook-handlers (pushed to `fork`)
**PR:** https://github.com/open-mercato/open-mercato/pull/3145 (DRAFT)
**Current phase/step:** ALL 12 Tasks done — Phase 1 implementation complete
**Last commit:** e2503f781 — test(webhooks): cover unified inbound route source resolution / 401 / dedup

## State: implementation complete
All 12 plan Steps are `done`. Final gate (see `final-gate-checks.md`): typecheck 21/21 ✓, build:app ✓, i18n ✓, webhooks unit tests 121/121 ✓. One unrelated flaky CLI watcher test (`dev-env-reload`, no CLI files touched by this PR, fails standalone; develop is 39 commits ahead).

## What Phase 1 delivers
- Spec remediation (route unify, adapter-bridge, Phase-4 baseline, TTL, credentialFields).
- Shared inbound types; `WebhookIngestion`/`InboundEndpointConfig` entities + migration + encryption map.
- `webhooks.inbound.processed`/`handler_failed` events.
- globalThis source/handler registries + wildcard resolution.
- Queue-backed `webhook-inbound-dispatch` worker.
- Auto-discovery via `generators.ts` plugins (`webhook-sources.ts` + `webhook-handlers.ts`), auto-wired through `runBootstrapRegistrations()` (no bootstrap/template edits).
- Unified `[endpointId]` route: source-first resolution (credential/tenant probing → ingestion → dispatch → `inbound.received`), legacy adapter path preserved.

## Remaining before merge (maintainer / CI)
- Run `yarn test:integration` + `yarn test:create-app:integration` (deferred — heavy; PR kept draft).
- Code review / `om-auto-review-pr` (cannot run from this account on upstream — no triage access).
- Update branch onto current `origin/develop` (39 commits behind).
- Apply labels (maintainer-only on upstream): `feature`, `needs-qa`, `priority-medium`, `risk-high`, `review`.

## Follow-up phases (not in this PR — see spec)
- Phase 2 admin UI (ingestion log / sources pages, replay) — ds-guardian applies there.
- Phase 3 Stripe reference handlers (`gateway-stripe`).
- Phase 4 inbox_ops refactor (env→encrypted creds; preserve HMAC+Svix + events).
- Outbound-loop `_inboundIngestionId` suppression edit.

## Worktree
- Path: .ai/tmp/auto-create-pr/inbound-webhook-handlers-20260617-144928 (intact, on branch).
- Created this run: yes.
