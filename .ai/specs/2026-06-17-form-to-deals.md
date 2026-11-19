# Form-to-Deals — generic Forms→CRM-deal intake bridge (`form_to_deals` module)

> **Status:** Draft — revised after adversarial review (2026-11-16, 2026-11-17). A generic connector that projects core `forms` submissions into `customers` CRM deals. **Recruitment / ATS-lite is the primary documented use case** (see Use Cases), but the module itself is use-case-agnostic. Existing and planned consumed contracts are distinguished below and checked against the spec checkout.

## TLDR

> **Positioning:** a thin, generic **Forms→deal bridge** — on `forms.submission.submitted` it creates a CRM `Person` + `Deal` in an admin-configured pipeline, with field mapping, CV/file attachment, consent gating, idempotency, and per-channel source attribution. Recruitment (an ATS-lite candidate funnel) is the lead use case; the same module serves lead/partner/RFP intake by binding a different form to a different pipeline.

**Key Points:**
- Host the intake form natively in OM using the core `forms` module (public token-based distribution, `file` upload field, consent), surfaced from any channel via a link to the hosted form `/f/<slug>` (Webflow page, JustJoin.IT listing, an OM careers/landing page).
- Add a thin module, `form_to_deals`, that subscribes to `forms.submission.submitted`, reads decoded answers through the trusted forms projection service, gates on consent, and projects each submission into a CRM `Person` + `Deal` in the bound pipeline, attaching uploaded files.
- No third party, no exposed API key, no Webflow plan upgrade; all data in-stack, envelope-encrypted.

**Scope (MVP):**
- A `form_to_deals` module: a form→pipeline **binding** (config + UI), a crash-safe idempotent subscriber on `forms.submission.submitted`, consent gating, person-dedupe-by-email, deal creation in the bound pipeline/stage, file-attachment projection, and **per-channel source attribution** (one form, many open distributions, each tagged on the deal).
- A GDPR erasure-propagation subscriber on `forms.submission.anonymized`, acting when the event's `reason` is `request` or `erasure` (R3-6), plus an awaited cleanup hook that a C4 erasure run calls, so the run is not complete until the deal-side copies are gone.
- Placement: core module `packages/core/src/modules/form_to_deals`, shipped in `@open-mercato/core` (see Packaging and rollout).
- en + pl i18n; integration tests; optimistic locking on the binding form.

**Out of scope (deferred):**
- The core `forms` module itself (consumed here).
- AI scoring (emit `form_to_deals.deal.created`; a follow-up spec adds a scoring subscriber on `customers.deal.created`).
- A visual field-mapping editor (MVP uses fixed-core mapping + a small JSON map).
- Full-ATS entities (job requisitions, interviews, scorecards, offers) — see Use Cases / Non-Goals.

**Concerns (verified):**
- At the reviewed commit, `forms` is already in `packages/core/src/modules/forms` with MIT metadata and core dependencies (`index.ts`); `form_to_deals` is not implemented. It is placed beside it in core. Enable forms in the SAME OM app as the CRM. Historical PR #23 packaging notes in the Changelog no longer describe current placement.
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
4. **Project on submit:** a persistent, state-tracked subscriber on `forms.submission.submitted` resolves the binding via `formVersion.formId`, resolves the channel (`submission.subjectId`→`FormInvitation.distributionId`→`channel_map`), reads decoded answers through the trusted forms projection service, gates on consent, dedupes by email through the customers-owned `customerPersonMatchService` or creates a `Person`, creates a `Deal` in the bound pipeline/stage (resolved channel as `source`, `deal_label` stamped, mapped `cf.*`), attaches files, and records progress in a `submissionId`-keyed map.
5. **Propagate erasure:** on `forms.submission.anonymized` with `reason` `request` or `erasure`, and synchronously when a C4 erasure run calls the module's registered downstream cleanup for the submissions it changed, the connector removes only the projections it created on the deal: mapped deal `cf.*` answers and projected CV/file attachments, through owning services via the map (R5-6). It replaces an unedited projected title with the fixed placeholder `form-submission-<short id>`; a title staff have edited is retained and reported as `title_retained_edited`. It never changes CRM Person fields, including when it created that Person; a linked `customers:person` is a related subject handled by C4's review/exclusions and hold guard through the customers owner. A `retention` reason, or none, is acknowledged with no writes: a form's retention period governs the submission, not CRM records, and scheduled retention emits the event in bulk (R3-6 below, also cited by the forms-retention spec).

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Generic `form_to_deals` module; recruitment is a use case | The connector is use-case-agnostic (form→deal + mapping); naming it after recruitment would under-sell its reuse (lead/partner/RFP intake). |
| Consume the core `forms` module; do not build form capture | Already does anonymous capture, upload, encryption, GDPR. |
| Events + commands + DI services only, no direct ORM links | Reads forms via the proposed `formsProjectionService` (by id) + files via the forms `AttachmentService`; matches people through the customers-owned `customerPersonMatchService`; writes deals/people via `customers.*` commands; the deal file row via `attachmentService.createScoped`. Never imports customers `lib/` code or queries customers tables. |
| Core placement | Forms and customers are both core modules; a connector between two core modules belongs in core, with no submodule, package or pointer change. |
| Deal title is `<label> – <short id>`, never a name | `dealCreateSchema` requires a non-empty title; a name in it would be Person data the connector may not erase (R5-6). |
| forms + form_to_deals + customers run in ONE OM app | Same instance (= Dispatch CRM) → in-process `customers.*` writes; no public CRM API, no cross-system sync. |
| Separate firstName/lastName form fields | `personCreateSchema` requires non-empty first AND last; a single `fullName` split risks an empty lastName → ZodError → no deal. |
| Idempotency map is the FIRST durable write | Commit the `pending` map before creating any deal. The customers owner then commits a unique scoped source reference with the deal so projection recovery and erasure can always find the exact deal. |
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
     6. customerPersonProjectionService.createOrGet({ scope, sourceSubmissionId, personInput }) → entityId; resolve the durable source binding before email matching or creation
     7. Persist immutable projected_cf_keys, projected_title_digest and person_entity_id on pending map, then customerDealProjectionService.createOrGet({ scope, sourceSubmissionId, dealInput }) → dealId
     8. UPDATE map row: deal_id=dealId, status='linked'
     9. per file FileAttachmentRef whose id is not yet in map.projected_files.sourceAttachmentId: readUpload → attachmentService.createScoped whose persistLink appends { sourceAttachmentId, attachmentId } to the map row in the attachment transaction; when every ref is recorded set map.cv_attached=true
    10. emit form_to_deals.deal.created { dealId, submissionId }

   form_to_deals erasure subscriber on forms.submission.anonymized { submissionId, reason? }
     → reason not in {'request', 'erasure'}: ack, no writes
     → resolve exact deal by customers-owned source reference even if map is pending, then clear only projected deal cf.* answers + replace an unedited projected title with form-submission-<short id>
       (edited title retained, reported title_retained_edited) + release tracked deal CV/file attachments (R5-6)
     → never change the linked Person; C4 handles that related subject through its customers owner

   form_to_deals privacy.ts downstreamCleanup 'form_to_deals.deal_projections' (called and awaited by a C4 run)
     → plan({ scope, recordIds }) → history identities and exact deal/file/map write intents (≤ 500 submission ids per call)
     → run({ scope, recordIds, origin, attachmentOrigin, plannedWrites, assertApprovedWrites }) → verify locked targets before cleanup and return { pending, failed }
```

- **No direct ORM links** to `forms` or `customers`. **System ctx:** the forms-owned `formsProjectionService.readSubmitted({ submissionId })` resolves tenant/organization from its own row and returns submission/version/distribution and full decoded answers only to this trusted in-process subscriber. This is a new sanctioned reader, not a public route. Today `getCurrent` without a viewer role returns empty decoded data (`services/submission-service.ts`); the `unsliced` option is restricted to its existing trusted use. Do not bypass that restriction or read forms tables from the connector. The reader must include an access-audit entry with the internal projection purpose and no copied answers.

### Commands & Events
- **Reused (verified):** `customers.people.create` → `{ entityId, personId }` (link by **`entityId`**, not `personId`); `customers.deals.create` → `{ dealId }`, accepts `{ title, pipelineId, pipelineStageId, source, personIds }` (+ `cf.*` via custom-field input; `title` is a required non-empty string in `dealCreateSchema`); `attachmentService.createScoped` with its `persistLink(tx, attachmentId)` callback, which runs inside the attachment's own transaction (`attachments/lib/attachment-service.ts`); forms `AttachmentService.readUpload` and `readFileRefs`.
- **New customers-owned DI service:** `customerPersonMatchService.findPersonIdsByEmail({ scope: { tenantId, organizationId }, email }): Promise<string[]>`, registered in `customers/di.ts` and implemented inside customers over its existing `lib/findPeopleByAddresses.ts` (same equality fast path and 500-candidate decrypting window). It validates the scope UUIDs and email with zod and returns matching person `entityId`s, most recent first, never an address or other field. The connector resolves it softly; when it is absent the subscriber rethrows for retry rather than creating an unmatched duplicate. Unit test `customers/lib/__tests__/personMatchService.test.ts` covers scope isolation, normalization and the ids-only result. Neither the connector nor any other module imports `findPeopleByAddresses` or queries customers tables. New dependency: forms-owned `formsProjectionService.readSubmitted`, specified by the content-ai coverage spec; ordinary `getCurrent` is role-sliced and is not a full-data reader for this subscriber.
- **Consumed events:** `forms.submission.submitted` `{ submissionId }`, `forms.submission.anonymized` `{ submissionId, reason?: 'request' | 'erasure' | 'retention' }` (reason is added by the retention/content-ai specs; R3-6 defines the exact enum, and this module requires first-party emitters to send it).
- **New commands:** `form_to_deals.binding.create` / `.update` / `.delete`.
- **New event (stub):** `form_to_deals.deal.created` `{ dealId, submissionId }`.
- **Customers-owned Person recovery.** `customerPersonProjectionService.createOrGet({ scope: { tenantId, organizationId }, sourceSubmissionId, personInput }): Promise<{ entityId }>` first resolves the exact source binding, then performs the existing customers-owned email match or ordinary Person creation only if absent. Serialize by the unique scoped source key inside the customers transaction. Commit the selected/new Person binding in `customer_person_form_projections` atomically with any Person creation, preserving command validation, audit and after-commit side effects. Concurrent deliveries return the winner without another Person or duplicate side effects. The owner’s `find({ scope, sourceSubmissionId })` returns the exact `entityId` or explicit absence, including a binding whose Person is subsequently deleted; a retired target never permits recreating a Person from a replayed submission. It does not use current email, the bounded matcher or connector map state for recovery. Both services are internal DI seams, validate UUID scope/input with zod and expose identifiers only. The connector copies the committed `entityId` into its pending map in the next step, but that copy is not the recovery authority. Related-subject discovery asks this owner even when the pending map lacks `person_entity_id`; the binding identifies a separately reviewed C4 subject and never authorizes clearing Person data. Unavailable or inconsistent recovery is incomplete, never absence.
- **Customers-owned projection recovery.** Add an internal `customerDealProjectionService` in customers. `createOrGet({ scope, sourceSubmissionId, dealInput })` reuses the ordinary deal command’s validation, mutation and side effects, and returns `{ dealId }`. Commit a `customer_deal_form_projections` record with the deal creation and its mapped custom values in the same customers transaction. The record contains a UUID primary key, tenant id, organization id, source submission id, deal id and timestamps. A unique `(tenant_id, organization_id, source_submission_id)` boundary makes a parallel create return the committed winner without applying either creation or side effects twice. Both the command and connector keep their established APIs. The internal `find({ scope, sourceSubmissionId })` returns the exact durable deal id or an explicit absent result and includes bindings to soft-deleted deals. Scope mismatch, inconsistent state or an unavailable lookup leaves the operation incomplete. Never infer the deal from title, email, custom values or Person. The connector releases its lock only after the customers outcome is durable. Before permitting deal creation, it has committed the exact field key set, original title digest and Person linkage on its own `pending` map. Resolve the customers binding first on retry. Update the pending metadata for a changed creation plan only under the map lock after the customers owner confirms that no binding or deal committed. When a customer deal is deleted, keep the binding as replay and history evidence for as long as that submission can be replayed.
- **Downstream erasure cleanup.** `privacy.ts` declares `downstreamCleanup: [{ id: 'form_to_deals.deal_projections', sourceEntity: 'forms:form_submission', plan, run }]` using C4’s shared `PrivacyDownstreamCleanup`. C4 supplies at most 500 exact changed submission ids per call. Planning reads scoped maps and customer-owned bindings and returns `historyRecords` plus canonical `plannedWrites` for every affected map, deal, eligible title edit and projected file link. An unedited projected title and an independently edited title produce different planned write sets. For apply use the C4-supplied scope, planned writes, origin, attachment origin and `assertApprovedWrites`. Under the shared tenant hold fence, lock the map and affected copies and ask the customers and attachments owners for their exact existing binding and affected ids in that owner transaction. Recompute the proposed write identities/dispositions and invoke the callback before any strip, deal/map write or release. Do not use submission ids alone or resolve new binding targets outside the approved write set. A changed or unavailable customer binding or newly discovered copy remains pending without writes. An explicitly absent binding on a pending row means that no deal committed. After commit drain only file locators from the approved release through C4’s scoped attachment service. Return bounded `{ pending, failed }` counts. C4 stays incomplete when projected copies remain pending. The standalone request subscriber builds and verifies its own run- and scope-bound exact plan using the same owner routine. Its work is idempotent with the hook via `erasure_status`; it cannot supersede a current C4 reviewed plan.

### R3-6 — The form-to-deals reason set

The form-to-deals erasure subscriber acts on `reason` in `{request, erasure}`. Both are subject-driven. It acknowledges `retention`, or a missing reason, with no writes. The C4 downstream cleanup hook needs no reason: C4 calls it only for submissions its own erasure run changed. The `forms.submission.anonymized` payload's `reason` enum is exactly `request | erasure | retention`; the property remains optional for compatibility. Apply the same set to validation, dispatch and retry handling. The content-ai coverage spec, "R3-6 — The form-to-deals reason set", owns the matching erasure emitter; the forms-retention spec cites the same decision and its worker emits `retention`.

For both active reasons and the C4 hook, one cleanup routine runs. Scope comes from the forms-owned reader and stored map. Resolve the exact projected deal through the customers-owned reference, including a `pending` map with no copied deal id. An already-erased forms submission never invokes create or republishes a projection event, even when an old delivery arrives before recovery normalizes the map. Clear every tracked deal `cf.*` answer key regardless of later staff edits: those keys exist on this submission's own deal to hold the subject's answers, so a staff-edited value there is still data about the subject. The title is treated differently, because staff often rename deals: replace it with the fixed placeholder `form-submission-<short id>` only while its SHA-256 still equals the stored `projected_title_digest`; an edited title is retained and the cleanup result reports `title_retained_edited` for staff review. Then release only this projection's file ids through C4's `attachmentService.releaseByIds(ids, scope, { expectedEntityId: 'customers:customer_deal', expectedRecordId: dealId, origin }, { em })`, passing the current database transaction's manager and preserving the run origin. Under R5-6, the subscriber never clears or changes CRM Person fields. `person_entity_id` is linkage only, not authority to mutate that root or strip its history; a linked `customers:person` belongs to C4's related-subject review, exclusions and hold guard and is changed only by its customers owner when independently authorized. Ownership validation remains inside attachments; only durable pending-deletion draining runs after commit. Keep other deal fields and files. Persist cleanup progress for retry and do not call success until all tracked work has completed. When `erasure_status` becomes `complete`, clear the row's `person_entity_id`, `projected_files`, `projected_cf_keys` and `projected_title_digest` in the same transaction, keeping only `submission_id`, `deal_id`, `status` and `erasure_status` so replays stay no-ops. After the retry budget a row is `failed`, and both the C4 report and the binding page show it. Replayed events for a cleaned map are no-ops. If a submission event is delivered after its erasure, or after any anonymization including `retention`, the reader returns anonymized state and the projection subscriber creates no new person, deal or file.

**Rollout gate for the reason and projection writes.** Today's retention worker and anonymize route emit no `reason` (`forms/workers/retention-purge.ts`), and a reason-less event is a deliberate no-op. The connector therefore ships in a release after the one that carries the R3-6 emitters (forms-retention Phase 1 event compatibility and Content-AI Phase 1 erasure mode), never in the same release: no process of the connector's first release can emit a reason-less subject event, and no persistent delivery to it predates its subscription. A C4-driven erasure is cleaned through the awaited hook whatever the event carries. Projection and erasure serialize on the map to prevent in-flight projection restoring a file after cleanup. Phase 2 ships inert projection logic with no production subscriber registration and no production entry point that creates a person, deal or copied file. In Phase 3 register both cleanup paths and enable production projection creation in the same release, with required tests passing and all processes carrying the cleanup registry before enabling creation. In mixed deployments keep creation disabled until that cutover. If a pre-release deployment already created projections, keep creation disabled, enumerate scoped map rows including pending entries, resolve each customers-owned binding, and use the awaited cleanup and both history passes for erased/request-anonymized sources. Refuse activation while a binding, expected source or cleanup outcome is unresolved. Treat missing source state conservatively as unresolved, and preserve intentional age-retention no-op.

## Data Models

### FormToDealBinding (singular) — table `form_to_deals_bindings`
- `id` uuid PK, `organization_id`, `tenant_id`
- `form_id` uuid (FK id to a forms `Form`; resolution hops submission → `formVersion.formId`)
- `form_label` text nullable (display only)
- `pipeline_id` uuid, `pipeline_stage_id` uuid (validated as a same-tenant pair at save)
- `source_label` text default `'Form'` (fallback when no channel match)
- `channel_map` jsonb nullable — `{ [distributionId]: sourceLabel }` (per-channel attribution; resolved via `FormSubmission.subjectId`→`FormInvitation.distributionId`)
- `deal_label` text nullable — the deal title's label part (recruitment use: the open position); never written to a custom field. Title template: `<deal_label> – <first 8 characters of submissionId>`, falling back to `<source_label> – <short id>`; it never contains an answer or a name
- `field_map` jsonb — identity core `{ firstName, lastName, email, phone?, fileFieldKey, consentFieldKey }` (separate first/last; `consentFieldKey` required for every binding) **plus** optional answer-key→`cf.*` mappings (e.g. recruitment `cf_seniority`, `cf_expected_salary`; `cf_candidate_score` reserved for the scoring phase)
- `is_active` boolean default true; `created_at`, `updated_at` (optimistic locking — list/detail responses MUST return `updatedAt`), `deleted_at`
- Unique `(organization_id, tenant_id, form_id)`.

### FormToDealSubmissionMap (singular) — table `form_to_deals_submission_map` — idempotency + state
- `id` uuid PK, `organization_id`, `tenant_id`
- `submission_id` uuid, `deal_id` uuid **nullable** (copy set after deal commit, with the customers-owned recovery binding already durable)
- `status` text — `pending` | `linked` | `skipped`
- `cv_attached` boolean default false, `attempt_count` int default 0, `created_at`, `updated_at`
- `person_entity_id` nullable UUID records the linked Person only; `projected_files` jsonb array of `{ sourceAttachmentId: UUID, attachmentId: UUID }` (copy only `FileAttachmentRef.id`, never its filename, content type, size or the whole object), `projected_cf_keys` string array and `projected_title_digest` nullable SHA-256 hex of the title this projection wrote record only the deal-side projection fields/files this subscriber may clear under R5-6; no copied answers or title text
- `erasure_status` internal `pending | complete | failed` nullable, to make both subject-driven reasons, the C4 hook and redelivery resumable; not a user-editable form
- **`@Unique(['tenant_id','submission_id'])`** — the connector’s idempotency boundary. The customers binding is the authoritative recovery index for a committed deal and has its own scoped uniqueness constraint.

The map holds pseudonymous person/submission/deal/file ids and field keys, not copied answers. No new free-text PII is introduced, so no new encryption field is required.

**Privacy declarations.** `form_to_deals/privacy.ts` declares both tables for C5: `form_to_deals_bindings` as `{ kind: 'tenant_configuration' }`, and `form_to_deals_submission_map` as `reference_only` with a `note` ("Idempotency and erasure-tracking ids for projected deal copies; no answers or names") and `reviewedColumns` reasons for every column: `id`, `organization_id`, `tenant_id`, `submission_id`, `deal_id`, `status`, `cv_attached`, `attempt_count`, `person_entity_id`, `projected_files`, `projected_cf_keys`, `projected_title_digest`, `erasure_status`, `created_at` and `updated_at`. Retention: a row lives as long as its deal's projection can be replayed; once `erasure_status = complete` it keeps only ids and states, as above. The same `privacy.ts` carries the `downstreamCleanup` member. The connector declares no data class: it holds no subject data of its own, and the deal copies belong to customers records reached through the hook. Person/Deal PII is encrypted by `customers`; uploaded files by forms + the attachments store.

Customers also owns `customer_person_form_projections`: UUID `id`, `tenant_id`, `organization_id`, `source_submission_id`, `person_entity_id`, `created_at`, `updated_at`, unique `(tenant_id, organization_id, source_submission_id)`, with FK ids only. Declare it `reference_only` with reviewed reasons for every column and a scoped owner `tableExports` reader in both modes. Keep the binding/tombstone while the source can replay, including after Person erasure, using the same replay-lifetime rule as the Deal binding; it carries no email/name. This recovery entity is internal, not user-editable.

Customers declares its new `customer_deal_form_projections` table as `reference_only` with an explicit rationale and `reviewedColumns` for `id`, `tenant_id`, `organization_id`, `source_submission_id`, `deal_id`, `created_at` and `updated_at`. The table stores only replay and exact history linkage. Register the table’s owner `tableExports` entry and extend the customers tenant reader in both modes alongside the new table.

## API Contracts
CRUD for bindings via `makeCrudRoute` (entity `form_to_deals_bindings`); **every route file exports `openApi`** (`api/openapi.ts` via `buildModuleCrudOpenApi`). No public route added (capture is forms' `/api/forms/public/*`).
- `GET /api/form_to_deals/bindings` — `requireFeatures: ['form_to_deals.view']`; response includes `updatedAt`.
- `POST/PUT/DELETE /api/form_to_deals/bindings` — `requireFeatures: ['form_to_deals.manage']`; zod-validated; optimistic-locked.

## Internationalization (i18n)
- en + pl; UI labels + `t('form_to_deals.errors.*')`; internal-only throws prefixed `[internal]`.

## UI/UX
- One backend settings page: a `DataTable` of bindings + a `CrudForm` (form picker, pipeline + stage pickers, field-map fields incl. consent + `cf.*`, `source_label`, `deal_label`, channel map, active toggle). Shared primitives + semantic tokens; dialog `Cmd/Ctrl+Enter` / `Escape`; optimistic locking (`initialValues.updatedAt`, response returns `updatedAt`).
- The bindings page shows, per binding, the count of submission maps whose erasure cleanup has been pending for over an hour or has `failed`, as counts only, with a translated hint to rerun the C4 erasure or check the event queue.
- Files appear on the existing customers deal **Files** tab (attachment `entityId = E.customers.customer_deal`, `recordId = dealId`).

## Migration & Compatibility

### Non-Goals / scope-outs
- **Supersedes** the Webflow inbound-webhook adapter approach (no provider token, no SSRF-guarded fetch).
- Does not build a forms/form-builder module (that is the core `forms` module).
- **ATS-lite only** for the recruitment use case: NO job-requisition/opening entities, candidate↔many-applications, interview scheduling, scorecards, offer management, hiring-team roles, or EEO/compliance reporting. Candidates are CRM people + deals (diverges from ANALYSIS-004-bamboohr's `hr.candidate` by design). High-volume/multi-requisition recruiting → a separate `recruitment` module (larger spec).

### Packaging and rollout

This is an OSS core module. **Path:** `packages/core/src/modules/form_to_deals`, published in `@open-mercato/core`; no new npm package, no `external/official-modules` package and no submodule pointer change. **Manifest:** `index.ts` with `requires: ['customers', 'forms', 'attachments']`. **Activation:** `{ id: 'form_to_deals', from: '@open-mercato/core' }` beside `forms` and `customers` in `apps/mercato/src/modules.ts`, mirrored in the create-app template with `yarn template:sync:fix`; with no binding the module only acknowledges events. **PR boundary:** one upstream core PR per phase below; Phase 2 also carries the customers-owned `customerPersonMatchService`, and Phase 3 consumes the C4 `downstreamCleanup` member once C4 ships it and activates production projection writes only with both cleanup paths active. Confirm carrier-specific upstream approval under DEC-2 before treating GDPR-dependent OSS work as authorized. The earlier official-module packaging (Changelog, 2026-06-17) is withdrawn because forms is no longer an official module.

Additive entities, migrations/snapshots, ACL features, commands and consumed optional event property preserve public contracts. Existing tenants sync new ACL grants. Requires the forms projection reader, content-ai erasure mode and R3-6 emitters in an earlier release (the rollout gate above); do not roll out a reason-dropping consumer. Missing reason remains a compatibility no-op. There is no data backfill for an unimplemented connector. Binding edits/deletes preserve `updatedAt` optimistic locking and existing guards. Each mutating child call uses that child's version, not the binding's version.

## Implementation Plan

### Phase 1: Module skeleton + binding config
1. Scaffold `packages/core/src/modules/form_to_deals`: `index.ts` (`requires: ['customers', 'forms', 'attachments']`), `acl.ts`, `setup.ts`, `di.ts`, `privacy.ts` (both table declarations), i18n; add the module to `apps/mercato/src/modules.ts` and the template. `yarn generate` + `yarn mercato auth sync-role-acls`. → verify: typecheck and the C5 coverage test.
2. `FormToDealBinding` entity + zod validators + `makeCrudRoute` + `api/openapi.ts` + binding commands; migration + snapshot. → verify: CRUD test (response returns `updatedAt`).
3. Binding settings page (`DataTable` + `CrudForm`, form/pipeline/stage/consent pickers, optimistic locking). → verify: UI test + ds-guardian.

### Phase 2: Inert submission projection implementation
4. `FormToDealSubmissionMap` entity (unique `(tenant, submission)`, `status`/`deal_id`/`cv_attached`/`projected_files`/`projected_title_digest`/`erasure_status`) + migration. Add `customerPersonMatchService` and `customerPersonProjectionService` to `customers/di.ts`, the Person source-binding entity/migration and privacy/export declarations, with owner unit tests. Test a crash after Person commit but before map update, concurrent redelivery and an intervening email edit: all recover the same source-bound Person. Erasure before connector recovery discovers that Person through the owner binding for separate C4 review; a deleted target is never recreated.
5. Implement the persistent subscriber on `forms.submission.submitted` without registering it in production: read the authorized forms projection, resolve the binding, channel and consent, validate required values, and commit the scoped `pending` map. Dedupe or create the Person through customers, save immutable projection keys/title digest/linkage, then create or recover the deal using `customerDealProjectionService`. Set the map `linked` and emit only after checking the submission is still eligible. Once `erased_at` is set, use the same binding in cleanup and never re-create or republish. Add the customers-owned table, snapshot, declaration and reader. Verify replay and concurrent create, both before and after copying `deal_id`.
6. File projection (only if `linked` and `cv_attached=false`): extract `FileAttachmentRef[]` via `readFileRefs`; forms `AttachmentService.readUpload` supplies bytes. Use the public `attachmentService.createScoped` DI contract with owner/assignment for `customers:customer_deal`, carrying both scope fields together; never construct attachment entities or storage drivers from this module. Its required `persistLink(tx, attachmentId)` appends `{ sourceAttachmentId, attachmentId }` to the scoped map row with that `tx`, so the attachment row and its map entry commit together or not at all. A retry compares only UUID `sourceAttachmentId` and skips every source attachment already in `projected_files` and sets `cv_attached=true` only when all refs are recorded. Handle empty array + multi-file. Assert raw map JSON and C8 output contain only the two attachment UUIDs per entry even when the source filename contains a planted person name; reject extra reference properties with the closed schema. → verify: file on deal Files tab; replay re-runs only the file step; a crash injected immediately after the attachment transaction commits leaves the id in the map, the retry creates no second file, and erasure releases exactly that file.

### Phase 3: Register cleanup and activate projections
7. First characterize retention/missing no-op in `__tests__/anonymized-reason.characterization.test.ts`, then add the erasure case and the `downstreamCleanup` `plan`/`run` member once C4 ships it. Erasure subscriber on `forms.submission.anonymized`: handle `request` and `erasure`, acknowledge `retention`/absence without writes. Serialize projection and erasure on the scoped map, check erased state before every new projection write, clear only tracked deal `cf.*` answers and replace an unedited projected title with `form-submission-<short id>` (an edited title is retained and reported `title_retained_edited`) through owning services, and release only projected deal files through C4's exact scoped `releaseByIds` call above, carrying origin and the current `{ em }` transaction. R5-6 forbids any CRM Person field change by this subscriber; leave that related subject to C4's reviewed customers-owner path, exclusions and hold guard. The forms anonymize service already clears inline uploads; its erasure mode clears all answers. Plan every affected deal/file and edited map record identity before cleanup, including shared records; do not add the linked Person or its history solely because the map names it. Call the erasure spec's **DEC-B — The audit-history strip routine** (`actionLogService.applyRetention`) before the first cleanup write and after cleanup with `includeSubjects` and `includeRecords`, following **R3-1 — The audit-history rule for every erasure**; exhaust pages and refuse unplanned identities before mutation. Keep the durable identity plan for crash retries and write no cleared-value snapshots. Persist `erasure_status` and retry failed cleanup/drains; after the retry budget mark `failed`, and show pending-over-an-hour and failed counts on the binding settings page. Verify both active reasons, the C4 hook and duplicate delivery; `retention`/missing reason leave all projections unchanged. Test a binding, title disposition or file locator changed after planning and a same-count replacement. Assert it remains intact and receives no history strip or release. Test C4/subscriber retries after a partial committed cleanup using the original approved identities.
8. Activate the producer only once both cleanup registrations, the deployment cutover and `TC-PRIVACY-FORMS-DEALS-001` are complete. Tests exercise the inert Phase 2 composition, mixed-release refusal, and reconciliation of a pending old map whose source is already erased. Error policy (diverges from the consent-projector's swallow-all): rethrow → retry for transient failures (file fetch/store, deal create); terminal ack for no/inactive binding, consent=false, missing required fields (mark `skipped`). Spam/flooding mitigation (Risks). Channel setup doc (link to `/f/<slug>`; JJIT external apply URL; recruitment use-case walkthrough). → verify: full suite + ds-guardian.

### Testing Strategy
- `anonymized-reason.test.ts`: unit table covers exactly `request`, `erasure`, `retention` and absence, with scope, retries, duplicate delivery, tracked deal fields/files and retained unrelated fields/files. Both active reasons leave Person fields and history unchanged for newly created and deduplicated people, including an excluded or held related person (R5-6). A rolling-deploy case delivers a reason-less event for a submission with live projections and asserts no writes, then runs the C4 hook for the same submission and asserts cleanup. A staff edit case changes a tracked `cf.*` value and the title before erasure: the `cf.*` key is cleared, the edited title is retained and reported as `title_retained_edited`, and an unedited title becomes `form-submission-<short id>`. `projection-erasure-race.test.ts` pauses projection before file write, erases, and proves no late file appears. `downstream-cleanup.test.ts` covers `plan` identities, `run` counts, a stalled cleanup (`pending` > 0) and a failed row, each leaving the C4 result `incomplete` with `downstream_cleanup_pending`, and a later rerun completing. It also covers 501 submission ids split by C4 into calls of at most 500 and a 501-id call refused by the connector; a submission projected after the first `plan` and before its `erased_at`, whose copy is planned by the second `plan`, or, when `run` reads it unerased, left untouched and counted in `pending`; and a released projected file whose stored object is not yet deleted, counted in `pending` until a rerun drains it. `projection-files.test.ts` injects a crash after the attachment transaction commits and before the subscriber resumes.
- `TC-PRIVACY-FORMS-DEALS-001`: self-contained integration creates two tenants, binding, form/distribution, submission, linked Person/deal, mapped answers and projected/unrelated files. Include a pre-existing Person reused by deduplication. Exercise both request route and privacy erasure event, await persistent delivery, assert only projected deal answers and projected downloads are gone and the unedited projected title is now `form-submission-<short id>`, while Person fields/history and unrelated deal fields/files survive. Exercise C4 with the linked person excluded and, with the enterprise guard, held; the subscriber still changes no Person fields. With the persistent subscriber's queue left undrained, the C4 run still reports the deal copies cleared through the awaited hook; with the hook made to fail, the run result is `incomplete` with `downstream_cleanup_pending` and its counts. Assert replay no-op, retention/missing reason no writes and second tenant unchanged; delete all surviving fixtures/files in `finally`. Binding list/edit/delete UI tests cover localized errors and optimistic-lock conflicts.
- Integration: submit → deal in bound pipeline + linked person (by `entityId`) + file attachment; replay → no dup; inject a crash after the customers transaction commits but before the connector copies the deal id. In one run, deliver the event again and assert one deal. In a second run, apply C4 before any redelivery and assert the pending map’s exact committed deal and both history snapshots are cleared. Then redeliver and assert no new deal or projection data or event; consent=false → no writes; missing email/lastName → no partial deal; binding CRUD + optimistic-lock conflict; anonymize through the route (`request`) and privacy erase (`erasure`) → only mapped deal answers and projected files cleared and an unedited projected title replaced with `form-submission-<short id>` (an edited title retained and reported `title_retained_edited`), with CRM Person fields unchanged (R5-6); the retention worker called in process (`retention`) → Person and deal file unchanged; a recruitment-binding case (deal_label + `cf.*`) and a non-recruitment binding (lead pipeline) to prove generality. Every scenario owns fixtures and cleans surviving records/files in `finally`. Assert linking by `personId` (not `entityId`) is rejected.

## Delta — R3-6 propagation

#### MODIFIED Requirement: Subject-driven projection erasure
The subscriber SHALL clear only the projections it created on the deal for `request` and `erasure`: mapped deal `cf.*` answers and CV/file attachments (R5-6). It SHALL replace the required deal title with the fixed placeholder `form-submission-<short id>` only while the title's SHA-256 equals `projected_title_digest`; it SHALL retain an edited title and report `title_retained_edited`. It SHALL never change CRM Person fields; C4's related-subject review, exclusions and hold guard govern that root through the customers owner. It SHALL acknowledge `retention` or missing reason without writes.

##### Scenario: Program erasure
- WHEN the privacy erasure run emits `forms.submission.anonymized` with `reason: erasure`
- THEN the persistent subscriber clears only mapped deal answers and projected files and replaces the unedited projected title with `form-submission-<short id>`, as it does for `request`, with retries and idempotent redelivery; linked Person fields remain unchanged

##### Scenario: Staff edited the deal title
- WHEN either active reason, or the C4 hook, reaches a map whose deal title no longer matches `projected_title_digest`
- THEN cleanup retains that title, still clears the tracked `cf.*` answers and projected files, and reports `title_retained_edited` for staff review

##### Scenario: A deduplicated Person is excluded or held
- WHEN either active reason reaches a map linked to a pre-existing CRM Person who is excluded from the erasure run or protected by a hold
- THEN cleanup changes only the subscriber's deal-side projections and never that Person's fields or history

##### Scenario: Age-based cleanup
- WHEN the event has `retention` or no reason
- THEN no Person, deal or attachment is changed

Frozen by: the planned connector's `__tests__/anonymized-reason.characterization.test.ts`, first pinning the prior retention/missing no-op before adding the erasure case.

## Risks & Impact Review

#### Crash between deal commit and map update → duplicate deal
- **Scenario**. The deal and its answers commit, then the connector stops before updating its map. Erasure or redelivery still needs to find the deal from the pending row.
- **Mitigation**. Customers commits the exact scoped recovery binding in the deal transaction. The pending map already contains the immutable cleanup metadata. Recover through the binding in both redelivery and C4. Run remains incomplete if binding discovery fails.

#### Consent not given but deal created
- **Scenario**: forms `submit()` does no consent validation and emits unconditionally; the consent projector handles only SIGNATURE fields, so a boolean consent yields no record/gate.
- **Severity**: Critical (legal) — **Mitigation**: subscriber reads `field_map.consentFieldKey`; absent/false → ack & ignore, mark `skipped`, no writes; `consentFieldKey` required in validation. — **Residual**: depends on correct binding config; covered by a test.

#### GDPR erasure does not propagate
- **Scenario**: forms erasure clears inline uploads and answers, but an ignored `erasure` reason would leave projected deal fields and copied files untouched.
- **Severity**: Critical (legal) — **Mitigation**: R3-6 subscriber handles both subject-driven reasons; a C4 run awaits the connector's `downstreamCleanup` hook and stays `incomplete` with `downstream_cleanup_pending` until the deal copies are cleared, so it never reports a subject complete early; failed rows are shown in the run report and on the binding page; cleanup clears only tracked deal-side projection fields and files through owning services under R5-6. — **Residual**: a forms request-route anonymization outside C4 relies on the persistent subscriber alone, whose failures surface on the binding page; CRM Person erasure requires its own reviewed C4 path.

#### Projection cleanup changes an excluded or held CRM Person
- **Scenario**: email deduplication linked the submission to a pre-existing Person, and the subscriber treats `person_entity_id` as authority to clear that root after a portal-user or identifier erasure.
- **Severity**: High — **Mitigation**: R5-6 limits both active reasons to the connector's deal-side copies; Person fields and history stay outside its cleanup plan. C4's related-subject review, exclusions and hold guard govern the customers-owner path. Unit and integration cases preserve newly created, deduplicated, excluded and held people. — **Residual**: Person PII remains until separately authorized erasure by its owner.

#### Form retention erases CRM records in bulk
- **Scenario**: scheduled forms retention emits `forms.submission.anonymized` for every expired submission, and the erasure subscriber treats each as an erasure request.
- **Severity**: High — **Mitigation**: the subscriber acts only on `reason` in `{request, erasure}`; `retention` and an absent reason are acknowledged with no writes; covered by unit and integration tests. — **Residual**: none for this module; CRM records follow CRM retention.

#### Dedupe misses returning people → duplicates
- **Scenario**: `customerPersonMatchService` wraps customers' `findPeopleByAddresses`, which uses an SQL equality fast path (only when encryption OFF; `primary_email` is random-IV encrypted, no `hashField`/blind index) then decrypts at most **500** most-recent persons. Returners beyond that window are silently missed.
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
- **Severity**: Medium — **Mitigation**: the file step is gated on `cv_attached=false` and re-runs on retry WITHOUT recreating the deal; `createScoped.persistLink` records each `{ sourceAttachmentId, attachmentId }` in the attachment's own transaction, so every committed file is in the map and a retry skips recorded refs. — **Residual**: deal exists briefly without the file until retry.

#### Rolling deploy delivers a reason-less anonymization
- **Scenario**: an older process emits `forms.submission.anonymized` without `reason` while the connector already has projections.
- **Severity**: Medium — **Mitigation**: the connector ships only in a release after the R3-6 emitters, so no process of its first release emits reason-less events and no older delivery targets it; C4-driven erasure is cleaned through the awaited hook regardless of reason; the projector refuses anonymized submissions. — **Residual**: an operator who back-ports the connector onto a release without R3-6 emitters loses request-route propagation until upgrading.

#### Erasure clears a staff-edited deal field
- **Scenario**: staff edit a mapped `cf.*` value or the title before the subject's erasure.
- **Severity**: Low — **Mitigation**: tracked `cf.*` keys hold the subject's answers on the subject's own deal and are cleared; the title is replaced only while it matches the stored digest, otherwise retained and reported. — **Residual**: a staff note typed into a tracked answer field is cleared with it.

## Final Compliance Report — 2026-11-17 (revised)

### AGENTS.md Files Reviewed
- root `AGENTS.md`, `packages/core/AGENTS.md` (commands, events, encryption, API routes incl. openApi + ACL grant sync), `customers/AGENTS.md`, `attachments/AGENTS.md` (scope invariant), `packages/events/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/ui/AGENTS.md` + `.ai/ds-rules.md`, relevant core forms service contracts (the historical separate-package guide no longer describes placement).

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | No cross-module ORM relationships | Compliant | Forms via service, customers via commands and the customers-owned `customerPersonMatchService`, attachments via `createScoped`; FK ids only; no customers `lib/` import |
| root | Filter by organization_id | Compliant | Scope from submission row, passed everywhere |
| root | Optimistic locking on new editable entities | Compliant | Binding `updated_at` + CrudForm; response returns `updatedAt`; map is append-only state |
| core | Export `openApi` from every API route | Compliant | `api/openapi.ts` + export from `bindings/route.ts` |
| core | ACL grant sync for new features | Compliant | `yarn mercato auth sync-role-acls` in Phase 1 |
| attachments | `assertAttachmentScopeInvariant` before persist | Compliant | Enforced inside public attachmentService boundary |
| core | zod validation | Compliant | Binding schemas; `consentFieldKey` required |
| events | Idempotent persistent subscribers | Compliant | First-write `pending` map and durable unique customers recovery binding |
| root | Encryption maps for PII | Compliant (N/A) | Map stores pseudonymous ids and projection metadata, no copied answer values |
| R5-6; C4 | Preserve related-subject boundaries | Aligned | Both active reasons clear only this connector's deal answers and files and reset an unedited projected title; Person fields/history stay with the reviewed customers-owner path and its exclusions/hold guard |
| root | No hardcoded UI strings / status colors | Compliant | i18n en/pl; semantic tokens |
| .ai/specs taxonomy | OSS vs enterprise placement | Resolved | OSS core module at `packages/core/src/modules/form_to_deals`; no official-modules package or pointer change |
| C4; C5 | Erasure completion and table coverage | Aligned | Awaited `downstreamCleanup` hook keeps a C4 run incomplete until deal copies are cleared; both tables declared in `privacy.ts` |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models ↔ API contracts | Pass | Bindings CRUD ↔ entity; map internal |
| API ↔ UI/UX | Pass | Settings page = bindings CRUD; no public route |
| Risks cover all writes | Pass | Deal/person/attachment/map + erasure |
| Idempotency covers at-least-once + crash | Pass | Atomic deal and scoped recovery binding, with erasure before subscriber redelivery covered |
| Consent + erasure addressed | Pass | Consent gate + R3-6 subscriber for both subject-driven reasons + awaited C4 hook; R5-6 deal-only cleanup preserves the Person root; retention/missing no-op |

### Verdict
- **Ready after must-fixes (applied)** — requires same-app activation, the planned trusted projection reader/erasure contracts, the customers-owned person match service delivered with Phase 2 and C4's `downstreamCleanup` member before Phase 3; no implementation approval is implied.

## References (checked against the spec checkout)

- `packages/core/src/modules/forms/index.ts`: core placement, MIT metadata and dependencies. `events-payloads.ts`: submitted/anonymized event ids; today's anonymized event has no reason yet. `services/submission-service.ts`: `getCurrent`, role slicing and restricted `unsliced` path; `services/anonymize-service.ts`: inline upload bytes are already cleared. `services/attachment-service.ts`: `readUpload`; `schema/file-field.ts`: `FileAttachmentRef`/`readFileRefs`.
- `packages/core/src/modules/customers/commands/{people,deals}.ts`: create results and customer entity ids; `data/validators.ts`: separate non-empty first/last names. `lib/findPeopleByAddresses.ts`: equality fast path and at most 500 recent decrypting candidates; it stays customers-internal behind `customerPersonMatchService`. B1 Phase D supplies the planned lookup-hash improvement; it is not current code.
- `packages/core/src/modules/attachments/lib/attachment-service.ts`: public scoped creation/read/release contracts; `packages/core/src/modules/attachments/AGENTS.md`: no peer entity/storage fallback.
- `2026-11-16-privacy-coverage-content-ai.md`: R3-6, erasure mode and projection-reader dependency. `2026-11-16-privacy-subject-erasure.md`: R3-1 history and transactional file-release seam. `2026-11-16-forms-retention-scheduling.md`: age-based emitter uses `retention` and cites R3-6.

## Changelog

### 2026-11-19 — Confirmed spec review corrections

- Made Person recovery atomic through a customers-owned source binding, including crash/erasure recovery, and limited projected file mappings to source/projected attachment UUIDs. Added scoped declarations and acceptance cases (F03, F04).


### 2026-11-18

- Kept projection writes inactive until both erasure paths ship and pass integration tests. Added reconciliation for pre-release copies and made consent mapping mandatory for all bindings.

- Made projected deals discoverable from the pending connector map through a customers-owned, transactional source binding. Covered erasure and history stripping before crash redelivery.
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

### 2026-11-17 — council review fixes
- Settled placement as the core module `packages/core/src/modules/form_to_deals`, enabled in the app and template, with no official-modules package or pointer change.
- Person dedupe goes through a new customers-owned `customerPersonMatchService`; CV projection records each attachment through `createScoped.persistLink` in the attachment transaction.
- A C4 erasure run awaits the connector's `downstreamCleanup` hook and stays incomplete until the deal copies are cleared; added the rollout gate for reason-less events, the title template and digest-guarded title clearing, the map's privacy declarations and post-erasure minimisation.
- The `downstreamCleanup` hook uses the shared `recordIds` field, takes at most 500 submission ids per call from the forms class's `changedRecords`, changes only planned copies and counts unplanned copies and undeleted files in `pending`; erasure restatements now replace an unedited projected title with `form-submission-<short id>` instead of clearing a label, with an edited-title Delta scenario.
- 2026-11-18 review remediation: bind downstream erasure to exact approved write intents checked under the owner transaction and hold fence.
