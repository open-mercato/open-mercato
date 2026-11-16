# GDPR readiness audit — re-verification against `main`

Companion to [`2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md).

- **Subject:** the "Current state" table and plan in open-mercato/open-mercato#8593 (audit dated 2026-11-03, `main` @ `73c4a2b06`).
- **Verified at:** `main` @ `08dada9624`, 2026-11-15.
- **Method:** read-only code reading and `git grep`; tracker state via `gh`. Nothing was built or run.
- **Limits:** absence claims are grep-based over `packages/**` and `apps/mercato/src`. `external/official-modules` is not checked out and was not covered. Runtime behaviour (e.g. whether a subscriber actually no-ops) is inferred from code unless marked otherwise. The audit file the issue cites (`.ai/specs/analysis/ANALYSIS-2026-11-03-gdpr-deployment-readiness.md`) is not in the repository or on any fetched branch, so this record checks the issue text, not that file.

Paths: `core/…` = `packages/core/src/modules/…`, `ent/…` = `packages/enterprise/src/modules/…`, `ai/…` = `packages/ai-assistant/src/modules/ai_assistant/…`.

## 1. Where the issue is wrong or stale

| Issue claim | Verdict | What is true | Evidence |
|---|---|---|---|
| 27 modules ship encryption maps | Wrong | 25 modules export `defaultEncryptionMaps`; two of the 27 `encryption.ts` files are a route and the type file | `packages/shared/src/modules/encryption.ts`, `core/entities/api/encryption.ts` |
| Public fallback key in production compose/templates (#7231) | Fixed, with a gap | Compose and both `.env.example` ship blank keys; a Compose `encryption-preflight` service rejects missing, short (<32 bytes) and denylisted keys. The refusal exists **only in Compose** — `kms.ts` accepts any key, so Kubernetes or bare `mercato server start` deployments are unguarded | `docker-compose.fullapp.yml:18-45`, `packages/shared/src/lib/encryption/kms.ts:119-135`, `packages/starter/src/encryption-preflight.mjs` |
| `sendEmail` is Resend-only (#5556) | Stale | Transport is pluggable; `channel-resend`, `channel-ses`, `channel-smtp` ship, Resend is the default. Brevo/Mailjet packages do not exist | `packages/shared/src/lib/email/send.ts:124-150` |
| Moderation hard-coded to `api.openai.com` | Partly | It is a fallback base URL; the chat provider's URL is passed in. Moderation is off by default | `ai/lib/moderation.ts:20,107-110`, `ai/lib/moderation-policy.ts:52-62` |
| No access-log retention | Wrong | Access logs rotate inline after writes: 7 days (core resources) / 8 hours (rest), instance-wide env, at most once a minute per process | `core/audit_logs/services/accessLogService.ts:33-40,396-416` |
| Forms is the only module with consent tooling | Partly | `auth` also has a consent ledger (`user_consents`, integrity hash, admin panel) | `core/auth/data/entities.ts:357-392`, `core/auth/api/users/consents/route.ts` |
| Portal self-service delete/download is "explicitly refused" | Partly | Self-delete is refused; download has no route at all | `core/customer_accounts/api/portal/users/[id].ts:33-35` |
| pgvector `presenter` is plaintext PII | Partly | Built from already-encrypted title/subtitle/icon; only `badge` is plain — unless the tenant lacks the `vector:vector_search` map | `packages/search/src/vector/services/vector-index.service.ts:501-519` |
| No backfill for new encryption maps (#7644) | Partly | The ai_assistant gap is real, but a generic helper exists (`buildEncryptionMapBackfillSql`), used only by checkout and staff | `packages/shared/src/lib/encryption/migration-backfill.ts:49` |
| No logger redaction | Partly | Secret-key redaction exists; emails are scrubbed only on OTLP attributes, not stdout messages. New Relic captures `request.*` | `packages/shared/src/lib/logger/transport.server.ts:5-16`, `newrelic.js:36-40` |
| Next.js telemetry on | Partly | Disabled in Dockerfiles and Railway env; not in `.env.example`, not injected by `mercato server dev`/`start` | `Dockerfile:6`, `packages/cli/src/mercato.ts:2310-2312` |
| #5557 has "no CI on head" | Stale | CI ran and fails: `guard`, `docker-build`, `test`, five integration shards | PR checks, 2026-11-15 |
| #7231, #7239 open | Stale | Both closed (#8377; #7447). Their `release/v0.9.x` backports (#9348 draft, #8479) are still open | tracker |
| "Default `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` to on" closes the search leak | Incomplete | The flag affects the **Meilisearch driver only**. Vector embedding text, the token index (unkeyed SHA-256 of plaintext tokens) and `search_text` are not covered | `packages/search/src/di.ts:51-57`, `packages/search/src/fulltext/drivers/meilisearch/index.ts:144-178`, `packages/shared/src/lib/search/tokenize.ts:113` |

## 2. Confirmed as stated

| Area | Finding | Evidence |
|---|---|---|
| KMS outage (#2241, open) | No Vault and no fallback key → `NoopKmsService`, mapped writes land as plaintext. Signal is a throttled `logger.warn` only. (The `AUTH_SECRET` derivation is gone.) | `packages/shared/src/lib/encryption/kms.ts:455-461` |
| Headers | CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options are set; HSTS and Permissions-Policy are absent in app and template | `apps/mercato/next.config.ts:28-37`, `apps/mercato/src/proxy.ts:75` |
| Plaintext columns | TOTP `user_mfa_methods.secret`; webhook `custom_headers`; `webhook_deliveries` payload/response; notifications title/body/variables; attachments `file_name` + OCR `content`; channel `sender_*`/`subject`/`channel_payload`; SSO `idp_email` (+ `idp_subject`, `idp_name`, `idp_groups`); checkout `user_agent` | `ent/security/data/entities.ts:38`; `packages/webhooks/src/modules/webhooks/data/entities.ts:35,105,114,117`; `core/notifications/data/entities.ts:34-44`; `core/attachments/data/entities.ts:80,101`; `core/communication_channels/data/entities.ts:225,274,277,329`; `ent/sso/data/entities.ts:78-87`; `packages/checkout/src/modules/checkout/data/entities.ts:308` |
| S3 | No SSE/KMS option in the driver | `packages/storage-s3/src/modules/storage_s3/lib/s3-driver.ts` |
| Person erasure | Delete returns 422 when deal links exist; otherwise hard delete. No anonymize anywhere in `customers` | `core/customers/commands/people.ts:1326-1330` |
| Undo snapshots | `action_logs.snapshot_before` / `command_payload.undo` keep the full record after delete (tenant-DEK encrypted, never purged). The staff-user snapshot includes `passwordHash` | `core/audit_logs/data/entities.ts:68-77`, `core/auth/commands/users.ts:1199-1246` |
| Related data on delete | Attachments (+ blobs), messages, external messages, AI chats and notifications are untouched when a person, portal user or staff user is deleted. Portal user delete is soft and leaves email/name in place. No generic purge of soft-deleted rows | `core/customer_accounts/services/customerUserService.ts:156-169` |
| Subject export | None for CRM person, portal user or staff user | grep `customers`, `auth`, `customer_accounts`, `staff` `api/` |
| Cross-module privacy contract | None in code (no data-class registry, DSR interface, legal hold, tenant exit) | grep `packages/*/src`, `apps/mercato/src` |
| Unscheduled pruners | forms `retention-purge`, integrations `log-pruner`, portal `cleanupExpiredSessions` / `cleanupExpiredTokens` exist and nothing enqueues them | `core/forms/workers/retention-purge.ts`, `core/integrations/workers/log-pruner.ts`, `core/customer_accounts/workers/` |
| No pruning | action logs (#2980), staff sessions, staff password resets, webhook deliveries, progress jobs, AI chats, messages, inbox_ops emails, soft-deleted rows. Notifications `cleanup-expired` only dismisses, and only by hand | per-module entities and services |
| Legal pages | `/privacy` and `/terms` hard-code "Open Mercato sp. z o.o."; a test pins that identity | `packages/content/src/modules/content/frontend/privacy/page.tsx:14-19`, `packages/content/src/__tests__/legal-entity.test.tsx:23-27` |
| Consent / unsubscribe | Only a `newsletter_opt_in` custom field. `SendEmailOptions` has no headers field, so no `List-Unsubscribe` | `core/customers/customFieldDefaults.ts:15-19`, `packages/shared/src/lib/email/send.ts:18-30` |
| Map tiles | Deals map defaults to OSM tiles; build-time global override only | `core/customers/backend/customers/deals/map/components/DealsMapCanvasImpl.tsx:28-57` |
| Security audit trail | `auth.login.*` is fire-and-forget, carries no IP/UA, and has no subscriber. Staff `sessions` has no IP/UA columns | `core/auth/api/login.ts:162-210`, `core/auth/events.ts:20-24` |
| Docs / CLI | One docs page mentions GDPR (`user-guide/encryption.mdx`). No `doctor`, preflight or `privacy` CLI command | `packages/cli/src/mercato.ts` |
| MFA | Staff MFA is enterprise-only (`security` module, flag-gated). Portal has none | `apps/mercato/src/modules.ts:246,260-262` |
| Auth baseline | bcrypt cost 10 (staff and portal). Staff minimum 6 chars + complexity; portal 8–128. No breached-password check. Portal locks after 5 failures; staff has no lockout. Rate limiter defaults to memory, including production Compose | `core/auth/services/authService.ts:192`, `packages/shared/src/lib/auth/passwordPolicy.ts:29-34` |

## 3. Gaps the issue does not list

**Security defaults**
- No runtime guard on the tenant encryption key outside Compose (see §1).
- Production Compose still defaults `MEILI_ENV: development` with master key `meilisearch-dev-key`, `POSTGRES_PASSWORD=postgres`, and `DEMO_MODE` / `SELF_SERVICE_ONBOARDING_ENABLED` = true (`docker-compose.fullapp.yml:146-147,326-327,434`).
- `hashForLookup` falls back to plain SHA-256 when no pepper or key is set (`packages/shared/src/lib/encryption/aes.ts:216-221`).
- With Vault plus a fallback key, rows written during an outage are sealed under the derived key, not the Vault key (mixed keys).
- Legacy `auth rotate-encryption-key` still takes `--old-key` on argv (`core/auth/cli.ts:222-227`).

**Third-party data flows**
- Attachment OCR is hard-wired to OpenAI with no provider choice; default-enabled, skipped without `OPENAI_API_KEY` (`core/attachments/lib/ocrService.ts:75,88`).
- AI tools decrypt and return CRM PII to whichever LLM is configured; `x-om-sensitive` exists only in `forms` (`core/customers/ai-tools/people-pack.ts:111`).
- Embedding config is global per database — a tenant cannot pick its own embedding sub-processor. There is no AI region field.
- The EUDR plot map has the same OSM default as the deals map (`core/eudr/components/PlotMapPreviewImpl.tsx:12-13`).
- Forms captcha forwards the respondent IP to Turnstile/reCAPTCHA (opt-in).
- The cookie bar is informational: Accept and Dismiss do the same thing and gate nothing (`apps/mercato/src/components/GlobalNoticeBars.tsx:46-55`).

**Unmapped person data (no encryption-map coverage)**
- Documents content, comments and versions (`packages/documents/src/modules/documents/data/entities.ts:90-96,310,356-359`) — deliberate per the module's own note.
- Staff HR data: team members, addresses, comments, job histories, customer snapshots (`core/staff/data/entities.ts:91,196,532,783,1013`).
- Workflow instance context, step input/output, user-task form data (`core/workflows/data/entities.ts:494,699-702,787,934`).
- Integration log message/payload; CRM interaction participants/location and deal `loss_notes`; `warranty_claims.customer_name`; carrier shipment label data; `forms_form_access_audit.ip/ua`; `record_locks.locked_by_ip`; push and indexer log payloads.

**Erasure / export reach** — modules holding person data that the issue's data-class list omits: `checkout` (transactions), `cart`, `phone_calls`, `warranty_claims`, `staff`, `documents`, `onboarding` (requests), `sso` (identities), `security` (MFA), `promotions` (usages), `payment_gateways` and `shipping_carriers` (webhook events), `workflows`, `integrations` (logs), custom-field values, `audit_logs` itself.

**Retention**
- A fourth unscheduled pruner: `SudoChallengeService.cleanupExpired()` has no caller (`ent/security/services/SudoChallengeService.ts:565`).
- No delete path found for: `webhook_inbound_receipts`, `webhook_ingestions`, `external_messages`, `external_conversations`, `channel_ingest_dead_letters`, `push_notification_deliveries`, `sync_runs`, `scim_provisioning_log`, `onboarding_requests`, `message_access_tokens`, `phone_calls`, `ai_moderation_flags`, agent-orchestrator runs/spans/tool calls.
- Scheduler UI can only target workers flagged `schedulerSafe: true`; none of the pruners is, so an admin cannot wire them by hand (`packages/queue/src/types.ts:384`).
- Forms retention anonymizes and never deletes; portal cleanup is instance-wide, not per tenant.

**Queues and cache**
- Most jobs carry ids only. Four carry content: inbound channel job (whole message), payment webhook event, external-email job (address), and the persistent event queue (whole event payload). Storage is plaintext (`.mercato/queue/<name>/queue.json` or Redis); BullMQ keeps the last 1000 failed jobs.
- The CRUD list cache stores decrypted payloads but is off by default (`ENABLE_CRUD_API_CACHE=false`).

**Probable defect (inferred, not run)**
- `auth.user.deleted` is emitted as `{ id, organizationId, tenantId }` (`core/auth/commands/users.ts:214-222`), but the channel and SSO cascades read `payload.userId`. The channel cascade returns early without it (`core/communication_channels/subscribers/user-deleted-cascade.ts:54`). The SSO cleanup has no guard and runs its update and deletes with an undefined id (`ent/sso/subscribers/user-deleted-cleanup.ts:21-35`); what that matches was not run or tested.

## 4. Already automatic — not to be re-specified

- Scheduled: AI pending-action expiry (5 min), AI token-usage prune (90 days), cart abandon/expire/lock release and 90-day hard delete, payment-session claim prune, promotion reservation sweep, checkout transaction expiry.
- Inline or event-driven: access-log rotation, record-lock history cleanup, document version cap, BullMQ `removeOnComplete`, delete cascades for `query_index`, vector index, translations and SSO.
- Retention env that exists: `AUDIT_LOGS_CORE_RETENTION_DAYS`, `AUDIT_LOGS_NON_CORE_RETENTION_HOURS`, `AUDIT_LOGS_ROTATE_INTERVAL_MS`, `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS`. The only tenant-level stored retention setting is per-form `retention_days`.

## 5. Dependency state

**Specs on `main`**

| Spec | Scope | Status |
|---|---|---|
| `enterprise/2026-07-08-gdpr-data-erasure.md` | Enterprise | Spec-only. Anonymization out of scope; linked deals fail with guidance |
| `enterprise/2026-07-08-automated-database-backups.md`, `enterprise/2026-11-06-cli-backup-restore.md` | Enterprise | Spec-only; code in open #9333 |
| `2026-08-18-tenant-legal-documents-and-consent-versioning.md` | OSS dir, tracker #5423 labelled `enterprise` | Spec-only |
| `2026-10-22-crm-contact-permissions-and-consent-history.md` | OSS | Spec-only. Covers consent history and suppression; names public preference centres as a non-goal and does not mention `List-Unsubscribe`. No dedicated tracker: #7700 is the CRM field-model Phase 1 umbrella, and #8779 states only Phase 1 is tracked |
| `2026-10-09-eu-transactional-email-providers.md` | OSS | Spec-only |
| `enterprise/2026-11-13-sign-in-activity.md` | Enterprise + OSS event seam | Spec-only. Tracker is #8106; #7972, which the issue cites, is a separate Job Inspector access-log defect |
| `2026-11-01-7231-compose-encryption-key.md`, `2026-11-06-setup-encryption-preflight.md`, `2026-11-06-production-bootstrap-credentials.md`, `2026-09-30-encryption-key-rotation-hardening.md` | OSS | Implemented |

Related specs the issue does not cite: `2026-09-30-forms-module-into-core.md`, `2026-06-17-form-to-deals.md` (erasure propagation), `2026-06-09-phone-calls-core-hub-and-tillio-provider.md`, `2026-04-21-crm-call-transcriptions.md`, `2026-08-14-storefront-customer-account.md` (per-module cascade on portal user delete), `2026-10-29-production-content-security-policy.md` (natural home for HSTS), `enterprise/2026-11-12-row-level-security.md`, and `2026-09-30-unified-crm-email-history-and-context.md` — which refuses person/company DELETE while email history exists and therefore collides with erasure.

**PR #5557** (`feat/security-readiness`, head `4165c00225`, 2026-11-12): open, `CONFLICTING`, +23,042 / 351 files, `changes-requested` + `qa-failed`, CI failing. None of its 16 spec files or modules has landed on `main`. Blockers still open: author not on the enterprise contribution allowlist (`scripts/ci/enterprise-contribution-guard.ts:19-29`); QA NO-GO (every login returns 503 with the security module on — `mfaService` registered with `asFunction` under a CLASSIC container); `UPGRADE_NOTES.md` untouched despite a production hard-fail boot.

Its `enterprise/2026-08-21-privacy-retention-dsr-engine.md` **supersedes** the 07-08 erasure spec rather than extending it: `privacy_operations` + `/subjects` replace the `erasure_request` ledger, anonymization moves in scope, `audit_logs` owns three `privacy.subject.*` events. Contract types (`PrivacyDataClassDefinition`, `PrivacyDataClassHandler`) are MIT in `@open-mercato/shared/lib/privacy`; handlers with subject actions ship for `audit_logs.access_logs`, `auth.users`, `customers.people` only; eleven more `privacy.ts` files on the branch register classes for sandbox sanitization or export exclusion with no subject actions. `PrivacyScope.organizationId` is a required string. No retention policy is created automatically — an admin schedules `data_erasure.retention.run`, default `dryRun: true`.

**Open PRs already covering umbrella items:** #8410 (encrypted custom fields out of search), #8987 (TOTP, closes #3854), #9011 (closes #7644), #8744 (closes #2115), #8899 / #8485 / #8582 / #9449 (password hashing and policy), #9508 (rotation old key via env), #9333 (backups), #8472 (bounded access-log writes), #9578 (MFA audit redaction).

**Backups direction conflict:** #4030 (open) records a decision that backups belong at the infra layer and the 07-08 spec is "not to be implemented as an app module"; spec PR #8910 (merged 2026-11-06) and open PR #9333 design and build an enterprise `backups` module. #9333 is in the merge queue with automerge (2026-11-15), so the question is being settled by merge. PR #8472 (bounded access-log writes) is QA-approved with automerge.

**Compatibility:** `BACKWARD_COMPATIBILITY.md` has no category for an env-default flip; precedent treats it as a dated entry + `UPGRADE_NOTES.md`. Boot refusal and fail-closed KMS fit the Emergency Security Exception (`:13-27`), which needs a named maintainer sign-off and forbids a retained toggle. Patch releases carry no `UPGRADE_NOTES.md` window (`CONTRIBUTING.md:246`), which matters for `release/v0.9.x` backports.

**Scope policy:** `CONTRIBUTING.md:108-135` bars external PRs under `packages/enterprise/` only. The 2026-11-12 maintainer comment on #8593 ("planned for Open Mercato Enterprise… won't accept community contributions") is broader than that path rule, and no document covers a capability whose contracts are MIT while the feature is declared enterprise.
