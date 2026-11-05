# Form-to-Deals — generic Forms→CRM-deal intake bridge (`form_to_deals` module)

> **Status:** Draft — revised after adversarial review (2026-06-17). A generic connector that projects `@open-mercato/forms` submissions into `customers` CRM deals. **Recruitment / ATS-lite is the primary documented use case** (see Use Cases), but the module itself is use-case-agnostic. All consumed contracts are verified against live code (see References for file:line).

## TLDR

> **Positioning:** a thin, generic **Forms→deal bridge** — on `forms.submission.submitted` it creates a CRM `Person` + `Deal` in an admin-configured pipeline, with field mapping, CV/file attachment, consent gating, idempotency, and per-channel source attribution. Recruitment (an ATS-lite candidate funnel) is the lead use case; the same module serves lead/partner/RFP intake by binding a different form to a different pipeline.

**Key Points:**
- Host the intake form natively in OM using `@open-mercato/forms` (public token-based distribution, `file` upload field, consent), surfaced from any channel via a link to the hosted form `/f/<slug>` (Webflow page, JustJoin.IT listing, an OM careers/landing page).
- Add a thin module, `form_to_deals`, that subscribes to `forms.submission.submitted`, decodes answers, gates on consent, and projects each submission into a CRM `Person` + `Deal` in the bound pipeline, attaching uploaded files.
- No third party, no exposed API key, no Webflow plan upgrade; all data in-stack, envelope-encrypted.

**Scope (MVP):**
- A `form_to_deals` module: a form→pipeline **binding** (config + UI), a crash-safe idempotent subscriber on `forms.submission.submitted`, consent gating, person-dedupe-by-email, deal creation in the bound pipeline/stage, file-attachment projection, and **per-channel source attribution** (one form, many open distributions, each tagged on the deal).
- A GDPR erasure-propagation subscriber on `forms.submission.anonymized`.
- en + pl i18n; integration tests; optimistic locking on the binding form.

**Out of scope (deferred):**
- The `@open-mercato/forms` module itself (consumed here).
- AI scoring (emit `form_to_deals.deal.created`; a follow-up spec adds a scoring subscriber on `customers.deal.created`).
- A visual field-mapping editor (MVP uses fixed-core mapping + a small JSON map).
- Full-ATS entities (job requisitions, interviews, scorecards, offers) — see Use Cases / Non-Goals.

**Concerns (verified):**
- `@open-mercato/forms` is not yet on `develop` — official-modules open PR #23 (`feat/forms-as-official-module`, @pat-lewczuk). It must be installed in the SAME OM app as the CRM. (Placement: this spec stays OSS; forms is targeted for `core` — an OM-team call, see Migration & Compatibility.)
- `forms.submission.submitted` is at-least-once (persistent) and id-only (`{ submissionId }`) — the subscriber must re-fetch answers and be crash-safe idempotent.
- Public submit is not literally unauthenticated: the route mints/accepts an anonymous-token (or customer-session) principal.

---

## Overview

`@open-mercato/forms` provides versioned form definitions, append-only encrypted submissions, a public renderer (distribution/invitation tokens), a `file` upload field, consent fields, and GDPR anonymize/retention. It emits a frozen event contract but ships no CRM integration. This module adds the missing projection: forms submission → CRM `Person` + `Deal`. Because the binding is configurable (which form, which pipeline, which field mapping, which channel labels), the module is generic; recruitment is its first and primary use case.

> **Market Reference:** Greenhouse/Lever model an application as candidate(1):application(N) with the résumé as a first-class attachment; HubSpot Forms→Deal never auto-dedupes deals. Adopt: person-dedupe-by-email + a new deal per submission + file as a native attachment + a persisted submission→deal map for idempotency. Reject: async poll (OM deal create is synchronous) and an admin-editable mapping UI for MVP.

## Problem Statement

Capturing external form submissions into the CRM funnel today needs external glue (Zapier/Basin/forwarder) that routes PII through a third party, holds a standing API key, and degrades the model (deal without a linked person, files as expiring URLs). OM has no public form-capture primitive except `@open-mercato/forms`, which already solves anonymous capture, file upload, encryption, and GDPR. The missing piece is the projection from a forms submission into a CRM deal in a chosen pipeline. This module fills exactly that gap, in-stack, for any intake form.

## Use Cases

- **Recruitment (ATS-lite) — primary.** A job-application form (firstName, lastName, email, phone, CV `file`, RODO consent) bound to a recruitment pipeline ("Kandydaci"). The binding's `deal_label` = the open position (one form per role); recruitment answers map to deal custom fields (`cf_seniority`, `cf_expected_salary`, `cf_notice_period`, `cf_linkedin`); a `cf_candidate_score` slot is reserved for the deferred AI-scoring phase. The pipeline's stages ARE the recruitment stages (CRM config; `setup.ts` may seed a default template). This is the intake + pipeline-tracking slice of an ATS — NOT a full ATS (see Non-Goals).
- **Other intakes (same module, different binding).** Lead capture (marketing form → sales pipeline), partner/agency intake, RFP/contact intake — each is a binding of a different form to a different pipeline with its own field map and `source`.

## Proposed Solution (high-level)

1. **Author the form** in the forms studio (separate **firstName** + **lastName** required, email, phone, `file` upload, consent). Publish a version.
2. **Distribute it per channel** as multiple **open** distributions of the SAME form — one per channel — each with its own `https://<host>/f/<slug>`. Each channel links to its own slug; the candidate submits via the forms public renderer (anonymous-token principal); files stored as envelope-encrypted `forms_form_attachment`. (Open submissions mint an implicit `FormInvitation` carrying `distributionId` — the attribution key.)
3. **Bind the form to a pipeline** in the `form_to_deals` admin UI: form (`formId`), target `pipelineId` + `pipelineStageId`, field mapping, consent field, default `source_label`, optional per-distribution `channel_map`, and an optional `deal_label`.
4. **Project on submit:** a persistent, state-tracked subscriber on `forms.submission.submitted` resolves the binding via `formVersion.formId`, resolves the channel (`submission.subjectId`→`FormInvitation.distributionId`→`channel_map`), decodes answers, gates on consent, dedupes/creates a `Person` by email, creates a `Deal` in the bound pipeline/stage (resolved channel as `source`, `deal_label` stamped, mapped `cf.*`), attaches files, and records progress in a `submissionId`-keyed map.
5. **Propagate erasure:** a subscriber on `forms.submission.anonymized` anonymizes the projected Person PII and deletes deal file attachments via the map.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Generic `form_to_deals` module; recruitment is a use case | The connector is use-case-agnostic (form→deal + mapping); naming it after recruitment would under-sell its reuse (lead/partner/RFP intake). |
| Consume `@open-mercato/forms`; do not build form capture | Already does anonymous capture, upload, encryption, GDPR. |
| Events + commands only, no direct ORM links | Reads forms via `formsSubmissionService` (by id) + the file via the forms `AttachmentService`; writes deals/people via `customers.*` commands; the deal file row via an attachments command/service. |
| forms + form_to_deals + customers run in ONE OM app | Same instance (= Dispatch CRM) → in-process `customers.*` writes; no public CRM API, no cross-system sync. |
| Separate firstName/lastName form fields | `personCreateSchema` requires non-empty first AND last; a single `fullName` split risks an empty lastName → ZodError → no deal. |
| Idempotency map is the FIRST durable write, with state | `customers.deals.create` runs its own transaction, so the map cannot share the deal's UoW; a `pending` map row first makes redelivery crash-safe. |
| New deal per submission; dedupe only the Person | Mirrors Greenhouse application(N). |
| `source_label`/`channel_map` configurable; default "Form" | Attribution by per-channel distribution slug (no URL `?source=` param needed). |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Webflow form → OM inbound-webhook adapter | More security surface (URL token, SSRF guard, edge idempotency, tenant resolution); files need Basin/uploader. |
| Basin / Zapier → deals API | Third-party PII + files, standing API key, deal without linked person, file as expiring URL. |
| JJIT email-to-mailbox → existing mail intake | JJIT-sanctioned, lighter for the candidate (native apply, better conversion) but less-structured data needing parsing; kept as a quick-start option, not the steady design. |
| Native iframe embed into Webflow | Viable later; needs operator CSP allowlisting; user chose hosted link. |

## Architecture

```
channel (Webflow / JustJoin.IT / OM) ──link──▶ /f/<slug>  (forms public renderer; anonymous-token principal)
                              │ submit (+ file upload, inline-encrypted in forms_form_attachment)
                              ▼
        forms.submission.submitted  { submissionId }     (persistent, at-least-once)
                              ▼
   form_to_deals submission subscriber (crash-safe idempotent on submissionId)
     1. getCurrent({submissionId,org,tenant})  — NO viewerRole → FULL decoded answers + formVersion
     2. resolve binding by (org, tenant, formVersion.formId); none/inactive → ack & ignore
     2b. resolve channel: subjectId (forms_invitation) → FormInvitation.distributionId → channel_map (else default source_label)
     3. consent gate: read field_map.consentFieldKey; absent/false → ack & ignore (no writes)
     4. assert mapped firstName/lastName/email present → else ack & mark skipped (no partial deal)
     5. UPSERT map row (tenant, submission, status='pending')  ◀── FIRST durable write
     6. dedupe Person by email (findPeopleByAddresses) or customers.people.create → entityId
     7. customers.deals.create (pipeline/stage, source=resolved channel, deal_label, cf.* map, personIds=[entityId], no owner) → dealId
     8. UPDATE map row: deal_id=dealId, status='linked'
     9. per file FileAttachmentRef: readUpload → store as deal Attachment; set map.cv_attached=true
    10. emit form_to_deals.deal.created { dealId, submissionId }

   form_to_deals erasure subscriber on forms.submission.anonymized { submissionId }
     → via map: anonymize projected Person PII + delete deal file attachment(s)
```

- **No direct ORM links** to `forms` or `customers`. **System ctx:** `auth: null` + `organizationScope` from the persisted `FormSubmission` row (event is id-only). **`getCurrent`:** call WITHOUT `viewerRole` for the FULL payload (a `viewerRole` silently slices fields → partial deal); it writes a `form_access_audit` row with a null actor.

### Commands & Events
- **Reused (verified):** `customers.people.create` → `{ entityId, personId }` (link by **`entityId`**, not `personId`); `customers.deals.create` → `{ dealId }`, accepts `{ title, pipelineId, pipelineStageId, source, personIds }` (+ `cf.*` via custom-field input); `findPeopleByAddresses(em, addresses, tenantId, organizationId)` → `MatchedPerson[] { id, email }` (`id` = link `entityId`); forms `getCurrent`, `AttachmentService.readUpload`, `readFileRefs`.
- **Consumed events:** `forms.submission.submitted` `{ submissionId }`, `forms.submission.anonymized` `{ submissionId }`.
- **New commands:** `form_to_deals.binding.create` / `.update` / `.delete`.
- **New event (stub):** `form_to_deals.deal.created` `{ dealId, submissionId }`.

## Data Models

### FormToDealBinding (singular) — table `form_to_deals_bindings`
- `id` uuid PK, `organization_id`, `tenant_id`
- `form_id` uuid (FK id to a forms `Form`; resolution hops submission → `formVersion.formId`)
- `form_label` text nullable (display only)
- `pipeline_id` uuid, `pipeline_stage_id` uuid (validated as a same-tenant pair at save)
- `source_label` text default `'Form'` (fallback when no channel match)
- `channel_map` jsonb nullable — `{ [distributionId]: sourceLabel }` (per-channel attribution; resolved via `FormSubmission.subjectId`→`FormInvitation.distributionId`)
- `deal_label` text nullable — stamped on the deal title/`cf_label` (recruitment use: the open position)
- `field_map` jsonb — identity core `{ firstName, lastName, email, phone?, fileFieldKey, consentFieldKey }` (separate first/last; `consentFieldKey` required when consent is a hard gate) **plus** optional answer-key→`cf.*` mappings (e.g. recruitment `cf_seniority`, `cf_expected_salary`; `cf_candidate_score` reserved for the scoring phase)
- `is_active` boolean default true; `created_at`, `updated_at` (optimistic locking — list/detail responses MUST return `updatedAt`), `deleted_at`
- Unique `(organization_id, tenant_id, form_id)`.

### FormToDealSubmissionMap (singular) — table `form_to_deals_submission_map` — idempotency + state
- `id` uuid PK, `organization_id`, `tenant_id`
- `submission_id` uuid, `deal_id` uuid **nullable** (set after deal commit)
- `status` text — `pending` | `linked` | `skipped`
- `cv_attached` boolean default false, `attempt_count` int default 0, `created_at`, `updated_at`
- **`@Unique(['tenant_id','submission_id'])`** — the hard-idempotency boundary.

No PII on either entity (ids/config only) → no `encryption.ts` map required. Person/Deal PII is encrypted by `customers`; uploaded files by forms + the attachments store.

## API Contracts
CRUD for bindings via `makeCrudRoute` (entity `form_to_deals_bindings`); **every route file exports `openApi`** (`api/openapi.ts` via `buildModuleCrudOpenApi`). No public route added (capture is forms' `/api/forms/public/*`).
- `GET /api/form_to_deals/bindings` — `requireFeatures: ['form_to_deals.view']`; response includes `updatedAt`.
- `POST/PUT/DELETE /api/form_to_deals/bindings` — `requireFeatures: ['form_to_deals.manage']`; zod-validated; optimistic-locked.

## Internationalization (i18n)
- en + pl; UI labels + `t('form_to_deals.errors.*')`; internal-only throws prefixed `[internal]`.

## UI/UX
- One backend settings page: a `DataTable` of bindings + a `CrudForm` (form picker, pipeline + stage pickers, field-map fields incl. consent + `cf.*`, `source_label`, `deal_label`, channel map, active toggle). Shared primitives + semantic tokens; dialog `Cmd/Ctrl+Enter` / `Escape`; optimistic locking (`initialValues.updatedAt`, response returns `updatedAt`).
- Files appear on the existing customers deal **Files** tab (attachment `entityId = E.customers.customer_deal`, `recordId = dealId`).

## Migration & Compatibility

### Non-Goals / scope-outs
- **Supersedes** the Webflow inbound-webhook adapter approach (no provider token, no SSRF-guarded fetch).
- Does not build a forms/form-builder module (that is `@open-mercato/forms`).
- **ATS-lite only** for the recruitment use case: NO job-requisition/opening entities, candidate↔many-applications, interview scheduling, scorecards, offer management, hiring-team roles, or EEO/compliance reporting. Candidates are CRM people + deals (diverges from ANALYSIS-004-bamboohr's `hr.candidate` by design). High-volume/multi-requisition recruiting → a separate `recruitment` module (larger spec).

### Packaging
- Ships as an **official module** `@open-mercato/form-to-deals` (`external/official-modules/packages/form-to-deals`), same family as `@open-mercato/forms`. It is a **module**, NOT an integration-provider (no external service, credentials, or health check — it bridges the internal `forms` and `customers` modules via the event + command buses).
- **Why official (not core):** it depends on `forms`, which is an official module today; a core module cannot hard-depend on an optional official module (dependency direction is official → core). So `form_to_deals` tracks `forms` — official now, and may follow `forms` into `core` if/when the OM team moves it.
- `requires: ['customers']` (core) + soft/peer dependency on `forms` (official). It is a pure consumer of existing core/forms contracts (no core changes) → a **single official-modules PR**, opened AFTER forms PR #23 publishes `@open-mercato/forms` (peer-dep). Merge order: forms #23 → publish → `form_to_deals` PR. Activatable via `official-modules.json` (like `carrier-inpost`/`forms`).

### Dependency, placement & rollout
- Hard dependency: `@open-mercato/forms` active in the SAME OM app as the CRM (PR #23). **Placement: this spec stays OSS `.ai/specs/` — NOT enterprise.** `@open-mercato/forms` is expected to become part of `core`; the core-vs-proprietary call is owned by the OM team (Patryk/Piotrek) and does not gate this spec.
- **Same-app deployment:** forms + `form_to_deals` + `customers` (Dispatch CRM) in ONE OM instance → in-process writes, no public CRM API / no sync. Confirm forms is installed in the Dispatch CRM instance.
- Subscriber files load even when forms is inactive (event id is a string) and are inert; confirm `yarn generate` does not warn and merge order makes the event id exist before this module ships.
- New entities → two additive migrations + snapshot; no existing-table changes, no backfill.
- ACL: adding `form_to_deals.view`/`.manage` + `setup.ts` defaultRoleFeatures requires `yarn mercato auth sync-role-acls` for existing tenants.

## Implementation Plan

### Phase 1: Module skeleton + binding config
1. Scaffold `form_to_deals`: `index.ts` (`requires: ['customers']` + forms soft-dep), `acl.ts`, `setup.ts`, `di.ts`, i18n. `yarn generate` + `yarn mercato auth sync-role-acls`. → verify: typecheck.
2. `FormToDealBinding` entity + zod validators + `makeCrudRoute` + `api/openapi.ts` + binding commands; migration + snapshot. → verify: CRUD test (response returns `updatedAt`).
3. Binding settings page (`DataTable` + `CrudForm`, form/pipeline/stage/consent pickers, optimistic locking). → verify: UI test + ds-guardian.

### Phase 2: Submission → deal subscriber
4. `FormToDealSubmissionMap` entity (unique `(tenant, submission)`, `status`/`deal_id`/`cv_attached`) + migration.
5. Persistent subscriber on `forms.submission.submitted`: system ctx from the submission row; `getCurrent` WITHOUT viewerRole; resolve binding via `formVersion.formId`; resolve channel; consent gate; assert firstName/lastName/email; UPSERT map `pending` (first write); dedupe via `findPeopleByAddresses` else `customers.people.create`; `customers.deals.create` (+ `deal_label`, `cf.*`); UPDATE map `linked`; emit `form_to_deals.deal.created`. Handle 23505 → resolve to existing `deal_id`; redelivery with `pending`/no `deal_id` → reconcile. → verify: submit→deal + replay (no dup) + crash-between-commits reconcile + consent=false → no deal.
6. File projection (only if `linked` and `cv_attached=false`): extract `FileAttachmentRef[]` from `decodedData[fileFieldKey]` via `readFileRefs`; per ref `AttachmentService.readUpload(...)` → bytes; create the deal attachment via the attachments module command/service (mirror `createSyncExcelUploadAttachment`: `ensureDefaultPartitions` → partition `privateAttachments` → `storePartitionFile` → `em.create(Attachment, { entityId:'customers:customer_deal', recordId:dealId, partitionCode, storageDriver, storagePath, url: buildAttachmentFileUrl(id), fileName, mimeType, fileSize, organizationId, tenantId })`), `assertAttachmentScopeInvariant` before persist; set `cv_attached=true`. Handle empty array + multi-file. → verify: file on deal Files tab; replay re-runs only the file step.

### Phase 3: GDPR + hardening + docs
7. Erasure subscriber on `forms.submission.anonymized`: via map, anonymize projected Person PII + delete deal file attachment(s). Document that forms' own `FormAttachment` bytes are NOT purged by forms anonymize (forms-side follow-up). → verify: anonymize → PII gone + attachment deleted.
8. Error policy (diverges from the consent-projector's swallow-all): rethrow → retry for transient failures (file fetch/store, deal create); terminal ack for no/inactive binding, consent=false, missing required fields (mark `skipped`). Spam/flooding mitigation (Risks). Channel setup doc (link to `/f/<slug>`; JJIT external apply URL; recruitment use-case walkthrough). → verify: full suite + ds-guardian.

### Testing Strategy
- Integration: submit → deal in bound pipeline + linked person (by `entityId`) + file attachment; replay → no dup; crash after deal commit before map update → reconcile; consent=false → no writes; missing email/lastName → no partial deal; binding CRUD + optimistic-lock conflict; anonymize → erasure propagated; a recruitment-binding case (deal_label + `cf.*`) and a non-recruitment binding (lead pipeline) to prove generality. Self-contained fixtures. Assert linking by `personId` (not `entityId`) is rejected.

## Risks & Impact Review

#### Crash between deal commit and map update → duplicate deal
- **Scenario**: `customers.deals.create` commits in its own transaction; the map UPDATE then fails. Redelivery finds no `linked` map → second deal.
- **Severity**: High — **Mitigation**: write the map row `pending` BEFORE `deals.create`; redelivery with `pending`/no `deal_id` reconciles; unique `(tenant, submission)` + 23505→resolve handles concurrency. — **Residual**: brief self-healing reconcile window.

#### Consent not given but deal created
- **Scenario**: forms `submit()` does no consent validation and emits unconditionally; the consent projector handles only SIGNATURE fields, so a boolean consent yields no record/gate.
- **Severity**: Critical (legal) — **Mitigation**: subscriber reads `field_map.consentFieldKey`; absent/false → ack & ignore, mark `skipped`, no writes; `consentFieldKey` required in validation. — **Residual**: depends on correct binding config; covered by a test.

#### GDPR erasure does not propagate
- **Scenario**: forms anonymize tombstones revision payloads but NOT `FormAttachment` bytes; projected Person/Deal/file in customers untouched.
- **Severity**: Critical (legal) — **Mitigation**: erasure subscriber on `forms.submission.anonymized` propagates to customers; file a forms-side follow-up to purge `FormAttachment` bytes. — **Residual**: forms-side file bytes persist until that follow-up; document a manual erasure runbook.

#### Dedupe misses returning people → duplicates
- **Scenario**: `findPeopleByAddresses` uses an SQL equality fast path (only when encryption OFF; `primary_email` is random-IV encrypted, no `hashField`/blind index) then decrypts at most **500** most-recent persons. Returners beyond that window are silently missed.
- **Severity**: Medium — **Mitigation**: accept for form volume; durable fix is a searchable email-hash/blind index (lib JSDoc) — follow-up. Cost is bounded (≤500), not O(all). — **Residual**: duplicate persons for high-volume/long-tail returners.

#### Spam / pipeline-flooding amplification
- **Scenario**: forms public limiter FAILS OPEN (default 30/min/IP), captcha optional; each submission writes Person+Deal+file (file stored twice).
- **Severity**: Medium — **Mitigation**: binding setup MUST require captcha + a non-fail-open limiter on the distribution; consider a per-form/day deal cap or a quarantine entry stage. — **Residual**: bounded by the cap.

#### JustJoin.IT channel — confirmed supported (conversion trade-off)
- **Confirmed**: JJIT KB lets a listing point "Apply" to an external URL (`/f/<jjit-slug>`) or an email address. No JJIT API needed.
- **Severity**: Low (trade-off) — **Note**: the redirect makes the candidate leave JJIT → some conversion loss (keep the form short); native JJIT form converts better but strands data in JJIT. Attribution via the per-channel slug (no URL param). — **Residual**: none material.

#### Reopen → resubmit dropped; repeat submissions → many deals
- **Scenario**: a `reopened` submission re-submits with the SAME `submissionId`; the map swallows it (lost edit). Open distributions allow repeat submits → N deals.
- **Severity**: Medium — **Mitigation**: subscribe to `forms.submission.reopened` + re-sync the existing deal, OR document reopen/resubmit out of MVP scope; optional same-email dedupe window. — **Residual**: documented scope boundary; tests both paths.

#### Cross-tenant leak via mis-scoped ctx
- **Severity**: Critical — **Mitigation**: derive org/tenant ONLY from the persisted `FormSubmission`; `syncDealPeople` + `assertAttachmentScopeInvariant` reject mismatched/partial-null scope. — **Residual**: none beyond platform guarantees.

#### Partial file-attachment failure
- **Severity**: Medium — **Mitigation**: the file step is gated on `cv_attached=false` and re-runs on retry WITHOUT recreating the deal; attachment-exists check prevents dupes. — **Residual**: deal exists briefly without the file until retry.

## Final Compliance Report — 2026-06-17 (revised)

### AGENTS.md Files Reviewed
- root `AGENTS.md`, `packages/core/AGENTS.md` (commands, events, encryption, API routes incl. openApi + ACL grant sync), `customers/AGENTS.md`, `attachments/AGENTS.md` (scope invariant), `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/ui/AGENTS.md` + `.ai/ds-rules.md`, forms package AGENTS.md.

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | No cross-module ORM relationships | Compliant | Forms via service, customers/attachments via commands; FK ids only |
| root | Filter by organization_id | Compliant | Scope from submission row, passed everywhere |
| root | Optimistic locking on new editable entities | Compliant | Binding `updated_at` + CrudForm; response returns `updatedAt`; map is append-only state |
| core | Export `openApi` from every API route | Compliant | `api/openapi.ts` + export from `bindings/route.ts` |
| core | ACL grant sync for new features | Compliant | `yarn mercato auth sync-role-acls` in Phase 1 |
| attachments | `assertAttachmentScopeInvariant` before persist | Compliant | In the file write step |
| core | zod validation | Compliant | Binding schemas; `consentFieldKey` required |
| events | Idempotent persistent subscribers | Compliant | First-write `pending` map + unique `(tenant, submission)` + reconcile |
| root | Encryption maps for PII | Compliant (N/A) | Module stores ids/config only |
| root | No hardcoded UI strings / status colors | Compliant | i18n en/pl; semantic tokens |
| .ai/specs taxonomy | OSS vs enterprise placement | Resolved | Stays OSS; forms targeted for `core` (OM-team call) |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models ↔ API contracts | Pass | Bindings CRUD ↔ entity; map internal |
| API ↔ UI/UX | Pass | Settings page = bindings CRUD; no public route |
| Risks cover all writes | Pass | Deal/person/attachment/map + erasure |
| Idempotency covers at-least-once + crash | Pass | First-write `pending` map + reconcile + 23505 |
| Consent + erasure addressed | Pass | Consent gate + anonymized subscriber |

### Verdict
- **Ready after must-fixes (applied)** — pending forms activation in the Dispatch CRM instance. Recommend `om-pre-implement-spec`.

## References (verified file:line)
- `@open-mercato/forms` (official-modules PR #23): `/f/:slug`; submit route `api/form-submissions/[id]/submit/route.ts` (anonymous-token/customer principal); `forms.submission.submitted` `{submissionId}` (`events-payloads.ts:55`, `submission-service.ts:706`); `forms.submission.anonymized` (`api/.../anonymize/route.ts:92`); `getCurrent` (`submission-service.ts:903`, slices only when `viewerRole` set, `:866-885`); `file` field + `FileAttachmentRef[]` + `readFileRefs` (`schema/file-field.ts:10-31`); `AttachmentService.readUpload` (`attachment-service.ts:71`); consent projector template (`subscribers/forms-consent-projector.ts`); `license:'Proprietary'` (`index.ts:10`); public rate limiter fail-open (`api/public/rate-limit.ts`); open submit mints `FormInvitation` with `distributionId` (`services/distribution-service.ts:266-331`, subject `forms_invitation`).
- `customers/commands/people.ts:729` (`{ entityId, personId }`), `commands/deals.ts:409` (`customers.deals.create`, `syncDealPeople` links by `CustomerEntity.id`), `lib/findPeopleByAddresses.ts:55` (`MatchedPerson[]`, `MATCH_CANDIDATE_LIMIT=500`), `data/validators.ts:98-99,114-115` (firstName/lastName required), `encryption.ts` (no `primary_email` hashField).
- `sync_excel/lib/upload-storage.ts:23-63` (attachment create pattern), `attachments/lib/access.ts:26` (`assertAttachmentScopeInvariant`), `attachments/lib/partitions.ts` (`privateAttachments`), `E.customers.customer_deal`, `attachments/AGENTS.md:37`.
- `.ai/specs/2026-06-08-deals-list-redesign.md`, `.ai/specs/SPEC-030-2026-02-24-deal-attachments.md`, `.ai/specs/2026-04-03-customers-lead-funnel.md` (scoped OUT), `.ai/specs/analysis/ANALYSIS-004-bamboohr-integration.md`.
- `packages/core/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md`, `.ai/ds-rules.md`.

## Changelog
### 2026-06-17
- Renamed/generalized from `candidate_intake` to **`form_to_deals`** — a generic Forms→CRM-deal bridge; recruitment (ATS-lite) is now the primary documented use case, not the module identity (also serves lead/partner/RFP intake).
- Packaging decision: ships as an **official module** `@open-mercato/form-to-deals` (a module, NOT an integration-provider), tracking `forms` (dependency direction forces official, not core, while forms is official). Single official-modules PR after forms #23 publishes.
- (Earlier same day) re-pointed from a Webflow inbound-webhook adapter to `@open-mercato/forms`; applied 8 adversarial-review must-fixes (`findPeopleByAddresses` not a fabricated helper; CV read/write split; consent gate; erasure propagation; crash-safe first-write idempotency map; openApi/ACL-sync; clarified anonymous-token principal); added multi-channel attribution (JustJoin.IT/Webflow/OM); resolved placement (OSS, forms→core per OM team); confirmed JJIT external apply URL; reaffirmed ATS Non-Goals.
