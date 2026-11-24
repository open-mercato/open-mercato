# Implement Sign-in activity

Source doc: .ai/specs/enterprise/2026-11-13-sign-in-activity.md

Refs #9435

## Goal

Record tenant-scoped staff sign-ins, let admins and staff review their respective history, and deliver optional new-device alerts.

## Scope

Implement the four phases in the design. E1 (GDPR erasure registration) remains the design’s tracked follow-up. Include the required manual erasure and replay-suppression runbook.

## Decision and risks

The maintainer directed autonomous continuation after the Phase 1 delivery change was identified for approval. Proceed with durable login events and queue-only delivery for persistent subscribers. Audit existing consumers and document worker prerequisites and retention for queue and webhook copies before rollout. Preserve the login HTTP contract.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: OSS seam

- [ ] 1.1 Add a `resolveLoginClientMeta(req, container)` helper in `packages/core/src/modules/auth/lib/` returning `{ ip, userAgent, occurredAt }` (take `occurredAt` at emission, not request start) via `getClientIp(req, rateLimiterService.trustProxyDepth)` (service resolved from the container, `null` ip when unavailable) and a 512-char truncated `user-agent`. Unit test: depth 0 → null ip; depth 1 with `X-Forwarded-For` → client ip; long UA truncated.
- [ ] 1.2 Generate the stable `attemptId` (existing session UUID on success; fresh server UUID on failure) once and pass it with the meta into every `emitAuthEvent` emission, including the new `role_denied` one, in `auth/api/login.ts`; add `userId/tenantId/organizationId` to failures when `user` resolved; emit `auth.login.failed` with `reason: 'role_denied'` before the `requiredRoles` 403. Pass `{ persistent: true, skipPersistentSubscribersInline: true, tenantId, organizationId }` on every emission, with canonical resolved scope (null for unknown users), and report enqueue failures without PII. Unit tests assert payloads and options for success, `invalid_password`, `invalid_credentials`, `account_deactivated`, `role_denied`; response bodies and status codes unchanged. Verify persistent consumers execute only through queue dispatch in both single-delivery modes, non-persistent consumers remain inline, retries preserve identity, unknown-email input cannot supply trusted tenant scope, and enqueue failures are reported. Obtain the delivery-semantics approval described above before runtime changes.
- [ ] 1.3 Document delivery timing/retry changes, worker prerequisites, queue/dead-letter/webhook PII retention and purge/replay operations in `UPGRADE_NOTES.md` and operator docs; audit exact/wildcard consumers and verify the deployment privacy gate. Document the new optional fields in `apps/docs` events reference and `auth` AGENTS.md events list.

### Phase 2: Persistence

- [ ] 2.1 `security/lib/user-agent.ts` parser + table-driven unit tests (Chrome/Edge/Firefox/Safari/Opera/Samsung, Windows/macOS/iOS/iPadOS/Android/Linux/ChromeOS, bots, empty).
- [ ] 2.2 `SignInAttempt`, `KnownDevice`, MFA receipt and notification intent entities, plus nullable `MfaChallenge.signInAttemptId`, `security/encryption.ts` map, `yarn db:generate` → keep only the intended tables/column migration + snapshot. `yarn generate`.
- [ ] 2.3 `security/lib/sign-in-activity-config.ts` reading the three env vars with `parseBooleanWithDefault` and clamped ints; mirror into `.env.example` + template.
- [ ] 2.4 `subscribers/sign-in-activity-success.ts`, `sign-in-activity-failed.ts` and `sign-in-activity-mfa-verified.ts` (`persistent: true`), shared `SignInActivityService` registered in `di.ts`. Unit tests: scoping, unresolved failure skipped, atomic new-device upsert (two concurrent calls → one new), exact MFA correlation, reversed delivery, duplicate events, missing identity handling and disabled switch no-op. Extend the MFA interceptor and optional challenge-creation argument; atomically persist/project MFA receipts during challenge creation and verification. Unit-test the policy snapshot and typed interceptor matrix: enforcement off + no methods → `not_required`; enforcement on + no compliant methods → `enrollment_required`; emergency bypass → `bypassed`; active compliant methods → `pending`. A provider-unavailable error (also 400), database failure, invalid claims and unavailable service leave `unknown` and each calls `reportError` with the specified stable code and no PII. Assert unchanged HTTP responses, enrollment redirects and receipt-write failure reporting; exercise receipt-before-attempt and attempt-before-receipt order. Never select latest pending attempts.
- [ ] 2.5 Retention worker + single global stable-UUID schedule (soft-optional scheduler); unit test batch deletion, known-device pruning, window clamp and idempotent registration.

### Phase 3: Admin page

- [ ] 3.1 ACL feature `security.sign_ins.view` + `defaultRoleFeatures` for admin; `yarn generate`.
- [ ] 3.2 `GET /api/security/sign-ins` and `/[id]` with zod query, scoping and OpenAPI. Unit tests for filter → hash mapping and scope clauses.
- [ ] 3.3 `/backend/security/sign-ins` page, filters, drawer, menu entry, `security.sign_ins.list` extension host, i18n (5 locales).
- [ ] 3.4 Integration tests TC-SEC-016/017/019 (admin assertions only), TC-SEC-020/021 and the persistence/MFA portion of TC-SEC-022. Profile assertions wait for Phase 4.

### Phase 4: Profile + notification

- [ ] 4.1 `GET /api/security/profile/sign-ins` + unit tests.
- [ ] 4.2 `profile-recent-sign-ins` injection widget into `security.profile.sections`; i18n.
- [ ] 4.3 Notification type `security.sign_in.new_device` + atomic intent creation inside `recordSignInAttempt`, retryable delivery worker and recovery sweep using deduplicated `createBatch`; failure injection at every durable boundary, including notification commit before acknowledgement.
- [ ] 4.4 Integration tests TC-SEC-016/017/019 (profile assertions), TC-SEC-018 and the notification/recovery portion of TC-SEC-022; assert persisted notification body/metadata contain no IP, email or raw UA. Update enterprise README spec table.
