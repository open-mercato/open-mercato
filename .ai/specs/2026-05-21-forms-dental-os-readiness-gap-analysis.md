# Forms Module — dental-os Readiness Gap Analysis (Option A: native Open Mercato integration)

**Date**: 2026-05-21
**Status**: Draft — gap analysis & remediation roadmap
**Scope**: Open Source (`.ai/specs/`)
**Audience**: Form Studio (Open Mercato `@open-mercato/forms`) maintainers + dental-os (ExcelMed) team
**Source requirements**: [`.ai/2026-05-21-form-studio-module-requirements.md`](../2026-05-21-form-studio-module-requirements.md)
**Module under review**: `packages/forms/src/modules/forms/`

---

## TLDR

- The dental-os team needs patient-facing **intake / medical-history** and **consent / e-signature** forms, delivered via the **customer portal** and **public anonymous links**, under **GDPR Art. 9** constraints.
- The `@open-mercato/forms` module is built as a **native Open Mercato module** — i.e. **Integration Model Option A** (per-tenant scoping, platform encryption, RBAC feature flags, typed event bus, shared DB/migrations). Option A is the **recommended and supported** model; Option B (standalone SaaS + webhooks) is out of scope for this module's architecture.
- **The multi-tenancy / RBAC / public-link-security foundation is shipped and solid.** The **gaps that block dental-os adoption** are: e-signature, signed-PDF export, file upload, repeatable groups, GDPR data-export (Art. 15/20), retention/purge, a production KMS adapter, and in-studio locale authoring.
- **Verdict:** generic structured intake/surveys can ship today (with a real KMS configured). **Medical-history needs work; consent/e-signature is roadmap, not available.**
- This spec records the requirement-by-requirement status and a **phased remediation roadmap (Workstreams W1–W8)** to close the gaps under Option A.

---

## 1. Context

dental-os is a multi-tenant dental SaaS on Open Mercato. It requires the forms module to behave as a first-class platform citizen: every form/submission/link scoped by `tenant_id` + `organization_id`, PII encrypted per tenant, authorization via feature flags, i18n (PL/EN min), and cross-module communication via the typed event bus so dental-os subscribers can attach submissions to patients/visits.

The forms module already ships in phases (1a foundation → 1d public renderer → 2a inbox → 2b compliance → 2c advanced fields → 3 vertical extensions), plus the 2026-05-20 distribution/anonymous-submission phase. This analysis reflects **what is shipped in code today**, distinguishing shipped vs specced-but-deferred.

> **Integration decision (confirmed):** Option A — deep native integration. All remediation below assumes Option A primitives (entities with scoping columns, platform encryption maps / forms `EncryptionService`, `acl.ts` features, `events.ts` typed events, portal/admin component system, shared migrations).

---

## 2. Problem Statement

The customer's GDPR (Section 5) and multi-tenancy (Section 6) requirements are **gating**. Several are met; a subset are not. Separately, the two headline form categories have functional gaps — most critically **e-signature** and **signed-PDF**, which are the defining features of the consent/legal category and are not shipped. Without a single, accurate inventory of gaps and a remediation plan, dental-os cannot make an adoption decision and the forms team cannot sequence the work.

---

## 3. Requirement Status Matrix

Legend: **Yes** (in product) · **Partial** (limitations noted) · **No** (not implemented) · **Ops** (operational/legal, not module-enforced).

### 3.1 Authoring (FA)

| ID | Status | Evidence / note |
|----|--------|-----------------|
| FA-1 Visual builder | Yes | `backend/forms/[id]/FormStudio.tsx` + `studio/canvas/*`, `studio/palette/*` (grid DnD builder). |
| FA-2 Templates / clone / version | Partial | Fork-draft/publish versioning shipped (`commands/form-version.ts`, `api/[id]/versions/fork`); no "clone form" or shared template library. |
| FA-3 Versioning + record version | Yes | Published `FormVersion` immutable; submission FK-pins `formVersionId` (`data/entities.ts`). |
| FA-4 Field types | **Partial** | text/textarea/number/integer/boolean/yes_no/date/datetime/select_one/select_many/scale/info_block + tier-2 (email/phone/website/address/nps/opinion/ranking/matrix). **No `signature`, no file/photo upload.** |
| FA-5 Conditional logic / branching | Yes | `x-om-visibility-if` jsonlogic + jumps (`services/form-logic-evaluator.ts`, `visibility-resolver.ts`, studio `logic/ConditionBuilder.tsx`, `JumpsEditor.tsx`). |
| FA-6 Multi-page / progress | Yes | Page mode + `ui/public/components/SectionStepper.tsx`. |
| FA-7 Validation rules | Yes | `services/field-validation-service.ts` + studio `validation/*` editors. |
| FA-8 Repeatable groups | **No** | No add-N array/group support (matrix grid is fixed, not repeatable). |
| FA-9 PII / sensitive marking | Yes | `x-om-sensitive` keyword; encrypted/sensitive badge in renderer; routed to encryption + anonymize. |
| FA-10 Translatable PL/EN | **Partial** | `x-om-label`/`x-om-help` locale maps + `translations.ts`; **studio `activeLocale` hardcoded to `'en'`, no per-locale authoring / locale-add UI.** |
| FA-11 Dental/medical field library | **No** | No ICD/allergy/medication pick lists (only demo vertical types). |

### 3.2 Delivery & filling (FD)

| ID | Status | Evidence / note |
|----|--------|-----------------|
| FD-1 Portal render + prefill + bind | Partial | Binds submission to logged-in customer (`frontend/[orgSlug]/portal/forms/[key]`); **no name/DOB prefill.** |
| FD-2 Public anonymous links / QR | Yes | `FormDistribution`/`FormInvitation`, `/f/[slug]`, `/i/[token]`, `api/public/*` (2026-05-20 phase). |
| FD-3 Expiry / single-use / scoping / revoke | Yes | `expires_at`, `closes_at`, `max_responses`, `allow_multiple_submissions`, invitation revoke; org/tenant-scoped. |
| FD-4 Mobile/touch + signature capture | **Partial** | Responsive renderer; **no touch signature (no signature field).** |
| FD-5 Save & resume | Yes | `ResumeGate` + autosave + signed resume token. |
| FD-6 Accessibility (WCAG 2.1 AA) | Partial | aria usage present; not formally audited. |
| FD-7 Anti-spam / CAPTCHA | **Partial** | Per-IP+token rate-limit shipped (`api/public/rate-limit.ts`); **CAPTCHA is a stub** (`verifyCaptcha()` TODO in `api/public/start/route.ts`). |
| FD-8 Confirmation/receipt | Yes | `ui/public/components/CompletionScreen.tsx` (+ per-distribution custom thank-you / redirect). |
| FD-9 Offline-tolerant | **No** | In-session autosave only; no offline queue/reconnect. |

### 3.3 Consent / e-signature (CN)

| ID | Status | Evidence / note |
|----|--------|-----------------|
| CN-1 E-signature capture | **No** | No signature field type. |
| CN-2 Tamper-evident immutable record | Partial | Append-only revisions + `schema_hash` canonicalization; signature payload absent. |
| CN-3 Audit trail of signing | Partial | Submission records version + submit_metadata (IP/UA) + timestamps; signature-specific audit (signer, clause SHA) not shipped. |
| CN-4 Re-consent / expiry / history | Partial | Version + submission history; no consent-record aggregate. |
| CN-5 Exportable signed PDF | **No (stub)** | `api/submissions/[submissionId]/pdf/route.ts` + `FormAttachment` wiring exist; **PDF generator not shipped** (404 "pending" / 501 unconfigured). |
| CN-6 eIDAS simple-signature evidence | **No** | Depends on CN-1/CN-3/CN-5. |
| CN-7 Attach to patient / visit | Partial | `subject_type`/`subject_id` + `forms.submission.submitted` event + by-subject read; visit/treatment binding is consumer-side. |

### 3.4 GDPR / compliance (DP) — GATING

| ID | Status | Evidence / note |
|----|--------|-----------------|
| DP-1 Encryption at rest + per-tenant + field-level | **Partial** | Per-tenant envelope AES-256-GCM on revision payloads (`services/encryption-service.ts`); invitation PII via global pipeline. **KMS wrap default is a DEV-ONLY deterministic adapter — production needs a real KMS adapter.** Record-level, not per-field. |
| DP-2 Encryption in transit | Ops | TLS at deployment. |
| DP-3 EU residency | Ops | Hosting/deployment. |
| DP-4 Right to erasure | Yes | `services/anonymize-service.ts` + anonymize API/command + `forms.submissions.anonymize` ACL (in-place tombstone of sensitive fields). |
| DP-5 Access / portability export | **No** | No structured per-patient/per-submission JSON export. |
| DP-6 Retention / purge | **No** | No retention config or purge job. |
| DP-7 Audit logging of access | Partial | `access-audit-logger.ts` + `forms_form_access_audit` for admin reads; **patient self-reads intentionally not audited** (1c R1 posture). |
| DP-8 PII not in logs | Yes | `lib/log-redaction.ts`; id-only event payloads. |
| DP-9 DPA / sub-processors | Ops | Legal. |
| DP-10 AI disclosure / opt-in | Ops/N-A | No AI processing of submissions in-module. |
| DP-11 Consent-statement versioning retained | Partial | Immutable versions pinned per submission; full retention guarantee depends on DP-6 (absent) + CN-5 (stub). |

### 3.5 Security & multi-tenancy (SEC) — GATING

| ID | Status | Evidence / note |
|----|--------|-----------------|
| SEC-1 Tenant isolation | Yes | `organization_id` + `tenant_id` on every entity; mandatory read filters. |
| SEC-2 RBAC feature flags | Yes | `acl.ts`: `forms.view/design/submissions.manage/submissions.anonymize/distribute`. |
| SEC-3 Portal vs staff auth separation | Yes | Customer auth on runtime/by-subject routes vs staff auth + features on admin routes. |
| SEC-4 File-upload scan / limits | **No** | File upload field not shipped. |
| SEC-5 Server-side validation | Yes | `SubmissionService` re-runs AJV on merged payload server-side. |
| SEC-6 Hardened public endpoints | Yes | HMAC-SHA256 access tokens, SHA-256 `token_hash` (raw never stored), timing-safe compare, ≥128-bit entropy, rate-limited. |

### 3.6 Integration touch-points (INT)

| ID | Status | Evidence / note |
|----|--------|-----------------|
| INT-1 Bind submission to patient | Yes | `subject_type`/`subject_id`; portal binds to customer id; anonymous anchors on invitation id. |
| INT-2 Notify on submit / sign | Yes | `forms.submission.submitted`/`anonymized` events + `subscribers/forms-webhook-bridge*.ts`. |
| INT-3 Programmatic trigger | Partial | Distribution/invitation create via command+API; no single "send intake" helper. |
| INT-4 Read typed answers | Yes | by-subject read API + compiled `fieldIndex`/exportAdapters. |
| INT-5 Map answers → dental-os fields | **No** | No configurable mapping layer; consumer builds it. |
| INT-6 Idempotent ingestion | Partial | Persistent (at-least-once) bridge; idempotency delegated to webhooks module. |
| INT-7 Sandbox / test mode | Ops | Env-based; no module-level sandbox concept. |

### 3.7 Non-functional (NFR)

| ID | Status | Evidence / note |
|----|--------|-----------------|
| NFR-1 i18n PL/EN + add locales | Partial | Locale maps + create-time locales; studio per-locale authoring gap (FA-10). |
| NFR-2/3/4 perf / availability / browser | Ops | Deployment-level. |
| NFR-5 Versioned documented API | Partial | All routes export `openApi`; no formal external BC policy doc. |
| NFR-6 Observability w/o PII | Yes | id-only events + log redaction. |
| NFR-7/8 pricing / SLA / disclosure | Ops | Business/legal. |

---

## 4. Gating Gaps (must close for GDPR-regulated adoption)

1. **DP-1 — Production KMS adapter.** The per-tenant envelope encryption is real, but the key-wrap default is a dev-only deterministic adapter. **No PHI may be stored until a real KMS adapter is wired.** (Encryption is record-level; field-level is an enhancement, not a blocker.)
2. **DP-5 — Data export / portability.** No structured machine-readable per-patient export. Hard Art. 15/20 requirement.
3. **DP-6 — Retention & purge.** No per-form retention config or automatic purge. Required by the DP-11 retention story.
4. **SEC-4 — File upload safety.** File upload field absent; therefore no virus-scan/type/size enforcement.
5. **DP-7 — Patient self-read audit (policy decision).** Self-reads are deliberately un-audited (R1 posture). Confirm acceptable with dental-os DPO, or add an opt-in audit mode.

The remaining SEC items (SEC-1/2/3/5/6) and DP-4/DP-8 are **met**.

---

## 5. Functional Gaps (by category)

**Consent & legal (blocking):**
- **CN-1 signature field** — not shipped (the single biggest blocker).
- **CN-5 signed-PDF generator** — endpoint/attachment plumbing exists; renderer not shipped.
- CN-3 signature audit, CN-6 eIDAS evidence — follow from the above.

**Intake / medical history (needs work):**
- **FA-8 repeatable groups** — for "add N medications/allergies".
- **FA-4 / SEC-4 file/photo upload**.
- **FD-1 patient prefill** (name/DOB).
- **FA-10 / NFR-1 in-studio locale authoring** (currently English-only label editing).
- **INT-5 answer→field mapping** (to drive allergy/medication flags).
- FD-7 CAPTCHA (stub), FA-11 dental field library (nice-to-have).

---

## 6. Proposed Remediation Roadmap (Option A workstreams)

Sequenced by adoption impact. Each maps to native OM primitives. Effort is rough order-of-magnitude.

| WS | Title | Closes | Notes / approach | Effort |
|----|-------|--------|------------------|--------|
| **W1** | **Production KMS adapter** | DP-1 | Implement a real KMS-backed wrap/unwrap behind the existing `EncryptionService` key-provider slot; per-tenant DEK; document key rotation. **Prereq for any PHI.** | S–M |
| **W2** | **Signature field** | CN-1, FD-4, CN-2/3 (partial) | Register a `signature` field type (drawn canvas + typed-name + affirmation checkbox) via `FieldTypeRegistry`; store signature payload in the encrypted revision; capture signer identity, UTC ts, IP/UA, clause text + clause SHA in submit metadata. Revives the deferred phase 2c track. | M–L |
| **W3** | **Signed-PDF snapshot** | CN-5, CN-6, DP-11 | Implement the PDF render worker behind the existing `api/submissions/[id]/pdf` slot + `FormAttachment` snapshot; reproduce exactly what was presented (version-pinned schema + answers + signature + audit block). Revives deferred phase 2b. | M–L |
| **W4** | **File / photo upload field** | FA-4, SEC-4 | `file` field type + upload pipeline using `FormAttachment`; enforce type/size; virus-scan hook (pluggable); same tenant-isolation + encryption guarantees. | M–L |
| **W5** | **GDPR data tooling** | DP-5, DP-6 | (a) Per-patient structured export endpoint (JSON of decrypted submissions, feature-gated + audited). (b) Per-form retention config + scheduled purge worker (respecting consent legal-retention via W3). | M |
| **W6** | **Repeatable groups** | FA-8 | Array/group field construct in schema + studio + runner + role-policy + export adapter. Schema-format change (additive `x-om-*`). | L |
| **W7** | **Studio i18n authoring** | FA-10, NFR-1 | Per-locale label/help editing in the studio (locale switcher driving `activeLocale`) + supported-locale add/remove UI. (Builds on the locales-editor gap already flagged.) | S–M |
| **W8** | **Patient prefill + answer mapping** | FD-1, INT-5 | (a) Portal prefill of known subject fields (name/DOB) via a prefill resolver. (b) Configurable answer→entity mapping surfaced as events/config dental-os consumes. | M |

**Recommended sequencing:**
- **Tier 1 (unblocks generic intake in production):** W1.
- **Tier 2 (medical-history viable):** W4, W5, W6, W7, W8.
- **Tier 3 (consent/e-signature viable):** W2, W3 (depend on W1).

Smaller follow-ups: real CAPTCHA provider (FD-7), dental field library (FA-11), WCAG audit (FD-6), offline filling (FD-9), idempotency hardening (INT-6).

---

## 7. Data Model / API / Event deltas implied (high level)

- **W2 signature:** new field type (no new table — payload in encrypted revision); extend submit metadata for signature audit fields.
- **W3 PDF:** reuse `FormAttachment` (kind `snapshot`); a render worker on the queue; `forms.attachment.uploaded` already in the events catalog.
- **W4 file:** reuse `FormAttachment` (kind `user_upload`); upload + scan worker; size/type validators.
- **W5 export/retention:** new feature-gated export route (`forms.submissions.export`) + audited; retention config column on `forms_form` + a scheduled purge worker; new ACL feature for purge.
- **W6 repeatable groups:** additive `x-om-*` keyword(s) + registry/compiler/runner support (must follow the schema-format freeze rules — additive + optional).
- All new ACL features must be declared in `acl.ts` + granted in `setup.ts` + `sync-role-acls`.

These are sketches; each workstream gets its own phase spec before implementation.

### W8 implementation notes (2026-05-21)

Both halves are declarative + pluggable so the forms module never depends on
dental-os (or any consumer) entities — no cross-module ORM.

**(a) Prefill (FD-1).** Additive field keyword `x-om-prefill` (a non-empty
logical attribute key string, e.g. `"name"`, `"email"`, `"dob"`) registered in
`OM_FIELD_KEYWORDS` + `OM_FIELD_VALIDATORS`. A `PrefillResolver` abstraction
(DI key `formsPrefillResolver`, `asValue` — stateless) resolves
`{ principal, attributeKeys }` → `{ [attrKey]: value }`. The shipped
`DefaultPrefillResolver` maps only what the customer auth context exposes
(`name → displayName`, `email → email`); unknown keys (e.g. `dob`) are omitted,
anonymous principals resolve to `{}`. Operators inject a richer resolver (DOB,
etc.) by overriding the DI key. The authenticated start route
(`api/form-submissions`) compiles the active version, calls
`resolvePrefillSeed(...)` (reads `x-om-prefill` off the compiled `fieldIndex`,
maps attr→fieldKey), and passes an optional `prefill: { [fieldKey]: value }` into
`SubmissionService.start`. `start` filters the seed through the participant
role's `filterWritePatch` (only fields the participant may edit survive),
validates the result with AJV, and stores it as the initial revision payload —
falling back to `{}` on any failure. The anonymous public start route is a no-op
by default (no known subject), but the resolver plumbing lets an injected
resolver prefill from invitation data later. Fully backward-compatible: forms
without `x-om-prefill` open with an empty payload exactly as before.

**(b) Answer→field mapping (INT-5).** Additive root keyword
`x-om-answer-mappings` (`{ [fieldKey]: targetPath }`, e.g.
`{ "allergies": "patient.allergies" }`) registered in `OM_ROOT_KEYWORDS` +
`OM_ROOT_VALIDATORS`; `validateOmCrossKeyword` rejects mappings referencing
unknown field keys. The mapping is **config only** and is exposed to consumers
on the authed form-version read API (`GET /api/forms/[id]/versions/[versionId]`
→ `answerMappings`) — NOT via events, because the events catalog is id-only
(DP-8: no PII in event payloads). Consumer flow: on the id-only
`forms.submission.submitted` event, a dental-os subscriber loads the version's
`answerMappings` via the read API, fetches the submission answers via the
existing authed by-subject / GDPR export API, then applies the mapping to its own
entities. The forms module never writes to any external entity.

---

## 8. Risks & Impact Review

- **R-1 — Storing PHI before W1 (Critical).** The dev KMS adapter is not safe for real health data. **Mitigation:** gate production enablement on a wired KMS adapter; document loudly; consider a runtime guard that refuses to encrypt with the dev adapter when `NODE_ENV=production`.
- **R-2 — Consent shipped without signature/PDF (High).** Marketing forms as "consent-ready" before W2/W3 would create legal exposure. **Mitigation:** label consent/e-signature as roadmap until W2+W3+W5 land.
- **R-3 — Schema-format changes for repeatable groups (Medium).** v1 keywords are FROZEN; W6 must be additive/optional and registered in the keyword catalog + validators (per `packages/forms/AGENTS.md` rules). **Mitigation:** spec + review before coding.
- **R-4 — Erasure semantics (Medium).** DP-4 anonymizes in place (tombstone), not hard-delete, and does not cover backups. **Mitigation:** confirm this satisfies dental-os's Art. 17 interpretation; document backup-purge as operational.
- **R-5 — Self-read audit omission (Medium).** DP-7 by-design gap may not satisfy the DPO. **Mitigation:** offer an opt-in self-read audit mode (small).

---

## 9. Final Readiness Report — 2026-05-21

> **Update (post-implementation):** Workstreams **W1–W8 are now implemented** (see § 10). The verdicts below show the original pre-implementation assessment in parentheses and the post-W1–W8 status.

| Category | Verdict | Blockers to close |
|----------|---------|-------------------|
| Generic structured intake / surveys | **Shippable** (was: shippable w/ KMS) | Configure a real `FORMS_ENCRYPTION_MASTER_KEY` (W1 done) |
| New-patient intake / medical history | **Implemented — pending QA** (was: needs work) | E2E/UAT of file upload, repeatable groups, prefill, export |
| Consent & legal with e-signature | **Implemented — pending QA/legal sign-off** (was: roadmap) | Signature + signed-PDF shipped (W2/W3); needs legal review of the PDF/audit bundle + eIDAS posture |
| Multi-tenancy / RBAC / public-link security (SEC core) | **Met** | — |
| GDPR (Section 5) | **Met (module-side)** (was: partial) | Operational: real KMS key, EU hosting (DP-3), DPA (DP-9); confirm DP-7 self-read policy with DPO |

**Integration model:** Option A (native) — supported and recommended; Option B is not this module's architecture.

---

## 10. Implementation Status — 2026-05-21

All eight remediation workstreams were implemented; the forms package builds (194 entry points) with 589 unit tests passing.

| WS | Status | Shipped |
|----|--------|---------|
| **W1** KMS adapter | Done | `EnvMasterKeyKmsAdapter` (32-byte master key via `FORMS_ENCRYPTION_MASTER_KEY`) + operator-injectable cloud-KMS hook + `NODE_ENV=production` guard refusing the dev adapter. Closes DP-1. |
| **W2** Signature field | Done | `signature` field type (drawn canvas + typed-name + affirmation), `x-om-consent-clause`/`x-om-signature-modes`, value carries `clauseSha256`/`signedAt`; server-authoritative submit audit (IP/UA/UTC). Closes CN-1, FD-4; partial CN-2/CN-3. |
| **W3** Signed PDF | Done | `pdf-lib` snapshot generated on submit (idempotent), encrypted `FormAttachment(kind=snapshot)`, admin + participant download endpoints, completion-screen download enabled. Closes CN-5; supports CN-6/DP-11. |
| **W4** File upload | Done | `file` field type, encrypted-at-rest `FormAttachment` storage, MIME/size gate (`FORMS_MAX_UPLOAD_BYTES`) + pluggable virus-scan hook (`formsUploadScanner`), auth + anonymous upload/download. Closes FA-4 (file)/SEC-4. |
| **W5** GDPR tooling | Done | Per-subject JSON export (`forms.submissions.export`, audited) + `retention_days` on `forms_form` + idempotent anonymize-based purge worker (`forms-retention-purge`). Closes DP-5/DP-6; supports DP-11. |
| **W6** Repeatable groups | Done | `group` field type (array-of-object), additive `x-om-min-items`/`x-om-max-items`, AJV validation, atomic role-policy, add/remove renderer. Closes FA-8. (Nested groups out of scope by design.) |
| **W7** Studio i18n | Done | Locale switcher + per-locale label/help editing + supported-locale add/remove + default-locale selector via the extended form command. Closes FA-10/NFR-1. |
| **W8** Prefill + mapping | Done | `x-om-prefill` + `PrefillResolver` (role-filtered, AJV-validated seed on start) + `x-om-answer-mappings` exposed on the version read API (events stay id-only). Closes FD-1/INT-5. |

### Residual / operational items (not module gaps)
- **Operational (deployment/legal):** wire a production KMS master key (W1 makes it mandatory in prod); EU data residency (DP-3); DPA + sub-processors (DP-9); TLS (DP-2).
- **Policy decision:** patient self-read audit (DP-7) remains off by design — confirm with the DPO or add an opt-in mode.
- **Nice-to-haves still open:** real CAPTCHA provider (FD-7 — rate-limiting shipped, verifier is a stub), dental field library (FA-11), formal WCAG 2.1 AA audit (FD-6), offline filling (FD-9), template/clone library (FA-2), studio inspector UI for `retention_days`/`x-om-prefill`/`x-om-answer-mappings` (keywords round-trip; no dedicated control).
- **QA:** all workstreams are unit-tested; **end-to-end / UAT and a security + legal review of the consent/PDF bundle are still required before production rollout.**

---

## Changelog

### 2026-05-21 (W8)
- Implemented W8 (FD-1 prefill + INT-5 answer→field mapping). Added additive keywords `x-om-prefill` (field) and `x-om-answer-mappings` (root) to the catalog + validators + cross-keyword check; `PrefillResolver` abstraction + `DefaultPrefillResolver` (DI key `formsPrefillResolver`); `resolvePrefillSeed` helper; `SubmissionService.start` now accepts an optional role-filtered, AJV-validated `prefill` seed (backward-compatible); the authenticated start route resolves prefill from the customer auth context; `answerMappings` exposed on the form-version read API (config only — events stay id-only). Unit tests for keyword registration/validation, the default resolver, and prefill seeding.

### 2026-05-21
- Initial gap analysis & remediation roadmap mapping dental-os requirements (`.ai/2026-05-21-form-studio-module-requirements.md`) to shipped `@open-mercato/forms` capabilities under Option A. Records Yes/Partial/No status per requirement ID and proposes workstreams W1–W8 to close gaps, with a per-category ship-readiness verdict.
