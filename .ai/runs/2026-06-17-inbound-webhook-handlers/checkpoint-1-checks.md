# Checkpoint 1 — steps 1.1, 1.2, 2.1, 2.2, 2.4

**UTC:** 2026-06-17
**Steps covered:** 1.1 (9dcea46a0), 1.2 (e0076c573), 2.1 (bd3751035), 2.2 (39edd6414), 2.4 (ea82001e0)
**Note:** Step 2.3 (migration + snapshot) is intentionally still `todo` — it depends on `yarn generate` (entity-id artifacts) and is the next step after this checkpoint.
**Touched packages:** `@open-mercato/shared`, `@open-mercato/webhooks`

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `tsc --noEmit` (shared) | ✅ pass | exit 0, no errors; new `inbound-types.ts` + barrel export compile |
| `tsc --noEmit` (webhooks) | ⚠️ pass w/ pre-existing | Only errors are `../core/src/generated-shims/entities.ids.generated.ts` → `Cannot find module '#generated/entities.ids.generated'`. **Pre-existing**, caused by `yarn generate` not having run in this fresh worktree — unrelated to this change. No errors in the new entities/types. |
| `yarn workspace @open-mercato/webhooks test` | ✅ pass | 14 suites / 105 tests passed |
| UI / Playwright | n/a | Phase 1 is infra; no UI touched this window |

## Carry-forward
- `yarn generate` must run before/at Step 2.3 to (a) emit entity-id artifacts for `WebhookIngestionEntity` / `InboundEndpointConfigEntity` and (b) clear the pre-existing `#generated/entities.ids.generated` typecheck error.
- Migration will likely be hand-authored (no DATABASE_URL in this worktree); snapshot updated per the coding-agent exception.
