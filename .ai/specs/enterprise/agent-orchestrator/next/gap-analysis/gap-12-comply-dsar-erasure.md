> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# COMPLY: DSAR Export & Audit-Preserving Erasure — Design Analysis

> **Status:** Draft · **Type:** Design analysis (focused investigation; not a spec rewrite) · **Created:** 2026-06-19
> **Gap:** GAP-12 · **Priority:** P2 · **Module:** `agent_orchestrator` (core)
> **Related:** compliance spec (`2026-06-19-agent-decision-transparency-and-ai-act.md`), trace spec (`2026-06-19-agent-trace-eval-capture.md`), identity spec (`2026-06-19-agent-identity-and-on-behalf-of.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`)

## 1. Gap statement

The orchestrator scatters subject PII across **~21 new `agent_` tables** (proposals, runs, spans, tool calls, context bundles, decision records, contest cases, corrections, eval cases, principals, delegation grants, …) **plus large artifacts in storage-s3** (prompts, source docs, model outputs). The three compliance specs assert GDPR DSAR export "via the `audit_logs` exporters" and erasure "via audit-preserving tombstones (trace spec's artifact-store erasure pattern)" — but the investigation shows **neither mechanism exists yet as a reusable primitive**:

- `audit_logs` exposes a **CSV route** (`api/audit-logs/actions/export/route.ts`), not a reusable cross-entity exporter service; it covers `ActionLog` rows only, not the 21 `agent_` tables.
- storage-s3 / attachments do a **hard physical delete** with **no tombstone**; the "artifact-store tombstone/erasure pattern" referenced by the specs is an aspiration, not shipped code (`s3-driver.ts#delete` is best-effort `DeleteObjectCommand`).
- the encryption DEK is **per-tenant only** (`kms.ts`: `tenant_key_<tenantId>`); there is **no per-subject key** and **no `deleteDek()`**, so crypto-shredding a single data subject is not possible with today's primitives.

GAP-12 is the design for a **subject-centric DSAR export + audit-preserving erasure service** that (a) discovers every PII location for a subject across all `agent_` tables and storage-s3, (b) erases/redacts that PII, and (c) leaves the AI Act Art. 12 immutable records (decision records, corrections, eval results) **legally intact** — resolving the Art. 12 (≥6yr immutable) vs GDPR Art. 17 (erase) tension.

## 2. Architectural drivers

- **Completeness.** Every PII-bearing location must be enumerable for a `subjectId`. A subject is a `customer_accounts` data subject referenced by `subject_id` on `AgentDecisionRecord`/`AgentContestCase`, but PII also leaks into `AgentRun.contextRouting`, `AgentSpan.attributes`, `AgentToolCall.request/responseSummary`, `AgentCorrection.proposed/correctedValue`, `AgentEvalCase.input/expected`, context bundles, and storage-s3 artifacts. A miss = an unfulfilled DSAR.
- **Audit/immutability preservation vs erasure.** Append-only logs (`AgentCorrection`, `AgentEvalResult`, `AgentDecisionRecord`) and `audit_logs.ActionLog` are the legal evidentiary trail. Erasure must **not** delete rows from these — it must redact/shred the PII *within* them while preserving the row's existence, lineage ids, and metadata.
- **Art. 12 (≥6yr) vs GDPR Art. 17.** The hard tension: the same `AgentDecisionRecord`/`AgentCorrection` must be *retained immutable for ≥6 years* and *erasable on request*. Resolution: separate **identifying PII** (erasable) from **the fact a decision/correction existed + its non-identifying lineage** (retained). Crypto-shred the former; keep the latter.
- **Subject-discovery across modules.** No cross-module ORM relations exist (FK ids only). Discovery must be **registry-driven** (each entity declares its subject join), not relational traversal.
- **storage-s3 artifacts.** Large artifacts are keyed (`outputArtifactKey`, `request/responseArtifactKey`) but not individually subject-tagged and not encrypted by storage-s3 itself. Erasing them requires either a key→subject map or a crypto-shred envelope.
- **Performance & tenancy.** 21 tables, `agent_spans` partitioned at ~9M rows/yr; a DSAR/erasure walk must be indexed by `subjectId` per table and strictly two-column tenant-scoped (`tenant_id` + `organization_id`).

## 3. Approaches

### (a) Per-entity subject-field registry + DSAR/erasure service
Each entity declares, in a module-level `subject-fields.ts` (mirroring the existing `encryption.ts` `ModuleEncryptionMap` pattern), which columns are subject PII and **how to join to a `subjectId`**. A `SubjectDataService` walks the registry: for export it collects + decrypts (`findWithDecryption`) every declared field; for erasure it redacts/shreds them. Reuses the `audit_logs` export *serialization* helpers (`serializeExport`, `PreparedExport` from `@open-mercato/shared/lib/crud/exporters`).

- **Pro:** Explicit, auditable, no schema churn on the 21 tables; the registry doubles as a PII inventory for the AI Act technical documentation. Same mental model as `defaultEncryptionMaps`.
- **Con:** Registry must be kept in sync as entities evolve (mitigated by a guard test); discovery on tables where the subject is only *inside a jsonb blob* (e.g. `AgentToolCall.requestSummary`) is awkward.

### (b) `subjectId` tagging/index on every PII-bearing row
Add a nullable, indexed `subject_id` column to every PII-bearing `agent_` table so discovery is a fast `WHERE subject_id = ? AND organization_id = ?` per table, and bulk erasure is a single indexed update.

- **Pro:** O(index) discovery and erasure; no fragile jsonb-walking; obvious completeness story.
- **Con:** Many runs/spans/tool calls have **no single subject** (a run can touch several subjects or none); back-tagging requires propagating `subjectId` through the dispatch/trace ingest path. Additive column changes across ~15 tables.

### (c) Crypto-shredding under a per-subject key
Encrypt subject artifacts (storage-s3 objects + the sensitive columns) under a **per-subject DEK**; erasure = destroy the subject key, leaving immutable audit rows physically intact but cryptographically unreadable. Requires extending the KMS from per-tenant (`tenant_key_<tenantId>`) to an additional **per-subject key namespace** (`subject_key_<tenantId>_<subjectId>`) and a `deleteSubjectDek()` operation (Vault HTTP DELETE + cache invalidation).

- **Pro:** **Elegantly resolves the Art. 12-vs-GDPR tension** — the immutable row and its lineage survive (Art. 12 satisfied), the PII is irrecoverable (Art. 17 satisfied) without mutating append-only rows. One key-delete erases storage-s3 artifacts and DB columns simultaneously. No row updates on append-only logs.
- **Con:** Net-new KMS surface (per-subject keys, `deleteDek`, rotation) that today does not exist; derived-key fallback tenants cannot per-subject-shred (env secret is global) — must hard-fail or fall back to redaction; encrypting hot columns under a second key tier adds read-path cost; key proliferation (one DEK per subject per tenant).

## 4. Trade-off matrix

| Dimension | (a) Subject-field registry | (b) subjectId tagging | (c) Crypto-shred per-subject key |
|---|---|---|---|
| Discovery completeness | High (declared) | Highest (indexed) | Medium (needs (a)/(b) to find what to shred) |
| Discovery/erasure perf | Medium (per-table scan) | High (indexed) | High (key delete) |
| Art. 12 ↔ Art. 17 resolution | Partial (redaction mutates blobs) | Partial | **Strong** (rows intact, PII irrecoverable) |
| Append-only safety | Risk (rewrites jsonb) | Risk (updates rows) | **Safe** (no row mutation) |
| storage-s3 artifact erasure | Manual per-key delete | Manual per-key delete | **Automatic** (key destroyed) |
| Schema churn | None | ~15 additive columns | KMS + envelope columns |
| Reuses existing OM primitives | High (`encryption.ts`, exporters) | Medium | Low (extends KMS) |
| Derived-key-fallback tenants | Works | Works | **Fails** (global secret) |
| Implementation cost | M | M | L |

## 5. Recommendation

**Recommended (a combination): subjectId tagging (b) for discovery + a registry-driven DSAR/erasure service (a) as the orchestrator + crypto-shredding (c) for storage-s3 artifacts and the highest-sensitivity append-only columns.**

Justification against the Art. 12-vs-GDPR tension:

1. **Discovery** uses (b) where a row has a natural single subject (`agent_decision_records`, `agent_contest_cases`, and a back-tagged `subject_id` on `agent_runs`/`agent_corrections`/`agent_eval_cases` where one applies) and (a)'s registry for jsonb-embedded PII and for rows with no single subject. The registry is the **single source of truth for "what is PII and where"** and feeds the AI Act PII inventory.
2. **Export** is the registry walk + `findWithDecryption` + the existing `audit_logs` serialization helpers (`serializeExport`/`PreparedExport`), joined with `ActionLog` rows where `actorUserId`/`onBehalfOfUserId`/`resourceId` match the subject. One JSON+CSV DSAR pack per `subjectId`, two-column tenant-scoped.
3. **Erasure** splits records into **TOMBSTONED** vs **RETAINED**:
   - **Tombstoned (PII nulled/shredded):** mutable PII columns on editable entities (`AgentContestCase.grounds/resolution`, `AgentRun.contextRouting`), and **all storage-s3 artifacts** (crypto-shredded — key destroyed, object optionally lifecycle-deleted).
   - **Retained immutable (Art. 12 ≥6yr):** the existence + non-identifying lineage of `AgentDecisionRecord`, `AgentCorrection`, `AgentEvalResult`, `AgentEvalCase`, and the `audit_logs.ActionLog` row. For these append-only logs, the **PII payload is crypto-shredded in place** (the ciphertext stays, the per-subject key is gone) so the **row is never updated** — the legal record proves "a decision/correction existed for subject X on date Y" while the identifying content is irrecoverable.
   - An `audit_logs.ActionLog` tombstone entry records *that* an erasure ran (actor, subjectId-hash, timestamp, lawful basis), satisfying accountability without re-introducing the erased PII.

Crypto-shredding (c) is what makes "audit-preserving erasure" real on **append-only** tables: redaction (rewriting jsonb) would violate append-only; destroying a per-subject key does not touch the row. This is the elegant resolution the specs gesture at but do not yet have a primitive for.

## 6. Effort, risks, dependencies

**Effort: L** (the per-subject KMS extension + cross-table registry + erasure command + integration tests dominate).

**Risks**
- **Per-subject KMS is net-new** (today only `tenant_key_<tenantId>` exists). High effort, must support Vault delete + derived-fallback hard-fail. → Phase it; ship redaction-only erasure for derived-key tenants, crypto-shred for Vault tenants.
- **Incomplete registry = unfulfilled DSAR / un-erased PII** (legal exposure). → Ship a guard test asserting every `agent_` entity is either in the subject-field registry or explicitly allowlisted as PII-free (mirrors the optimistic-lock coverage guard).
- **Append-only violation** if an implementer "redacts" a correction/decision row. → Enforce: append-only tables are crypto-shred-only; a test asserts no UPDATE path touches them on erasure.
- **storage-s3 has no tombstone today** and IAM-only tenant isolation. → Crypto-shred envelope makes the object unreadable regardless of physical-delete success; record the shredded key in the tombstone.
- **Cross-tenant leak on DSAR/erasure** (touches every table). → Two-column scoping + integration tests asserting isolation (already a Critical risk in the compliance spec).
- **Performance** on the span/tool-call walk (~9M rows/yr). → Drive erasure of high-volume tables by crypto-shred (key delete) rather than per-row scan; rely on `created_at` partitioning + `subjectId` index for the rest.

**Dependencies**
- **Key dep:** per-subject DEK extension to `TenantDataEncryptionService`/`KmsService` (`getSubjectDek`/`createSubjectDek`/`deleteSubjectDek`, `subject_key_<tenantId>_<subjectId>`).
- `audit_logs` serialization helpers (`@open-mercato/shared/lib/crud/exporters`) + `ActionLogService.list()` for the audit-join.
- identity spec (`onBehalfOfUserId`, `subjectId` propagation through dispatch/trace so rows can be tagged).
- trace spec (artifact keys, append-only retention) + compliance spec (`AgentDecisionRecord`/`AgentContestCase`, lawful-basis/consent flags).
- `customer_accounts` (subject resolution); persistent event subscriber pattern for cross-module artifact erasure (proven in form-to-deals / call_transcripts).

## 7. Deliverables + acceptance

**Deliverables**
1. **Subject-field registry** (`agent_orchestrator/subject-fields.ts`, shape `ModuleSubjectFieldMap[]`, mirroring `defaultEncryptionMaps`): per entity, the subject-join (`subjectId` column or jsonb path) + the list of PII fields + per-field disposition (`export`, `tombstone`, `crypto_shred`).
2. **`SubjectDataService`** in `lib/compliance/`: `exportSubject(subjectId, scope)` → DSAR pack (JSON + CSV via `serializeExport`); `eraseSubject(subjectId, scope, { lawfulBasis })` → audit-preserving erasure (Command + mutation guard).
3. **Tombstone model**: an `audit_logs.ActionLog` erasure entry (actor, hashed subject ref via `hashForLookup`, timestamp, lawful basis, list of shredded artifact keys + tombstoned tables) + a per-record `erasure_state` convention distinguishing RETAINED-shredded from TOMBSTONED-redacted.
4. **Crypto-shred design**: per-subject DEK namespace + `deleteSubjectDek()` (Vault DELETE + `invalidateDek`-style cache flush); storage-s3 artifacts and high-sensitivity append-only columns encrypted under the subject DEK; erasure = destroy key; derived-key-fallback tenants degrade to redaction with an explicit warning.
5. **Subject-API**: `GET /api/agent_orchestrator/compliance/dsar/:subjectId` (feature `agent_orchestrator.compliance.dsar`) and `POST /api/agent_orchestrator/compliance/erasure/:subjectId` (feature `agent_orchestrator.compliance.erasure`, Command + guard).
6. **Guard test**: every `agent_` entity appears in the subject-field registry or a PII-free allowlist with a reason.

**Acceptance**
- A DSAR export for a `subjectId` returns **every** declared PII field across all `agent_` tables (decrypted) + matching `audit_logs` rows, two-column tenant-scoped, in one JSON+CSV pack.
- Erasure makes the subject's PII irrecoverable in **all** `agent_` tables and storage-s3 artifacts, while `AgentDecisionRecord`/`AgentCorrection`/`AgentEvalResult` rows **still exist** (Art. 12), with no UPDATE applied to any append-only table (crypto-shred only).
- An immutable `audit_logs` tombstone proves the erasure ran (actor, hashed subject, timestamp, lawful basis) without re-introducing erased PII.
- Vault-backed tenants crypto-shred (key destroyed); derived-key-fallback tenants fall back to redaction with a logged warning — neither path leaves recoverable PII.
- The registry-coverage guard test fails if a new PII-bearing entity is added without a registry entry or allowlist reason.
- No DSAR or erasure endpoint returns or touches cross-tenant rows (integration test).

## Changelog

- **2026-06-19:** Initial GAP-12 design analysis. Verified against the codebase: `audit_logs` has only a CSV export route (no reusable cross-entity exporter) and append-only rows with soft-delete but **no redaction/tombstone/bulk-erase helpers**; encryption DEK is **per-tenant only** (`tenant_key_<tenantId>`, no per-subject key, no `deleteDek`); storage-s3/attachments **hard-delete with no tombstone**, erasure propagated via persistent event subscribers. Recommended a combination — subjectId tagging + registry-driven DSAR/erasure service + crypto-shredding under a net-new per-subject DEK — and justified crypto-shred as the elegant resolution of the AI Act Art. 12 (≥6yr immutable) vs GDPR Art. 17 (erase) tension: shred the per-subject key so append-only rows are never updated yet their PII is irrecoverable. Key dependency: per-subject DEK extension to `TenantDataEncryptionService`/`KmsService`.
