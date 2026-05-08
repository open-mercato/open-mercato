# Forms Module — Phase 1c: Submission Core (Services + Runtime API)

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** [Phase 1a](./2026-04-22-forms-phase-1a-foundation.md), [Phase 1b](./2026-04-22-forms-phase-1b-authoring.md).
> **Unblocks:** 1d (renderer calls these APIs), 2a (admin inbox reads these entities), 2b (compliance acts on these entities).
> **Session sizing:** ~1.5–2 weeks. This is the heaviest phase.

## TLDR

- Introduces three entities: `form_submission`, `form_submission_actor`, `form_submission_revision`.
- Ships `SubmissionService` (start/save/submit), `RolePolicyService` (field-level ACL), `EncryptionService` (per-tenant AES-GCM envelope).
- Runtime API for end-users: `POST /api/form-submissions` (start), `PATCH /api/form-submissions/:id` (autosave), `POST /api/form-submissions/:id/submit`, `GET .../resume-token`, `GET .../by-subject/...`.
- Optimistic concurrency via `base_revision_id`; silent-drop of fields outside actor's editable set with a tampering-marker log.
- No admin UI here (inbox = phase 2a); no renderer (= phase 1d); no PDF (= phase 2b); no anonymize (= phase 2b).

## Overview

Phase 1c is the "business brain" of the Forms module. It turns a published `form_version` into a fillable artifact, ensures role-partitioned concurrent edits can't collide, and writes an append-only audit trail under per-tenant envelope encryption. The runtime API is designed to be consumed by a *renderer* — the hand-rolled React version of which lands in phase 1d, but the API must be independently testable and usable by any future renderer (native mobile, headless integration, AI agent).

## Problem Statement

Form definitions from 1b are inert without a submission lifecycle. Everything that makes forms *audit-grade* — append-only revisions, role partitioning, encryption, tenant isolation, optimistic concurrency — lives in this phase. Admin UI and compliance artifacts (PDF, audit log panel, anonymize button) are deliberately deferred: they depend on this phase's services but have their own UI/ops surface.

## Proposed Solution

1. Three entities + their migration (additive on top of 1a's migration).
2. `EncryptionService`: AES-GCM, per-tenant DEK generated on first use, wrapped with KMS master, cached in-memory for process lifetime; ciphertext self-describes key version (`version(2B) | key_version(2B) | iv(12B) | ciphertext | tag(16B)` stored as `bytea`).
3. `RolePolicyService`: pure function `(form_version, actor_role, field_key, op) → allow|deny`. Consumes `rolePolicyLookup` from the 1a compiler.
4. `SubmissionService`: owns the save/submit lifecycle — validates, enforces role permissions, encrypts, appends revision, emits events.
5. Commands: `submission.start`, `submission.save`, `submission.submit`, `submission.reopen`, `submission.assign_actor`, `submission.revoke_actor`.
6. Runtime API handlers with role-sliced responses.
7. DB rate-limit + revision-count cap for R3 mitigation.
8. Integration with the 1a events catalog — emits `forms.submission.started`, `forms.submission.revision_appended`, `forms.submission.submitted`, `forms.submission.reopened`, `forms.submission.actor_assigned`.

## Architecture

### New files

```
packages/forms/src/
├─ entities/
│  ├─ form-submission.ts
│  ├─ form-submission-actor.ts
│  └─ form-submission-revision.ts
├─ services/
│  ├─ submission-service.ts
│  ├─ role-policy-service.ts
│  └─ encryption-service.ts
├─ commands/
│  └─ submission.ts
├─ api/runtime/
│  ├─ forms/by-key/[key]/active.ts
│  ├─ form-submissions/
│  │  ├─ index.ts                    # POST start
│  │  ├─ [id]/
│  │  │  ├─ index.ts                 # GET current (role-sliced), PATCH autosave
│  │  │  ├─ submit.ts                # POST
│  │  │  └─ resume-token.ts          # GET
│  │  └─ by-subject/[subject_type]/[subject_id].ts
├─ api/admin/
│  ├─ forms/
│  │  └─ submissions/                # minimal GET for phase 2a to hang off
│  │     └─ [submissionId]/
│  │        ├─ index.ts              # GET current submission (for 2a drawer; writes audit placeholder — audit write lands in 2b)
│  │        ├─ revisions.ts          # GET revisions list
│  │        ├─ reopen.ts             # POST reopen
│  │        └─ actors/...            # POST assign / DELETE revoke
```

### EncryptionService contract

```ts
interface EncryptionService {
  encrypt(organizationId: string, plaintext: Buffer): Promise<Buffer>
  decrypt(organizationId: string, ciphertext: Buffer): Promise<Buffer>
  currentKeyVersion(organizationId: string): Promise<number>
  rotate(organizationId: string): Promise<void>   // allocates a new DEK version
}
```

- Master key id from `FORMS_ENCRYPTION_KMS_KEY_ID`.
- DEK per `(organization_id, key_version)`; wrapped DEK persisted (new table `forms_encryption_key` or per-tenant settings — **decision:** one new table `forms_encryption_key` with `(organization_id, key_version, wrapped_dek)` is cleaner and matches ops tooling. Lands in this phase's migration.).
- In-memory DEK cache per process; TTL `1h` with LRU cap; invalidated on `rotate`.
- Redaction helper: given a `CompiledFormVersion` and a payload, returns payload with `x-om-sensitive` fields replaced by `"[REDACTED]"` — used by logger middleware to protect R1.

### SubmissionService.save flow

1. Load submission + current revision.
2. Enforce actor row exists for `(submission_id, user_id)` and is not revoked.
3. Compile pinned `form_version` (via 1a compiler, cache hit on steady state).
4. Validate incoming `base_revision_id` matches `current_revision_id` — if not, short-circuit with `409 stale_base`.
5. Filter patch: drop fields not in `actor_role`'s editable set; if any dropped, log `tampering_marker` with `(submission_id, user_id, role, dropped_fields)` (no stack trace, no payload values).
6. Merge filtered patch over decrypted current data.
7. Validate merged payload against AJV (allows `additionalProperties: false` at root).
8. Compute `changed_field_keys` (set-diff vs previous revision).
9. Encrypt merged data.
10. Open transaction: insert `form_submission_revision` (monotonic `revision_number`), update `form_submission.current_revision_id`.
11. Emit `forms.submission.revision_appended`.

### RolePolicyService

Pure function over `CompiledFormVersion.rolePolicyLookup`. Exposed for:
- API layer (filter patch, slice response).
- Studio warning (phase 1b already consumes this via the compiler — no new work here).

### Optimistic concurrency

- Client sends `base_revision_id`.
- Server asserts it equals `current_revision_id`. If not, 409 — client re-fetches. Phase 1d's renderer handles that UX.
- Because role-editable sets are disjoint in well-formed forms, this rarely fires in practice. It is the last line of defence against schema misconfig or admin intervention (R7).

## Data Models

### `form_submission`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `organization_id` | uuid | FK id |
| `form_version_id` | uuid | FK id — **pinned**, never mutated |
| `subject_type` | text | Polymorphic tag |
| `subject_id` | uuid | Polymorphic id; validated at app layer |
| `status` | text | `draft` \| `submitted` \| `reopened` \| `archived` |
| `current_revision_id` | uuid | FK id — advances on save |
| `started_by` | uuid | FK id |
| `submitted_by` | uuid | nullable |
| `first_saved_at` | timestamptz | |
| `submitted_at` | timestamptz | nullable |
| `submit_metadata` | jsonb | IP, UA, locale at submit time |
| `pdf_snapshot_attachment_id` | uuid | nullable; populated by phase 2b |
| `anonymized_at` | timestamptz | nullable; populated by phase 2b |

Indexes: `(organization_id, form_version_id, status)`, `(subject_type, subject_id)`, `(organization_id, submitted_at desc)`.

### `form_submission_actor`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `submission_id` | uuid | FK id |
| `organization_id` | uuid | Denormalized |
| `user_id` | uuid | FK id |
| `role` | text | Must be in `form_version.roles` |
| `assigned_at` | timestamptz | |
| `revoked_at` | timestamptz | nullable |

Indexes: `(submission_id, user_id) WHERE revoked_at IS NULL`; `(submission_id, role)`.

### `form_submission_revision`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `submission_id` | uuid | FK id |
| `organization_id` | uuid | Denormalized |
| `revision_number` | int | Monotonic per submission |
| `data` | bytea | Ciphertext payload |
| `encryption_key_version` | int | Which tenant key version was used |
| `saved_at` | timestamptz | |
| `saved_by` | uuid | FK id |
| `saved_by_role` | text | |
| `change_source` | text | `user` \| `admin` \| `system` |
| `changed_field_keys` | text[] | plaintext for audit queries |
| `change_summary` | text | nullable |
| `anonymized_at` | timestamptz | nullable; set by phase 2b |

Invariants: **APPEND-ONLY**; only UPDATE allowed is anonymization tombstone (phase 2b command). Never DELETE.

### `forms_encryption_key` (new — supports envelope encryption)

| Column | Type | Notes |
|---|---|---|
| `organization_id` | uuid | |
| `key_version` | int | |
| `wrapped_dek` | bytea | KMS-wrapped DEK |
| `created_at` | timestamptz | |
| `retired_at` | timestamptz | nullable; set when a new version supersedes |

Primary key: `(organization_id, key_version)`.

## API Contracts

All routes filter by `organization_id` from auth context (runtime uses customer auth; admin uses staff auth). All inputs Zod-validated; all GETs export `openApi`.

### Runtime routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/forms/by-key/:key/active` | Returns pinned published version, sliced to caller's available roles |
| `POST` | `/api/form-submissions` | Body `{ form_key, subject_type, subject_id, locale }`; auto-assigns starter to `x-om-default-actor-role` |
| `GET` | `/api/form-submissions/:id` | Role-sliced current state; returns `{ submission, revision, decoded_data, actors }` |
| `PATCH` | `/api/form-submissions/:id` | Body `{ base_revision_id, patch }`; returns `{ revision }` or `409` |
| `POST` | `/api/form-submissions/:id/submit` | Body `{ base_revision_id }`; emits `forms.submission.submitted` |
| `GET` | `/api/form-submissions/:id/resume-token` | Signed cross-device token (`FORMS_RESUME_TOKEN_TTL_S`) |
| `GET` | `/api/form-submissions/by-subject/:subject_type/:subject_id?form_key=...` | Lists submissions accessible to the subject |

### Admin routes added in this phase

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/forms/:id/submissions` | Inbox listing (paginated); consumed by phase 2a UI |
| `GET` | `/api/forms/submissions/:submissionId` | Current state (role-filtered for admin's roles); **access audit row is written here starting in phase 2b** — this phase writes a placeholder no-op so the call site is stable |
| `GET` | `/api/forms/submissions/:submissionId/revisions` | Timeline |
| `POST` | `/api/forms/submissions/:submissionId/reopen` | |
| `POST` | `/api/forms/submissions/:submissionId/actors` | Assign user to role |
| `DELETE` | `/api/forms/submissions/:submissionId/actors/:actorId` | Revoke |

## Concurrency & Rate-Limit

- `FORMS_AUTOSAVE_INTERVAL_MS` default 10 s. Server rejects saves faster than half this (5 s) with `429 too_fast`.
- Revision-count cap per submission: `FORMS_REVISION_CAP` default 10,000. Beyond the cap, saves *coalesce* into the latest revision via UPDATE-with-audit (the only UPDATE path allowed on this table apart from anonymization). Threshold is configurable; monitoring alert at 1k.
- Event emission (`forms.submission.revision_appended`) is inside the same transaction as the revision insert to guarantee at-least-once semantics.

## Commands & Undoability

| Command | Undoable? | Notes |
|---|---|---|
| `submission.start` | Yes | inverse hard-deletes only if no revisions exist |
| `submission.save` | **No** | append-only; the admin-facing "revert to revision" is a new save in phase 2a |
| `submission.submit` | Yes | inverse is `submission.reopen` |
| `submission.reopen` | Yes | transitions submitted → draft |
| `submission.assign_actor` | Yes | revoke |
| `submission.revoke_actor` | Yes | re-assign |
| `submission.anonymize` | **No** | intentionally non-undoable — lands in phase 2b |

## i18n / Locale

- Submission `submit_metadata.locale` recorded from the client at submit time.
- Role-sliced schema response honours `supported_locales` — phase 1d's renderer chooses the active locale.

## Risks & Impact Review

### R-1c-1 — Sensitive data leakage via logs (R1)

- **Severity**: Critical.
- **Mitigation**: A central logger middleware consumes `CompiledFormVersion` + request route to redact `x-om-sensitive` values from request bodies, response bodies, and error stacks before emission. Request-body logging disabled by default on `/api/form-submissions/*`. Error reporter scrubs payloads.
- **Tests**: assert no plaintext sensitive field values appear in captured log output for any route in this phase.

### R-1c-2 — Tampering via fabricated actor role

- **Severity**: High.
- **Mitigation**: `saved_by_role` is derived server-side from the active `form_submission_actor` row — never read from client input. If a user has multiple active actor rows (not typical), the save's patch keys must be a subset of the union of their roles' editable sets, else drop.

### R-1c-3 — Lost update under race

- **Severity**: Medium.
- **Mitigation**: `SELECT ... FOR UPDATE` on `form_submission.current_revision_id` + base-revision check inside transaction.

### R-1c-4 — Revision flood (R3)

- **Severity**: Medium.
- **Mitigation**: 5 s rate-limit; 10k revision cap with coalesce-into-latest mode; monitoring alert at 1k.

### R-1c-5 — Encryption key mis-wrap / drift

- **Severity**: Critical.
- **Mitigation**: Ciphertext header encodes `key_version`; `EncryptionService.decrypt` selects DEK by header; mismatched DEK fails with a typed error. Integration test exercises encrypt-then-rotate-then-decrypt.

### R-1c-6 — Cross-tenant leak

- **Severity**: Critical.
- **Mitigation**: Every query filters by `organization_id` from auth context. Integration tests probe cross-tenant `GET`/`PATCH` attempts (expect 404).

## Implementation Steps

1. Add the three submission entities + `forms_encryption_key` entity.
2. `yarn db:generate` migration.
3. Implement `EncryptionService` with in-memory DEK cache + rotation plumbing.
4. Implement `RolePolicyService` thin wrapper over compiler output.
5. Implement `SubmissionService.start/save/submit` with the transaction flow above.
6. Implement `submission.*` commands with undoability matrix.
7. Implement runtime API handlers with role-sliced responses + 409 / 429 / 422 error shapes.
8. Implement admin submission routes (GET/reopen/actor ops) — these are *consumed* by phase 2a but their minimal backends live here so 2a is pure UI + UX.
9. Wire logger redaction middleware on the forms namespace.
10. Add openapi exports everywhere; extend `data/validators.ts`.
11. Update `registry.ts` with new DI bindings.
12. Extend ACL `requireFeatures` guards on admin routes (`forms.view`, `forms.submissions.manage`).

## Testing Strategy

- **Integration — happy path**: start → 3 saves across two roles → submit → assert 5 revisions, correct `saved_by_role` per revision, correct `changed_field_keys` per revision.
- **Integration — role filtering**: PATCH with fields outside actor's editable set → dropped silently, log emits tampering marker, response returns the accepted keys only.
- **Integration — optimistic conflict**: PATCH with stale `base_revision_id` → 409; subsequent PATCH with fresh id succeeds.
- **Integration — rate limit**: two PATCHes inside 4 s → second returns 429.
- **Integration — revision cap**: with cap set low (10 for the test), saves past the cap coalesce into the latest revision (UPDATE path) and still emit an event flagged `change_source = 'system'`.
- **Integration — cross-tenant**: tenant B attempts to GET/PATCH tenant A's submission → 404.
- **Integration — encryption roundtrip**: start submission on tenant A, rotate key, continue saving — decrypt of old + new revisions succeeds.
- **Integration — no actor**: user without an active `form_submission_actor` row attempts PATCH → 403.
- **Unit — EncryptionService**: ciphertext header parse, DEK cache hit/miss, rotation.
- **Unit — RolePolicyService**: allow/deny matrix per field.
- **Security — log posture**: run test requests through logger middleware; inspect captured output → no sensitive plaintext.

## Final Compliance Report — 2026-04-22

| Rule | Status | Notes |
|------|--------|-------|
| Zod validation on every input | Compliant | All runtime + admin handlers |
| `openApi` on GETs | Compliant | Listed above |
| Tenant scoping | Compliant | Every query filters by `organization_id` |
| Append-only revision invariant | Compliant | Update path only for anonymize (phase 2b) and coalesce-after-cap |
| Typed events | Compliant | Five events from the 1a catalog emitted here |
| ACL guards | Compliant | `forms.view` + `forms.submissions.manage` gate admin routes |
| Encryption boundary | Compliant | AES-GCM envelope per-tenant, rotation supported |
| Rate limit + cap | Compliant | 5 s min interval; 10k revision cap |

**Verdict: ready for implementation post-1a + 1b.**

## Implementation Status

### Phase 1c — Done (2026-05-08)

**Shipped (additive on top of phase 1a foundation)**

- Three new MikroORM entities + a fourth for the encryption key store:
  - `FormSubmission` (`forms_form_submission`) — append-only submission shell with `current_revision_id`, `submit_metadata`, `pdf_snapshot_attachment_id`/`anonymized_at` reserved for 2b.
  - `FormSubmissionActor` (`forms_form_submission_actor`) — partial-unique on `(submission_id, user_id) WHERE revoked_at IS NULL`.
  - `FormSubmissionRevision` (`forms_form_submission_revision`) — append-only revision chain; `data` is `bytea` envelope ciphertext (NOT routed through `findWithDecryption`).
  - `FormsEncryptionKey` (`forms_encryption_key`) — per-tenant wrapped DEK, composite PK `(organization_id, key_version)`.
- Migration `Migration20260508140932_forms.ts` — single additive migration; snapshot updated.
- `EncryptionService` (`services/encryption-service.ts`):
  - AES-256-GCM, header layout `version(2B)|key_version(2B)|iv(12B)|ciphertext|tag(16B)` (format version `0x0001`).
  - In-memory DEK cache: TTL 1h, LRU cap 256 (`(org, key_version)` keyed).
  - `rotate()` allocates next `key_version`, retires the previous, fresh encrypts use it; old ciphertexts remain decryptable via header.
  - `redactSensitive(compiled, payload)` exported for log/error scrubbing (R1).
  - DEV-ONLY KMS adapter (`DevDeterministicKmsAdapter`) derives a wrap key from `FORMS_ENCRYPTION_KMS_KEY_ID` via SHA-256 — file header documents that operators MUST replace this with a real KMS adapter in production.
- `RolePolicyService` (`services/role-policy-service.ts`) — pure thin wrapper over compiled `rolePolicyLookup` exposing `canRead`/`canWrite`/`editableFieldKeys`/`visibleFieldKeys`/`filterWritePatch`/`sliceReadPayload`.
- `SubmissionService` (`services/submission-service.ts`) — owns start/save/submit/reopen/getCurrent/listRevisions/listSubmissionsBy{Form,Subject}/{assign,revoke}Actor with all R-1c-1..6 mitigations: `SELECT … FOR UPDATE`, optimistic concurrency via `base_revision_id`, role filter + tampering marker, AJV validation, encryption, transactional emit, rate limit at half of `FORMS_AUTOSAVE_INTERVAL_MS`, coalesce-after-cap path at `FORMS_REVISION_CAP`. Pluggable `auditAccess` hook with no-op default — phase 2b replaces it.
- Submission commands (`commands/submission.ts`) — `forms.submission.{start,save,submit,reopen,assign_actor,revoke_actor}` registered in `commandRegistry`. Undoability matrix matches the spec; `submission.save` is intentionally NOT undoable. `submission.anonymize` deferred to phase 2b.
- DI wiring (`di.ts`) — `formsEncryptionService`, `formsRolePolicyService`, `formsSubmissionService` registered as singletons. Service emits validate against `formsEventPayloadSchemas` before forwarding to the typed event bus.
- Validators (`data/validators.ts`) — `submissionStartInputSchema`, `submissionSaveInputSchema`, `submissionSubmitInputSchema`, `assignActorInputSchema`, `revokeActorInputSchema` (Zod, `z.infer` types).
- Logger redaction helper (`lib/log-redaction.ts`) — `wrapLogger(inner, compiled)` proxy that scrubs `patch`/`data`/`payload`/`body`/`decoded_data` payload keys via `redactSensitive`; `buildTamperingMarker` for the dropped-field marker.
- Encryption registration (`encryption.ts`) — empty `defaultEncryptionMaps` with a header note explaining the submission `data` column is service-encrypted.
- Runtime API routes (customer auth, `requireCustomerAuth`):
  - `GET /api/forms/by-key/:key/active` — pinned published version, role-sliced.
  - `POST /api/form-submissions` — start.
  - `GET /api/form-submissions/:id` — role-sliced current state.
  - `PATCH /api/form-submissions/:id` — autosave (409/422/429 contracts wired).
  - `POST /api/form-submissions/:id/submit` — submit.
  - `GET /api/form-submissions/:id/resume-token` — signed compact token (`HMAC-SHA256` over `submissionId|userId|exp`); env `FORMS_RESUME_TOKEN_SECRET` (falls back to `JWT_SECRET`); TTL `FORMS_RESUME_TOKEN_TTL_S` (default 3600s); `verifyResumeToken` exported for the renderer.
  - `GET /api/form-submissions/by-subject/:subject_type/:subject_id` — caller-visible submissions only.
- Admin API routes (`requireAuth: true` + `forms.view` / `forms.submissions.manage`):
  - `GET /api/forms/:id/submissions` — paginated inbox.
  - `GET /api/forms/submissions/:submissionId` — admin role-sliced view (audit hook is a no-op TODO for 2b).
  - `GET /api/forms/submissions/:submissionId/revisions` — timeline.
  - `POST /api/forms/submissions/:submissionId/reopen`.
  - `POST /api/forms/submissions/:submissionId/actors` and `DELETE .../actors/:actorId`.
  - All routes export `openApi` and per-method `metadata`.
- Tests (`__tests__/`): added 24 new tests across 3 files (`encryption-service.test.ts`, `role-policy-service.test.ts`, `submission-service.test.ts`) — covering AJV validation, role filter + tampering marker (no plaintext leakage in logs), stale base 409, rate limit 429, revision cap coalesce, cross-tenant 404, no-actor 403, encryption rotation roundtrip, submitted-event emission. Combined forms test count: 59/59 passing.

**Verification (2026-05-08)**
- `yarn workspace @open-mercato/forms test`: 59/59 passing.
- `yarn workspace @open-mercato/forms typecheck`: clean for all phase 1c files (remaining errors are confined to in-progress phase 1b code in `commands/form*.ts`, `backend/forms/`, and `api/helpers.ts`).
- `yarn workspace @open-mercato/forms build`: pass.
- `yarn build:packages`: pass.
- `yarn generate`: clean; new commands and runtime/admin routes appear in generated bundles.
- `yarn db:generate`: forms reports `no changes`; one additive migration committed.
- `yarn mercato configs cache structural --all-tenants`: clean.

**Deviations from the spec text**
1. **No `submission.anonymize` command** — spec marks it as phase 2b; left out per spec instructions and the commands header.
2. **`auditAccess` is a hook, not a sync write** — phase 2b replaces the no-op with the real audit-log writer. Both admin GETs already call the hook so the call site is stable. TODO markers in `getCurrent` and `listRevisions` flag the integration point.
3. **Resume token format is compact, not JWT** — `submissionId.userId.exp.hmac` because the token does not need cookie/header semantics and a JWT layer would add unnecessary bytes. Both sides of the contract live in the same file; phase 1d's renderer consumes `verifyResumeToken` directly.
4. **Logger redaction middleware is a helper, not a framework hook** — the project's logger framework varies by deployment, so this phase ships `wrapLogger(inner, compiled)` plus the `redactSensitive` primitive. Production loggers should additionally disable request-body logging on the forms namespace; documented in `lib/log-redaction.ts`.
5. **`em.create` calls fill `createdAt`/`updatedAt` explicitly** — required by MikroORM v7's stricter `RequiredEntityData` typing; the `onCreate`/`onUpdate` defaults are kept as a safety net for direct entity construction.
6. **Rate-limit math** — `autosaveIntervalMs = 0` disables the rate limit (test convenience). Production default `10_000` ms still yields the 5 s minimum spelled out in the spec.

**Open questions deferred to later phases**
- **Production KMS adapter**: shipped as `KmsAdapter` interface; downstream rollout will plug in AWS/GCP/Vault adapters per operator.
- **Audit-log row schema**: phase 2b owns `form_access_audit`; the `auditAccess` hook contract is intentionally minimal so the real writer can extend without touching this phase's code.
- **Renderer's actor-role resolution**: `GET /api/forms/by-key/:key/active` returns a coarse `callerRoles` list for now; phase 1d will refine after submission resume.

## Changelog

### 2026-04-22
- Initial spec split from main.

### 2026-05-08
- Phase 1c implemented and landed. See Implementation Status above.
