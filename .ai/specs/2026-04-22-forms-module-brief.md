# Forms Module — Brief

## Identity

- Package: `@open-mercato/forms`
- Location: official modules repo (new standalone module, not layered over EAV)
- Source specs: `.ai/specs/2026-04-22-forms-module.md` (main) + 8 phase sub-specs

## Scope
t
Generic questionnaire/form primitive:

- Admin studio: design forms, publish immutable versions, view version history + diff
- Public renderer: autosave, resume across devices, sectioned flow, review step, mid-flow locale switch
- Submission inbox: filter/search, revision replay, actor assign/revoke, reopen
- Compliance: access audit on every admin read, PDF snapshot at submit, anonymization-in-place
- Multi-role concurrent editing (e.g. patient + clinician) with field-level role permissions

## Data Model (7 entities, all tenant-scoped)

| Entity | Purpose |
|---|---|
| `form` | Logical form, stable `(organization_id, key)` |
| `form_version` | Immutable published definition; submissions FK-pin to this |
| `form_submission` | One questionnaire-fill attempt |
| `form_submission_actor` | Who may edit, in which role |
| `form_submission_revision` | Append-only audit row; one per autosave + submit |
| `form_attachment` | Indirection to files module (uploads + PDF snapshots) |
| `form_access_audit` | One row per admin-surface submission read |

## Invariants

1. `organization_id` on every entity; all queries filter by it from auth context
2. `form_version` is immutable once `status = published`; edits fork a new draft
3. `form_submission_revision` is append-only; only UPDATE path is anonymization tombstoning
4. Field-level role permissions (`x-om-editable-by` / `x-om-visible-to`) enforced server-side on every save and every read; responses role-sliced
5. `form_submission_revision.data` is AES-GCM ciphertext under per-tenant DEK wrapped by KMS master
6. Every admin submission read writes a `form_access_audit` row; runtime (patient) self-reads do not
7. `submission.anonymize` is irreversible
8. PDF snapshot rendered once at submit time; returned verbatim for any subsequent export
9. No direct ORM relationships across module boundaries — FK ids only

## Schema Format

JSON Schema + `x-om-*` extensions. Compiled by `FormVersionCompiler` to:

- AJV validator (runtime payload validation)
- Zod schema (API boundary)
- Role-policy lookup `(role, field_key) → {canRead, canWrite}`
- Field index (flat map by key)
- `schemaHash` (SHA-256 of canonicalized schema + uiSchema)
- `registry_version` pinned at publish for historical-render reproducibility

Core field types v1: `text`, `textarea`, `number`, `integer`, `boolean`, `date`, `datetime`, `select_one`, `select_many`, `scale`, `info_block`. Phase 2: `signature`, `file`. Phase 3: vertical types registered by consumer modules via `FieldTypeRegistry.register(type, spec)`.

## Concurrency Model

- Field partitioning by role is the primary conflict-prevention mechanism; editable-by sets are disjoint by construction in well-formed forms
- Optimistic `base_revision_id` check on save; 409 on stale base
- Silent-drop + tampering marker for fields outside actor's editable set
- Autosave debounce default 10s (`FORMS_AUTOSAVE_INTERVAL_MS`); server rejects saves faster than 5s with 429
- Revision-count cap per submission (default 10,000) with coalesce-after-cap
- No pessimistic locking

## Encryption & Audit

- Ciphertext format: `version(2B) | key_version(2B) | iv(12B) | ciphertext | tag(16B)` stored as `bytea`
- DEK per `(organization_id, key_version)`, wrapped DEK persisted in `forms_encryption_key` table
- Rotation = re-encrypt on write, not bulk
- Fields flagged `x-om-sensitive: true` additionally get log/trace redaction via logger middleware on the forms namespace
- Access audit batched with `FORMS_ACCESS_AUDIT_BATCH_MS` (default 500ms); never dropped; process-exit flush

## GDPR Posture

- Anonymization: decrypt each revision, replace every `x-om-sensitive: true` field with tombstone token, re-encrypt, set `anonymized_at`
- `submit_metadata` IP/UA cleared; actor rows preserved; access audit preserved (compliance obligation)
- Polish medical retention (20y under *Ustawa o prawach pacjenta* art. 29) honored: revision structure survives, personal content does not

## Events (singular, dot-separated, past-tense)

`forms.form.created`, `forms.form.archived`, `forms.form_version.published`, `forms.submission.started`, `forms.submission.revision_appended`, `forms.submission.submitted`, `forms.submission.reopened`, `forms.submission.actor_assigned`, `forms.submission.anonymized`, `forms.attachment.uploaded`

All IDs frozen at phase 1a per BC contract § 5.

## ACL Features

- `forms.view` — read forms/versions/submissions from admin surfaces
- `forms.design` — create/edit/publish forms
- `forms.submissions.manage` — reopen, assign actors, export PDF
- `forms.submissions.anonymize` — GDPR erasure

## Env Vars

| Var | Default |
|---|---|
| `FORMS_ENCRYPTION_KMS_KEY_ID` | *(required)* |
| `FORMS_AUTOSAVE_INTERVAL_MS` | 10000 |
| `FORMS_PDF_SNAPSHOT_ENABLED` | true |
| `FORMS_MAX_SCHEMA_BYTES` | 524288 |
| `FORMS_MAX_SUBMISSION_BYTES` | 2097152 |
| `FORMS_ACCESS_AUDIT_BATCH_MS` | 500 |
| `FORMS_RESUME_TOKEN_TTL_S` | 3600 |

## Phases (session-sized, in `.ai/specs/`)

| # | Spec | Depends on |
|---|---|---|
| 1a | `2026-04-22-forms-phase-1a-foundation.md` — module scaffold, `form`+`form_version` entities, field-type registry, `FormVersionCompiler`, events catalog, ACL | — |
| 1b | `2026-04-22-forms-phase-1b-authoring.md` — admin API + studio UI, fork/publish, `FormVersionDiffer` | 1a |
| 1c | `2026-04-22-forms-phase-1c-submission-core.md` — submission entities, `SubmissionService`, `EncryptionService`, `RolePolicyService`, runtime API | 1a, 1b |
| 1d | `2026-04-22-forms-phase-1d-public-renderer.md` — `FormRunner`, `ResumeGate`, autosave, review, completion | 1c |
| 2a | `2026-04-22-forms-phase-2a-admin-inbox.md` — inbox + drawer with revision replay + injection slots | 1c |
| 2b | `2026-04-22-forms-phase-2b-compliance.md` — access audit, PDF snapshot, anonymize | 1c, 2a |
| 2c | `2026-04-22-forms-phase-2c-advanced-fields.md` — jsonlogic visibility, diff viewer, signature + file fields | 1b, 1d |
| 3 | `2026-04-22-forms-phase-3-vertical-extensions.md` — custom type pattern, analytics, webhooks, optional consent aggregate | 2a, 2b, 2c |

Critical path: **1a → (1b ∥ 1c) → (1d ∥ 2a) → 2b, 2c → 3**

## Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| Build over EAV | EAV lacks versioning, immutable render semantics, customer-facing surface, revision audit |
| Embed `@rjsf/core` | Conditional logic + i18n + custom types fight the abstraction |
| Mutable form definitions | Breaks audit reproducibility |
| Diff-chain revisions | Reconstruction cost + merge reasoning outweigh storage savings |
| Pessimistic row-lock on edit | Breaks patient+clinician co-editing |
| CRDT for submission data | Overkill — field partitioning eliminates conflicts |
| Column-level `pgcrypto` | Key management and rotation harder than KMS envelope |
| Global form keys | Prevents per-tenant customization |

## Decisions Needed From Core Team

- Placement: official modules repo, new workspace package
- KMS integration surface (platform-wide policy for `FORMS_ENCRYPTION_KMS_KEY_ID`)
