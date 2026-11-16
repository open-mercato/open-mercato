# Form-to-Deals — generic Forms→CRM-deal intake bridge (`form_to_deals` module)

> **Status:** Draft — revised after adversarial review (2026-11-16). A generic connector that projects core `forms` submissions into `customers` CRM deals. **Recruitment / ATS-lite is the primary documented use case** (see Use Cases), but the module itself is use-case-agnostic. Existing and planned consumed contracts are distinguished below and checked against the spec checkout.

## TLDR

> **Positioning:** a thin, generic **Forms→deal bridge** — on `forms.submission.submitted` it creates a CRM `Person` + `Deal` in an admin-configured pipeline, with field mapping, CV/file attachment, consent gating, idempotency, and per-channel source attribution. Recruitment (an ATS-lite candidate funnel) is the lead use case; the same module serves lead/partner/RFP intake by binding a different form to a different pipeline.

**Key Points:**
- Host the intake form natively in OM using the core `forms` module (public token-based distribution, `file` upload field, consent), surfaced from any channel via a link to the hosted form `/f/<slug>` (Webflow page, JustJoin.IT listing, an OM careers/landing page).
- Add a thin module, `form_to_deals`, that subscribes to `forms.submission.submitted`, reads decoded answers through the trusted forms projection service, gates on consent, and projects each submission into a CRM `Person` + `Deal` in the bound pipeline, attaching uploaded files.
- No third party, no exposed API key, no Webflow plan upgrade; all data in-stack, envelope-encrypted.

**Scope (MVP):**
- A `form_to_deals` module: a form→pipeline **binding** (config + UI), a crash-safe idempotent subscriber on `forms.submission.submitted`, consent gating, person-dedupe-by-email, deal creation in the bound pipeline/stage, file-attachment projection, and **per-channel source attribution** (one form, many open distributions, each tagged on the deal).
- A GDPR erasure-propagation subscriber on `forms.submission.anonymized`, acting when the event's `reason` is `request` or `erasure` (R3-6).
- en + pl i18n; integration tests; optimistic locking on the binding form.

**Out of scope (deferred):**
- The core `forms` module itself (consumed here).
- AI scoring (emit `form_to_deals.deal.created`; a follow-up spec adds a scoring subscriber on `customers.deal.created`).
- A visual field-mapping editor (MVP uses fixed-core mapping + a small JSON map).
- Full-ATS entities (job requisitions, interviews, scorecards, offers) — see Use Cases / Non-Goals.

**Concerns (verified):**
- At the reviewed commit, `forms` is already in `packages/core/src/modules/forms` with MIT metadata and core dependencies (`index.ts`); `form_to_deals` is not implemented. Enable forms in the SAME OM app as the CRM. Historical PR #23 packaging notes in the Changelog no longer describe current placement.
- `forms.submission.submitted` is at-least-once (persistent) and id-only (`{ submissionId }`) — the subscriber must re-fetch answers and be crash-safe idempotent.
- Public submit is not literally unauthenticated: the route mints/accepts an anonymous-token (or customer-session) principal.

---

## Overview

The core `forms` module provides versioned form definitions, append-only encrypted submissions, a public renderer (distribution/invitation tokens), a `file` upload field, consent fields, and GDPR anonymize/retention. It emits a frozen event contract but ships no CRM integration. This module adds the missing projection: forms submission → CRM `Person` + `Deal`. Because the binding is configurable (which form, which pipeline, which field mapping, which channel labels), the module is generic; recruitment is its first and primary use case.

> **Market Reference:** Greenhouse/Lever model an application as candidate(1):application(N) with the résumé as a first-class attachment; HubSpot Forms→Deal never auto-dedupes deals. Adopt: person-dedupe-by-email + a new deal per submission + file as a native attachment + a persisted submission→deal map for idempotency. Reject: async poll (OM deal create is synchronous) and an admin-editable mapping UI for MVP.

## Problem Statement

Capturing external form submissions into the CRM funnel today needs external glue (Zapier/Basin/forwarder) that routes PII through a third party, holds a standing API key, and degrades the model (deal without a linked person, files as expiring URLs). The core `forms` module supplies public capture, file upload, encryption and sensitive-field anonymization; the content-ai coverage spec adds full subject-erasure mode. The missing piece is the projection from a forms submission into a CRM deal in a chosen pipeline. This module fills exactly that gap, in-stack, for any intake form.

## Use Cases

- **Recruitment (ATS-lite) — primary.** A job-application form (firstName, lastName, email, phone, CV `file`, RODO consent) bound to a recruitment pipeline ("Kandydaci"). The binding's `deal_label` = the open position (one form per role); recruitment answers map to deal custom fields (`cf_seniority`, `cf_expected_salary`, `cf_notice_period`, `cf_linkedin`); a `cf_candidate_score` slot is reserved for the deferred AI-scoring phase. The pipeline's stages ARE the recruitment stages (CRM config; `setup.ts` may seed a default template). This is the intake + pipeline-tracking slice of an ATS — NOT a full ATS (see Non-Goals).
- **Other intakes (same module, different binding).** Lead capture (marketing form → sales pipeline), partner/agency intake, RFP/contact intake — each is a binding of a different form to a different pipeline with its own field map and `source`.

## Proposed Solution (high-level)

1. **Author the form** in the forms studio (separate **firstName** + **lastName** required, email, phone, `file` upload, consent). Publish a version.
2. **Distribute it per channel** as multiple **open** distributions of the SAME form — one per channel — each with its own `https://<host>/f/<slug>`. Each channel links to its own slug; the candidate submits via the forms public renderer (anonymous-token principal); files stored as envelope-encrypted `forms_form_attachment`. (Open submissions mint an implicit `FormInvitation` carrying `distributionId` — the attribution key.)
3. **Bind the form to a pipeline** in the `form_to_deals` admin UI: form (`formId`), target `pipelineId` + `pipelineStageId`, field mapping, consent field, default `source_label`, optional per-distribution `channel_map`, and an optional `deal_label`.
4. **Project on submit:** a persistent, state-tracked subscriber on `forms.submission.submitted` resolves the binding via `formVersion.formId`, resolves the channel (`submission.subjectId`→`FormInvitation.distributionId`→`channel_map`), reads decoded answers through the trusted forms projection service, gates on consent, dedupes/creates a `Person` by email, creates a `Deal` in the bound pipeline/stage (resolved channel as `source`, `deal_label` stamped, mapped `cf.*`), attaches files, and records progress in a `submissionId`-keyed map.
5. **Propagate erasure:** on `forms.submission.anonymized` with `reason` `request` or `erasure`, the subscriber removes only the projections it created on the deal: mapped deal `cf.*` answers, the deal label it wrote and projected CV/file attachments, through owning services via the map (R5-6). It never changes CRM Person fields, including when it created that Person; a linked `customers:person` is a related subject handled by C4's review/exclusions and hold guard through the customers owner. A `retention` reason, or none, is acknowledged with no writes: a form's retention period governs the submission, not CRM records, and scheduled retention emits the event in bulk (R3-6 below, also cited by the forms-retention spec).

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Generic `form_to_deals` module; recruitment is a use case | The connector is use-case-agnostic (form→deal + mapping); naming it after recruitment would under-sell its reuse (lead/partner/RFP intake). |
| Consume the core `forms` module; do not build form capture | Already does anonymous capture, upload, encryption, GDPR. |
| Events + commands only, no direct ORM links | Reads forms via the proposed `formsProjectionService` (by id) + files via the forms `AttachmentService`; writes deals/people via `customers.*` commands; the deal file row via an attachments command/service. |
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
     1. formsProjectionService.readSubmitted({submissionId}) — trusted service resolves scope and returns full projection inputs
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

   form_to_deals erasure subscriber on forms.submission.anonymized { submissionId, reason? }
     → reason not in {'request', 'erasure'}: ack, no writes
     → via map: clear only projected deal cf.* answers/label + release tracked deal CV/file attachments (R5-6)
     → never change the linked Person; C4 handles that related subject through its customers owner
```

- **No direct ORM links** to `forms` or `customers`. **System ctx:** the forms-owned `formsProjectionService.readSubmitted({ submissionId })` resolves tenant/organization from its own row and returns submission/version/distribution and full decoded answers only to this trusted in-process subscriber. This is a new sanctioned reader, not a public route. Today `getCurrent` without a viewer role returns empty decoded data (`services/submission-service.ts`); the `unsliced` option is restricted to its existing trusted use. Do not bypass that restriction or read forms tables from the connector. The reader must include an access-audit entry with the internal projection purpose and no copied answers.

### Commands & Events
- **Reused (verified):** `customers.people.create` → `{ entityId, personId }` (link by **`entityId`**, not `personId`); `customers.deals.create` → `{ dealId }`, accepts `{ title, pipelineId, pipelineStageId, source, personIds }` (+ `cf.*` via custom-field input); `findPeopleByAddresses(em, addresses, tenantId, organizationId)` → `MatchedPerson[] { id, email }` (`id` = link `entityId`); forms `AttachmentService.readUpload` and `readFileRefs`. New dependency: forms-owned `formsProjectionService.readSubmitted`, specified by the content-ai coverage spec; ordinary `getCurrent` is role-sliced and is not a full-data reader for this subscriber.
- **Consumed events:** `forms.submission.submitted` `{ submissionId }`, `forms.submission.anonymized` `{ submissionId, reason?: 'request' | 'erasure' | 'retention' }` (reason is added by the retention/content-ai specs; R3-6 defines the exact enum, and this module requires first-party emitters to send it).
- **New commands:** `form_to_deals.binding.create` / `.update` / `.delete`.
- **New event (stub):** `form_to_deals.deal.created` `{ dealId, submissionId }`.

### R3-6 — The form-to-deals reason set

The form-to-deals erasure subscriber acts on `reason` in `{request, erasure}`. Both are subject-driven. It acknowledges `retention`, or a missing reason, with no writes. The `forms.submission.anonymized` payload's `reason` enum is exactly `request | erasure | retention`; the property remains optional for compatibility. Apply the same set to validation, dispatch and retry handling. The content-ai coverage spec, "R3-6 — The form-to-deals reason set", owns the matching erasure emitter; the forms-retention spec cites the same decision and its worker emits `retention`.

For both active reasons, scope comes from the forms-owned reader and stored map; clear only tracked deal `cf.*` answer keys and the deal label this projection wrote, then release only this projection's file ids through C4's `attachmentService.releaseByIds(ids, scope, { expectedEntityId: 'customers:customer_deal', expectedRecordId: dealId, origin }, { em })`, passing the current database transaction's manager and preserving the run origin. Under R5-6, the subscriber never clears or changes CRM Person fields. `person_entity_id` is linkage only, not authority to mutate that root or strip its history; a linked `customers:person` belongs to C4's related-subject review, exclusions and hold guard and is changed only by its customers owner when independently authorized. Ownership validation remains inside attachments; only durable pending-deletion draining runs after commit. Keep other deal fields and files. Persist cleanup progress for retry and do not call success until all tracked work has completed. Replayed events for a cleaned map are no-ops. If a submission event is delivered after its erasure, the reader returns erased state and the projection subscriber creates no new person, deal or file. Projection and erasure serialize on the map to prevent in-flight projection restoring a file after cleanup.

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
- `person_entity_id` nullable UUID records the linked Person only; `projected_attachment_ids` UUID array, `projected_cf_keys` string array and `projected_label` boolean record only the deal-side projection fields/files this subscriber may clear under R5-6; no copied answers or label text
- `erasure_status` internal `pending | complete` nullable, to make both subject-driven reasons and redelivery resumable; not a user-editable form
- **`@Unique(['tenant_id','submission_id'])`** — the hard-idempotency boundary.

The map holds pseudonymous person/submission/deal/file ids and field keys, not copied answers; include these identifiers in coverage declarations. No new free-text PII is introduced, so no new encryption field is required. Person/Deal PII is encrypted by `customers`; uploaded files by forms + the attachments store.

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
- Does not build a forms/form-builder module (that is the core `forms` module).
- **ATS-lite only** for the recruitment use case: NO job-requisition/opening entities, candidate↔many-applications, interview scheduling, scorecards, offer management, hiring-team roles, or EEO/compliance reporting. Candidates are CRM people + deals (diverges from ANALYSIS-004-bamboohr's `hr.candidate` by design). High-volume/multi-requisition recruiting → a separate `recruitment` module (larger spec).

### Packaging and rollout

This remains an OSS design. The proposed connector may ship as the official package `@open-mercato/form-to-deals` under `external/official-modules/packages/form-to-deals`; that package does not exist at the reviewed commit. Forms itself is already a core module, not an outstanding official-module PR. Declare the actual runtime requirements (`forms`, `customers`, attachments service) and activate them in the same app. No official-module pointer is changed by this specification revision.

Additive entities, migrations/snapshots, ACL features, commands and consumed optional event property preserve public contracts. Existing tenants sync new ACL grants. Requires the forms projection reader, content-ai erasure mode and R3-6 emitters; do not roll out a reason-dropping consumer. Missing reason remains a compatibility no-op. There is no data backfill for an unimplemented connector. Binding edits/deletes preserve `updatedAt` optimistic locking and existing guards. Each mutating child call uses that child's version, not the binding's version.

## Implementation Plan

### Phase 1: Module skeleton + binding config
1. Scaffold `form_to_deals`: `index.ts` (`requires: ['customers', 'forms', 'attachments']`), `acl.ts`, `setup.ts`, `di.ts`, i18n. `yarn generate` + `yarn mercato auth sync-role-acls`. → verify: typecheck.
2. `FormToDealBinding` entity + zod validators + `makeCrudRoute` + `api/openapi.ts` + binding commands; migration + snapshot. → verify: CRUD test (response returns `updatedAt`).
3. Binding settings page (`DataTable` + `CrudForm`, form/pipeline/stage/consent pickers, optimistic locking). → verify: UI test + ds-guardian.

### Phase 2: Submission → deal subscriber
4. `FormToDealSubmissionMap` entity (unique `(tenant, submission)`, `status`/`deal_id`/`cv_attached`) + migration.
5. Persistent subscriber on `forms.submission.submitted`: system ctx from the submission row; `formsProjectionService.readSubmitted`; resolve binding via `formVersion.formId`; resolve channel; consent gate; assert firstName/lastName/email; UPSERT map `pending` (first write); dedupe via `findPeopleByAddresses` else `customers.people.create`; `customers.deals.create` (+ `deal_label`, `cf.*`); UPDATE map `linked`; emit `form_to_deals.deal.created`. Handle 23505 → resolve to existing `deal_id`; redelivery with `pending`/no `deal_id` → reconcile. → verify: submit→deal + replay (no dup) + crash-between-commits reconcile + consent=false → no deal.
6. File projection (only if `linked` and `cv_attached=false`): extract `FileAttachmentRef[]` via `readFileRefs`; forms `AttachmentService.readUpload` supplies bytes. Use the public `attachmentService.createScoped` DI contract with owner/assignment for `customers:customer_deal`, carrying both scope fields together; never construct attachment entities or storage drivers from this module. Persist projected attachment ids/field keys/person id before marking file projection complete; set `cv_attached=true`. Handle empty array + multi-file. → verify: file on deal Files tab; replay re-runs only the file step.

### Phase 3: GDPR + hardening + docs
7. First characterize retention/missing no-op in `__tests__/anonymized-reason.characterization.test.ts`, then add the erasure case. Erasure subscriber on `forms.submission.anonymized`: handle `request` and `erasure`, acknowledge `retention`/absence without writes. Serialize projection and erasure on the scoped map, check erased state before every new projection write, clear only tracked deal `cf.*` answers and the deal label it wrote through owning services, and release only projected deal files through C4's exact scoped `releaseByIds` call above, carrying origin and the current `{ em }` transaction. R5-6 forbids any CRM Person field change by this subscriber; leave that related subject to C4's reviewed customers-owner path, exclusions and hold guard. The forms anonymize service already clears inline uploads; its erasure mode clears all answers. Plan every affected deal/file and edited map record identity before cleanup, including shared records; do not add the linked Person or its history solely because the map names it. Call the erasure spec's **DEC-B — The audit-history strip routine** (`actionLogService.applyRetention`) before the first cleanup write and after cleanup with `includeSubjects` and `includeRecords`, following **R3-1 — The audit-history rule for every erasure**; exhaust pages and refuse unplanned identities before mutation. Keep the durable identity plan for crash retries and write no cleared-value snapshots. Persist `erasure_status` and retry failed cleanup/drains. Verify both active reasons and duplicate delivery; `retention`/missing reason leave all projections unchanged.
8. Error policy (diverges from the consent-projector's swallow-all): rethrow → retry for transient failures (file fetch/store, deal create); terminal ack for no/inactive binding, consent=false, missing required fields (mark `skipped`). Spam/flooding mitigation (Risks). Channel setup doc (link to `/f/<slug>`; JJIT external apply URL; recruitment use-case walkthrough). → verify: full suite + ds-guardian.

### Testing Strategy
- `anonymized-reason.test.ts`: unit table covers exactly `request`, `erasure`, `retention` and absence, with scope, retries, duplicate delivery, tracked deal fields/files and retained unrelated fields/files. Both active reasons leave Person fields and history unchanged for newly created and deduplicated people, including an excluded or held related person (R5-6). `projection-erasure-race.test.ts` pauses projection before file write, erases, and proves no late file appears.
- `TC-PRIVACY-FORMS-DEALS-001`: self-contained integration creates two tenants, binding, form/distribution, submission, linked Person/deal, mapped answers and projected/unrelated files. Include a pre-existing Person reused by deduplication. Exercise both request route and privacy erasure event, await persistent delivery, assert only projected deal answers/label and projected downloads are gone, while Person fields/history and unrelated deal fields/files survive. Exercise C4 with the linked person excluded and, with the enterprise guard, held; the subscriber still changes no Person fields. Assert replay no-op, retention/missing reason no writes and second tenant unchanged; delete all surviving fixtures/files in `finally`. Binding list/edit/delete UI tests cover localized errors and optimistic-lock conflicts.
- Integration: submit → deal in bound pipeline + linked person (by `entityId`) + file attachment; replay → no dup; crash after deal commit before map update → reconcile; consent=false → no writes; missing email/lastName → no partial deal; binding CRUD + optimistic-lock conflict; anonymize through the route (`request`) and privacy erase (`erasure`) → only mapped deal answers, the deal label it wrote and projected files cleared, with CRM Person fields unchanged (R5-6); the retention worker called in process (`retention`) → Person and deal file unchanged; a recruitment-binding case (deal_label + `cf.*`) and a non-recruitment binding (lead pipeline) to prove generality. Every scenario owns fixtures and cleans surviving records/files in `finally`. Assert linking by `personId` (not `entityId`) is rejected.

## Delta — R3-6 propagation

#### MODIFIED Requirement: Subject-driven projection erasure
The subscriber SHALL clear only the projections it created on the deal for `request` and `erasure`: mapped deal `cf.*` answers, its copied deal label and CV/file attachments (R5-6). It SHALL never change CRM Person fields; C4's related-subject review, exclusions and hold guard govern that root through the customers owner. It SHALL acknowledge `retention` or missing reason without writes.

##### Scenario: Program erasure
- WHEN the privacy erasure run emits `forms.submission.anonymized` with `reason: erasure`
- THEN the persistent subscriber clears only mapped deal answers, the deal label it wrote and projected files as it does for `request`, with retries and idempotent redelivery; linked Person fields remain unchanged

##### Scenario: A deduplicated Person is excluded or held
- WHEN either active reason reaches a map linked to a pre-existing CRM Person who is excluded from the erasure run or protected by a hold
- THEN cleanup changes only the subscriber's deal-side projections and never that Person's fields or history

##### Scenario: Age-based cleanup
- WHEN the event has `retention` or no reason
- THEN no Person, deal or attachment is changed

Frozen by: the planned connector's `__tests__/anonymized-reason.characterization.test.ts`, first pinning the prior retention/missing no-op before adding the erasure case.

## Risks & Impact Review

#### Crash between deal commit and map update → duplicate deal
- **Scenario**: `customers.deals.create` commits in its own transaction; the map UPDATE then fails. Redelivery finds no `linked` map → second deal.
- **Severity**: High — **Mitigation**: write the map row `pending` BEFORE `deals.create`; redelivery with `pending`/no `deal_id` reconciles; unique `(tenant, submission)` + 23505→resolve handles concurrency. — **Residual**: brief self-healing reconcile window.

#### Consent not given but deal created
- **Scenario**: forms `submit()` does no consent validation and emits unconditionally; the consent projector handles only SIGNATURE fields, so a boolean consent yields no record/gate.
- **Severity**: Critical (legal) — **Mitigation**: subscriber reads `field_map.consentFieldKey`; absent/false → ack & ignore, mark `skipped`, no writes; `consentFieldKey` required in validation. — **Residual**: depends on correct binding config; covered by a test.

#### GDPR erasure does not propagate
- **Scenario**: forms erasure clears inline uploads and answers, but an ignored `erasure` reason would leave projected deal fields and copied files untouched.
- **Severity**: Critical (legal) — **Mitigation**: R3-6 subscriber handles both subject-driven reasons, clears only tracked deal-side projection fields and files through owning services under R5-6, and retries transient failures. — **Residual**: projection cleanup is asynchronous; a controller must inspect persistent delivery completion/failures. Event enqueue alone does not prove copied files are gone; CRM Person erasure requires its own reviewed C4 path.

#### Projection cleanup changes an excluded or held CRM Person
- **Scenario**: email deduplication linked the submission to a pre-existing Person, and the subscriber treats `person_entity_id` as authority to clear that root after a portal-user or identifier erasure.
- **Severity**: High — **Mitigation**: R5-6 limits both active reasons to the connector's deal-side copies; Person fields and history stay outside its cleanup plan. C4's related-subject review, exclusions and hold guard govern the customers-owner path. Unit and integration cases preserve newly created, deduplicated, excluded and held people. — **Residual**: Person PII remains until separately authorized erasure by its owner.

#### Form retention erases CRM records in bulk
- **Scenario**: scheduled forms retention emits `forms.submission.anonymized` for every expired submission, and the erasure subscriber treats each as an erasure request.
- **Severity**: High — **Mitigation**: the subscriber acts only on `reason` in `{request, erasure}`; `retention` and an absent reason are acknowledged with no writes; covered by unit and integration tests. — **Residual**: none for this module; CRM records follow CRM retention.

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
- **Severity**: Critical — **Mitigation**: derive org/tenant ONLY through the forms service from its persisted submission; `syncDealPeople` + `assertAttachmentScopeInvariant` reject mismatched/partial-null scope. — **Residual**: none beyond platform guarantees.

#### Partial file-attachment failure
- **Severity**: Medium — **Mitigation**: the file step is gated on `cv_attached=false` and re-runs on retry WITHOUT recreating the deal; attachment-exists check prevents dupes. — **Residual**: deal exists briefly without the file until retry.

## Final Compliance Report — 2026-06-17 (revised)

### AGENTS.md Files Reviewed
- root `AGENTS.md`, `packages/core/AGENTS.md` (commands, events, encryption, API routes incl. openApi + ACL grant sync), `customers/AGENTS.md`, `attachments/AGENTS.md` (scope invariant), `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/ui/AGENTS.md` + `.ai/ds-rules.md`, relevant core forms service contracts (the historical separate-package guide no longer describes placement).

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | No cross-module ORM relationships | Compliant | Forms via service, customers/attachments via commands; FK ids only |
| root | Filter by organization_id | Compliant | Scope from submission row, passed everywhere |
| root | Optimistic locking on new editable entities | Compliant | Binding `updated_at` + CrudForm; response returns `updatedAt`; map is append-only state |
| core | Export `openApi` from every API route | Compliant | `api/openapi.ts` + export from `bindings/route.ts` |
| core | ACL grant sync for new features | Compliant | `yarn mercato auth sync-role-acls` in Phase 1 |
| attachments | `assertAttachmentScopeInvariant` before persist | Compliant | Enforced inside public attachmentService boundary |
| core | zod validation | Compliant | Binding schemas; `consentFieldKey` required |
| events | Idempotent persistent subscribers | Compliant | First-write `pending` map + unique `(tenant, submission)` + reconcile |
| root | Encryption maps for PII | Compliant (N/A) | Map stores pseudonymous ids and projection metadata, no copied answer values |
| R5-6; C4 | Preserve related-subject boundaries | Aligned | Both active reasons clear only this connector's deal answers/label/files; Person fields/history stay with the reviewed customers-owner path and its exclusions/hold guard |
| root | No hardcoded UI strings / status colors | Compliant | i18n en/pl; semantic tokens |
| .ai/specs taxonomy | OSS vs enterprise placement | Resolved | Stays OSS; forms already in core at reviewed commit |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models ↔ API contracts | Pass | Bindings CRUD ↔ entity; map internal |
| API ↔ UI/UX | Pass | Settings page = bindings CRUD; no public route |
| Risks cover all writes | Pass | Deal/person/attachment/map + erasure |
| Idempotency covers at-least-once + crash | Pass | First-write `pending` map + reconcile + 23505 |
| Consent + erasure addressed | Pass | Consent gate + R3-6 subscriber for both subject-driven reasons; R5-6 deal-only cleanup preserves the Person root; retention/missing no-op |

### Verdict
- **Ready after must-fixes (applied)** — requires same-app activation and the planned trusted projection reader/erasure contracts; no implementation approval is implied.

## References (checked against the spec checkout)

- `packages/core/src/modules/forms/index.ts`: core placement, MIT metadata and dependencies. `events-payloads.ts`: submitted/anonymized event ids; today's anonymized event has no reason yet. `services/submission-service.ts`: `getCurrent`, role slicing and restricted `unsliced` path; `services/anonymize-service.ts`: inline upload bytes are already cleared. `services/attachment-service.ts`: `readUpload`; `schema/file-field.ts`: `FileAttachmentRef`/`readFileRefs`.
- `packages/core/src/modules/customers/commands/{people,deals}.ts`: create results and customer entity ids; `data/validators.ts`: separate non-empty first/last names. `lib/findPeopleByAddresses.ts`: equality fast path and at most 500 recent decrypting candidates. B1 Phase D supplies the planned lookup-hash improvement; it is not current code.
- `packages/core/src/modules/attachments/lib/attachment-service.ts`: public scoped creation/read/release contracts; `packages/core/src/modules/attachments/AGENTS.md`: no peer entity/storage fallback.
- `2026-11-16-privacy-coverage-content-ai.md`: R3-6, erasure mode and projection-reader dependency. `2026-11-16-privacy-subject-erasure.md`: R3-1 history and transactional file-release seam. `2026-11-16-forms-retention-scheduling.md`: age-based emitter uses `retention` and cites R3-6.

## Changelog
### 2026-06-17
- Renamed/generalized from `candidate_intake` to **`form_to_deals`** — a generic Forms→CRM-deal bridge; recruitment (ATS-lite) is now the primary documented use case, not the module identity (also serves lead/partner/RFP intake).
- Packaging decision: ships as an **official module** `@open-mercato/form-to-deals` (a module, NOT an integration-provider), tracking `forms` (dependency direction forces official, not core, while forms is official). Single official-modules PR after forms #23 publishes.
- (Earlier same day) re-pointed from a Webflow inbound-webhook adapter to the core `forms` module; applied 8 adversarial-review must-fixes (`findPeopleByAddresses` not a fabricated helper; CV read/write split; consent gate; erasure propagation; crash-safe first-write idempotency map; openApi/ACL-sync; clarified anonymous-token principal); added multi-channel attribution (JustJoin.IT/Webflow/OM); resolved placement (OSS, forms→core per OM team); confirmed JJIT external apply URL; reaffirmed ATS Non-Goals.

### 2026-11-16 — council review fixes
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g5-04 — the erasure subscriber on `forms.submission.anonymized` acts only when `reason` is `request` and acknowledges `retention` or an absent reason with no writes, so scheduled forms retention cannot erase CRM records in bulk; consumed-event shape, Phase 3 step 7, tests, a risk and the consistency check updated.

- Council round two fixes (GPT-6.1 Sol workers): r0-01 — R3-6 handles `request` and `erasure`, types the exact enum, preserves retention/missing no-op, clears mapped deal answers/label and tracked files, and tests privacy-run propagation, retries and races; current-code drift corrected for core forms placement, role-sliced reads, inline upload clearing and attachment service access.

- Council round two fixes, pass two (GPT-6.1 Sol workers): confirmed the already-aligned R3-6 exact optional enum and both subject-driven branches; updated forms-retention/emitter references and the full cleanup history plan/two-pass contract.

- Council round two fixes, pass three (GPT-6.1 Sol workers): rechecked R3-6 against content-ai and forms-retention emitters, retained both subject-driven reasons and retention/missing no-op, and pinned projection-file cleanup to C4’s exact owner-checked release signature/current transaction and post-commit drain.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): apply R5-6 to both active reasons, limiting cleanup and history plans to this connector's deal answers, label and CV/files; preserve CRM Person fields/history under C4's related-subject review, exclusions and hold guard, with matching tests, risks and compliance.
