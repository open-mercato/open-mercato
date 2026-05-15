# Forms Module — Main Spec

> **Status:** Draft — split into per-phase sub-specs for parallel/independent implementation.
> **Scope:** Open Source (`.ai/specs/`).
> **First consumer:** a medical-questionnaire vertical (medical questionnaires for patients).
> **Module:** `@open-mercato/forms` (new).
> **Source:** Derived from the consolidated draft `2026-04-21-forms-module.md` (project root) — kept intact as the architectural reference for this split.

## TLDR

**Key Points:**
- Forms is a generic, audit-grade questionnaire primitive: admins design forms in a studio, publish immutable versions, and expose them to end-users via a public renderer with autosave, resume, and multi-role co-editing.
- Art. 9 health-data posture is baked in: per-tenant envelope encryption, access audit on every admin read, anonymization-in-place for GDPR erasure, PDF snapshots pinned at submit time.
- The feature is large enough that it MUST be delivered as a sequence of independent phases. This document is the index; per-phase sub-specs describe scope, data shape, APIs, and tests in session-sized units.

**Scope in this main spec:**
- Architectural invariants that span every phase (versioning discipline, encryption, role policy, append-only revisions, tenancy).
- Cross-cutting data model and event catalog.
- Implementation order and dependency graph.
- Pointers to each phase sub-spec.

**Out of scope here (see sub-specs):**
- Detailed API contracts, UI flows, field-by-field schema semantics, per-phase risks — these live in the respective phase spec.

---

## Overview

The Forms module provides a generic audit-grade questionnaire/form primitive for Open Mercato. Back-office admins design forms in a studio UI, publish immutable versions, and expose them to end-users (patients, customers, employees) who fill them in via a dedicated renderer with autosave and resume. Every edit to a submission is preserved as an append-only revision for audit; every form definition is versioned; submissions are pinned to the exact version they were answered against. Multi-role co-editing (e.g. patient + clinician) is supported through field-level role permissions.

First consumer: a **medical-questionnaire vertical** (medical history, consent, and anamnesis questionnaires). Designed to also serve customer onboarding, B2B PRM RFPs, HR surveys, NPS, maintenance checklists.

The full architectural narrative, market references (Form.io, JSONForms, SurveyJS, REDCap), alternatives considered, and full risk register live in the source draft at project root (`2026-04-21-forms-module.md`). This main spec captures only the invariants load-bearing across phases; detailed design lives in each phase sub-spec.

## Problem Statement

The pilot vertical needs Art. 9–grade medical questionnaires with provable versioning, append-only submission history, 20-year retention, and GDPR erasure semantics. Building this inside the vertical would re-invent form design, versioning, rendering, and submissions for every subsequent vertical. The existing EAV/custom-fields machinery describes *entity shape*, not *human-facing questionnaires that produce submissions*, and lacks immutable render semantics and audit read trails.

## Invariants (apply to every phase)

These rules are contract-surface and must not be relaxed by any phase implementation:

1. **Tenant isolation**: every entity carries `organization_id`; every query filters by it from auth context (never input).
2. **Immutable published versions**: once `form_version.status = published`, the row is frozen. All edits fork a new draft; all submissions FK-pin to a specific `form_version_id`.
3. **Append-only submission history**: `form_submission_revision` is write-then-never-mutate, with the sole exception of anonymization tombstoning (`anonymized_at` + replaced `data`).
4. **Field-level role permissions**: the server enforces `x-om-editable-by` and `x-om-visible-to` on every save and every read. Responses are role-sliced.
5. **Envelope encryption for revision data**: `form_submission_revision.data` is AES-GCM ciphertext under a per-tenant DEK wrapped by a KMS master. Fields flagged `x-om-sensitive: true` additionally receive log/trace redaction.
6. **Audit-before-read**: every admin-surface submission read writes a `form_access_audit` row with user, purpose, timestamp, IP, UA.
7. **Anonymization is irreversible**: `submission.anonymize` tombstones sensitive fields in-place and is never undoable.
8. **PDF snapshot is rendered once, at submit time**, and returned verbatim for any subsequent export — never regenerated.
9. **No direct ORM relationships across module boundaries** (root AGENTS.md rule): cross-module references are FK ids only.

## High-Level Data Model (shared across phases)

Seven entities, all tenant-scoped. Full per-column schemas live in phase sub-specs alongside the migration that introduces them.

| Entity | Owner phase | Purpose |
|---|---|---|
| `form` | 1a Foundation | Logical form with stable `(organization_id, key)` |
| `form_version` | 1a Foundation | Immutable published definition — the pinned target of submissions |
| `form_submission` | 1c Submission Core | One questionnaire-fill attempt, pinned to a version |
| `form_submission_actor` | 1c Submission Core | Who may see/edit this submission and in which role |
| `form_submission_revision` | 1c Submission Core | Append-only audit row; one per save |
| `form_attachment` | 2b Compliance / 2c Advanced Fields | Indirection to files module for uploads + PDF snapshots |
| `form_access_audit` | 2b Compliance | One row per admin-surface submission read |

## Event Catalog (singular naming per root AGENTS.md)

Events introduced by this module (defined in the owning phase):

- `forms.form.created`, `forms.form.archived` — **phase 1b**
- `forms.form_version.published` — **phase 1b**
- `forms.submission.started`, `forms.submission.revision_appended`, `forms.submission.submitted`, `forms.submission.reopened`, `forms.submission.actor_assigned` — **phase 1c / 2a**
- `forms.submission.anonymized` — **phase 2b**
- `forms.attachment.uploaded` — **phase 2c**

All events use dot separators, singular entity, past-tense action.

## Module Layout (reference)

```
packages/forms/
├─ src/
│  ├─ entities/              # Phases 1a + 1c + 2b + 2c
│  ├─ commands/              # Phases 1b + 1c + 2a + 2b
│  ├─ services/              # Phases 1a + 1c + 2b
│  ├─ api/admin/             # Phases 1b + 2a + 2b
│  ├─ api/runtime/           # Phases 1c + 1d
│  ├─ ui/admin/              # Phases 1b + 2a + 2b
│  ├─ ui/public/             # Phase 1d
│  ├─ schema/                # Phase 1a
│  ├─ events.ts              # Phase 1a (catalog)
│  ├─ acl.ts                 # Phase 1a (features)
│  ├─ setup.ts               # Phase 1a (tenant init, roles)
│  ├─ registry.ts            # Phase 1a
│  └─ index.ts
├─ migrations/               # Progressive per phase
├─ mikro-orm.config.ts
├─ package.json
└─ AGENTS.md                 # Phase 1a
```

## Phase Sub-Specs & Implementation Order

Each phase below is an independently-implementable spec — it can be scoped into a single context session, carries its own acceptance criteria and tests, and lists exactly which invariants it establishes or consumes.

| # | Phase spec | Depends on | Deliverable |
|---|------------|------------|-------------|
| 1a | [`2026-04-22-forms-phase-1a-foundation.md`](./2026-04-22-forms-phase-1a-foundation.md) | — | Module scaffold, `form` + `form_version` entities, field-type registry, FormVersionCompiler, events catalog, ACL, setup. |
| 1b | [`2026-04-22-forms-phase-1b-authoring.md`](./2026-04-22-forms-phase-1b-authoring.md) | 1a | Admin API + UI to create forms, fork drafts, edit, publish; minimal FormVersionDiffer. |
| 1c | [`2026-04-22-forms-phase-1c-submission-core.md`](./2026-04-22-forms-phase-1c-submission-core.md) | 1a, 1b | Submission entities + service, EncryptionService, RolePolicyService, runtime start/save/submit API. |
| 1d | [`2026-04-22-forms-phase-1d-public-renderer.md`](./2026-04-22-forms-phase-1d-public-renderer.md) | 1c | Hand-rolled React FormRunner, ResumeGate, autosave loop, sectioned flow, review step, confirmation. |
| 2a | [`2026-04-22-forms-phase-2a-admin-inbox.md`](./2026-04-22-forms-phase-2a-admin-inbox.md) | 1c | Submission inbox, drawer with revision replay, reopen, actor assign/revoke UI. |
| 2b | [`2026-04-22-forms-phase-2b-compliance.md`](./2026-04-22-forms-phase-2b-compliance.md) | 1c, 2a | Access audit writes + panel, PDF snapshot renderer on submit, anonymize command + UI. |
| 2c | [`2026-04-22-forms-phase-2c-advanced-fields.md`](./2026-04-22-forms-phase-2c-advanced-fields.md) | 1b, 1d | Conditional visibility (jsonlogic), version history + diff viewer UI, signature field, file field. |
| 3 | [`2026-04-22-forms-phase-3-vertical-extensions.md`](./2026-04-22-forms-phase-3-vertical-extensions.md) | 2a, 2b, 2c | Vertical custom types (tooth chart, body diagram), analytics, webhook wiring, consent aggregate. |

### Dependency graph

```
                1a Foundation
                     │
            ┌────────┴────────┐
            ▼                 ▼
      1b Authoring      1c Submission Core
            │                 │
            │        ┌────────┼──────────┐
            │        ▼        ▼          ▼
            │   1d Renderer  2a Inbox   (unblocks 2b/2c)
            │        │        │
            │        └────┬───┘
            │             ▼
            └────►  2c Advanced Fields   2b Compliance
                         │                  │
                         └────────┬─────────┘
                                  ▼
                        3 Vertical Extensions
```

### Suggested critical path

1. **Phase 1a** — must land first; everything else imports from it.
2. **Phase 1b** and **Phase 1c** can proceed in parallel after 1a (1b uses the compiler + schema format; 1c uses the entities + encryption).
3. **Phase 1d** and **Phase 2a** can proceed in parallel after 1c.
4. **Phase 2b** lands after 1c (needs revisions to audit and submissions to PDF-snapshot); benefits from 2a being present so the access-audit panel has a host drawer.
5. **Phase 2c** needs 1b (studio to configure conditional rules) and 1d (renderer to evaluate them); can start after 1d.
6. **Phase 3** is last, intentionally — depends on the full surface being live.

## Cross-Cutting Concerns

### Encryption & Access Audit (phase 1c + 2b)

- AES-GCM with per-tenant DEK; DEK wrapped by KMS master (`FORMS_ENCRYPTION_KMS_KEY_ID`).
- Ciphertext format self-describes key version: `version(2B) | key_version(2B) | iv(12B) | ciphertext | tag(16B)`.
- Rotation is re-encrypt-on-write, not bulk.
- Runtime (patient) reads of one's own submission do not write audit rows; admin surface reads always do.

### Concurrency Model (phase 1c)

- Field partitioning by role is the primary conflict-prevention mechanism — `x-om-editable-by` sets are disjoint by construction in well-formed forms.
- Optimistic `base_revision_id` check on save returns 409 if an intervening revision touched any of the client's changed fields.
- No pessimistic locking; autosave debounced to `FORMS_AUTOSAVE_INTERVAL_MS` (default 10s).
- Silent-drop + tampering marker if client sends fields outside the actor's editable set.

### i18n (all phases)

- Labels/help/options stored as `{ [locale]: string }` maps in the schema.
- Admin UI translation keys under `forms.studio.*`, `forms.version.*`, `forms.submission.*`, `forms.runner.*`.
- Mid-flow locale switch must not lose in-progress answers (phase 1d acceptance).

## Configuration (env vars)

| Env var | Default | Owning phase | Purpose |
|---|---|---|---|
| `FORMS_ENCRYPTION_KMS_KEY_ID` | *(required)* | 1c | KMS key id for master key wrap |
| `FORMS_AUTOSAVE_INTERVAL_MS` | `10000` | 1d | Renderer debounce; server rejects saves faster than half this |
| `FORMS_PDF_SNAPSHOT_ENABLED` | `true` | 2b | Generate PDF on submit |
| `FORMS_MAX_SCHEMA_BYTES` | `524288` (512 KB) | 1a | Hard cap on `form_version.schema` size |
| `FORMS_MAX_SUBMISSION_BYTES` | `2097152` (2 MB) | 1c | Hard cap on submission data payload |
| `FORMS_ACCESS_AUDIT_BATCH_MS` | `500` | 2b | Async audit write batching window |
| `FORMS_RESUME_TOKEN_TTL_S` | `3600` | 1d | Cross-device resume token lifetime |

## Risks & Impact (high-level)

The full R1–R10 risk register is in the source draft. Cross-phase severity highlights:

| Risk | Phase(s) that mitigate | Invariant it protects |
|------|------------------------|------------------------|
| R1 Sensitive data leakage via logs | 1a (schema flag), 1c (redaction), 2b (audit) | Art. 9 log posture |
| R2 Schema evolution breaking historical renders | 1a (compiler version pin), 2b (PDF snapshot) | Reproducibility |
| R3 Submission revision flood | 1c (rate limit + cap) | Storage bounds |
| R4 Cross-tenant leak via key collision | 1a (UNIQUE constraint), 1b (queries) | Tenancy |
| R5 PDF snapshot drift | 2b (rendered once) | Legal defensibility |
| R7 Role-mismatched edits | 1a (studio warning), 1c (409) | Data integrity |
| R8 Encryption key loss/compromise | 1c (rotation), ops (KMS policy) | Confidentiality |
| R9 Erasure vs retention | 2b (tombstone discipline) | GDPR + 20-year retention |
| R10 Subscriber failure on submit | 1c (event bus retry) | Eventual consistency |

## Final Compliance Report — 2026-04-22

### AGENTS.md files reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/cache/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/skills/spec-writing/SKILL.md`

### Compliance matrix

| Rule | Status | Notes |
|------|--------|-------|
| Singular entity/command/event naming | Compliant | All phase specs use `forms.form.*`, `forms.form_version.*`, `forms.submission.*` |
| No cross-module ORM relationships | Compliant | FK ids only |
| `organization_id` on every entity | Compliant | Enforced in every phase's data model |
| Zod validation for all API inputs | Compliant | Every API route lists its Zod schema owner phase |
| API routes export `openApi` | Compliant | Called out in each phase spec |
| Cache invalidation tags | Compliant (declared) | Tags listed under phase 1b (form) and 1c (submission) |
| Filename convention `{date}-{title}.md` | Compliant | `2026-04-22-forms-*.md` |
| Required sections present | Compliant | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact, Final Compliance Report, Changelog |
| Implementation split into Phases + Steps | Compliant | Eight phase sub-specs, each with its own stories |

### Verdict

**Fully compliant** — ready for phase-by-phase implementation. Start with phase 1a.

## Changelog

### 2026-04-22
- Split the consolidated draft `2026-04-21-forms-module.md` into this main spec + eight phase sub-specs for session-sized implementation.
- No architectural changes vs. the source draft — only reorganization plus explicit dependency graph and cross-phase invariant capture.
