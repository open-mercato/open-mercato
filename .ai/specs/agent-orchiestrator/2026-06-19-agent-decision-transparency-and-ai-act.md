# Agent Decision Transparency, GDPR & AI Act Conformity

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `agent_orchestrator` (core, `packages/core/src/modules/agent_orchestrator/`) · **subdomain:** `compliance`
> **Depends:** trace spec (`2026-06-19-agent-trace-eval-capture.md`), context spec (`2026-06-19-agent-context-knowledge-plane.md`), `portal`, `customer_accounts`, `audit_logs`, `business_rules`, `dashboards`
> **Conventions:** `2026-06-19-agent-orchestrator-conventions.md` is normative; where an entity sketch here conflicts with it, the conventions doc wins.

## TLDR

This is the **affected-person and regulator side** of the agent orchestrator that the internal cockpit (`2026-06-19-agent-operations-ui.md`) does not cover. It provides a claimant-facing **plain-language explanation + contest/appeal** surface (real portal convention), GDPR data-subject rights (DSAR export, audit-preserving erasure, consent flags), periodic bias/fairness monitoring, and the EU AI Act conformity programme (technical documentation, post-market monitoring, serious-incident reporting) for a high-risk system (claims adjudication). **It cannot be retrofitted late** — a high-risk AI domain must ship transparency, oversight, and the conformity programme as part of go-live, not after.

## Overview

Every other surface in the orchestrator serves operators and engineers: the cockpit, the trace/eval harness, the dispatch board. None of them speaks to the person a decision is *about*, nor to the regulator who supervises a high-risk system. This spec adds three append-only / editable compliance entities (`AgentDecisionRecord`, `AgentContestCase`, `AgentFairnessMetric`), a claimant portal surface, an admin compliance API, and the conformity-programme machinery — all built on contracts that already exist in OM (`portal`, `customer_accounts`, `audit_logs`, `business_rules`, `dashboards`) plus the trace and context specs.

## Problem Statement

A claimant subject to an automated or AI-assisted decision has enforceable rights:

- **GDPR Art. 15 / 22** — access to their data and meaningful information about the logic of solely-automated decisions, plus the right to contest and obtain human intervention.
- **GDPR Art. 17** — erasure ("right to be forgotten"), which must coexist with the immutable audit record.
- **EU AI Act Art. 13 / 14 / 86** — transparency, effective human oversight (not rubber-stamping), and a right to an explanation of individual decisions for high-risk systems.

High-risk insurance further requires **bias/fairness monitoring**, **technical documentation** (system card), **post-market monitoring**, and **serious-incident reporting**. None of this exists in the orchestrator today, and none of it can be bolted on credibly after the system is already adjudicating real claims — the evidentiary trail (decision records, lineage, correction history) has to be captured from the first decision.

## Proposed Solution

1. **Decision record (append-only).** For each agent-influenced disposition, derive a claimant-comprehensible `AgentDecisionRecord` from the disposition + `factorsUsed` + the context spec's per-fact lineage. This is **distinct from** the engineer trace (the trace spec's `AgentSpan`/`AgentToolCall` chain): the record is plain-language, the trace is forensic.
2. **Claimant portal surface.** A `portal` page set under `frontend/[orgSlug]/portal/decisions/` lets a claimant read the explanation and open a contest. Auth is enforced by the real `(frontend)` catch-all via `CustomerRbacService` reading the sibling `page.meta.ts` (`requireCustomerAuth` / `requireCustomerFeatures`); a portal nav block auto-lists the surface in the portal sidebar.
3. **Contest/appeal workflow.** A `business_rules` ACTION rule opens an `AgentContestCase` → a review workflow with a **mandatory human reviewer**. An overturn writes an `AgentCorrection` (owned by the trace spec) that feeds **this module's own eval harness** (the trace spec's harness — there is no separate `eval-runner`).
4. **GDPR rights.** DSAR export via the `audit_logs` exporters; erasure via **audit-preserving tombstones** (the trace spec's artifact-store erasure pattern — redact PII while the immutable audit record retains a tombstone); consent / lawful-basis flags on the decision record.
5. **Bias/fairness monitoring.** Periodic `AgentFairnessMetric` rollups by privacy-safe cohort; threshold breaches flag for human review.
6. **Conformity programme.** A technical-documentation / system-card generator from the agent registry + trace; **post-market monitoring built on THIS module's metrics + the `dashboards` module** (there is no `telemetry-and-otel` module — that spec does not exist); and a serious-incident reporting workflow.

## Architecture

- **Placement.** All code lives in `packages/core/src/modules/agent_orchestrator/`, flat auto-discovered root with `lib/compliance/` for the services. Module id `agent_orchestrator`; table prefix `agent_`; API base `/api/agent_orchestrator/...`.
- **Entities** (`data/entities.ts`): `AgentDecisionRecord` (append-only), `AgentContestCase` (editable → optimistic lock), `AgentFairnessMetric` (append-only). All carry **both** `tenant_id` and `organization_id`; all queries filter by `organization_id`.
- **No cross-module ORM relations.** `processId`, `agentRunId`, `subjectId`, `decisionRecordId`, `correctionId` are FK **ids** only.
- **Reads** via `makeCrudRoute` + `indexer` + `openApi`. **Writes** (contest open, contest resolve, erasure) go through the **Command pattern** with the mutation guard (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`); editable writes enforce optimistic locking at the command layer (`enforceCommandOptimisticLock`) and surface 409s with `surfaceRecordConflict`.
- **Events** (`events.ts`, `as const`): `agent_orchestrator.decision.recorded`, `agent_orchestrator.contest.opened`, `agent_orchestrator.contest.resolved`, `agent_orchestrator.fairness.flagged`, `agent_orchestrator.incident.reported`. The contest surface sets `portalBroadcast: true` on the contest events so the portal reflects status live.
- **ACL** (`acl.ts` + `setup.ts` `defaultRoleFeatures`): `agent_orchestrator.compliance.view`, `agent_orchestrator.compliance.contest.review`, `agent_orchestrator.compliance.dsar`, `agent_orchestrator.compliance.erasure`, `agent_orchestrator.compliance.fairness`. Portal capability `agent_orchestrator.portal.decisions.view` gates the claimant pages via `requireCustomerFeatures`.
- **Encryption.** Subject PII on the decision record and DSAR exports uses the real field-level `TenantDataEncryptionService`; reads go through `findWithDecryption`.

## Data Models

> MikroORM **v7**, `/legacy` decorators, explicit `@Property` per column, two-column tenancy, append-only logs omit `updated_at`/`deleted_at`. JSON columns are `jsonb` with shape enforced by Zod in `data/validators.ts`. Enums are `varchar` + TS string union. No cross-module ORM relations.

### `AgentDecisionRecord` (append-only, claimant-facing)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type DecisionOutcome =
  | 'approved' | 'partially_approved' | 'rejected' | 'pending_review'

export type LawfulBasis =
  | 'contract' | 'consent' | 'legal_obligation' | 'legitimate_interest'

@Entity({ tableName: 'agent_decision_records' })
@Index({ name: 'agent_decision_records_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_decision_records_subject_idx', properties: ['organizationId', 'subjectId'] })
@Index({ name: 'agent_decision_records_process_idx', properties: ['processId'] })
export class AgentDecisionRecord {
  [OptionalProps]?: 'humanInvolved' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string // FK id → workflows instance; NOT an ORM relation

  @Property({ name: 'agent_run_id', type: 'uuid', nullable: true })
  agentRunId?: string | null // FK id → agent_runs (trace spec)

  @Property({ name: 'subject_id', type: 'varchar', length: 100 })
  subjectId!: string // FK id → customer_accounts customer / data subject

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  @Property({ name: 'outcome', type: 'varchar', length: 30 })
  outcome!: DecisionOutcome

  @Property({ name: 'plain_explanation', type: 'text' })
  plainExplanation!: string // human-comprehensible reason, NOT the engineer trace

  @Property({ name: 'factors_used', type: 'jsonb' })
  factorsUsed!: any // top factors + per-fact lineage refs (from context spec)

  @Property({ name: 'human_involved', type: 'boolean', default: false })
  humanInvolved: boolean = false // AI Act Art. 14 meaningful-oversight flag

  @Property({ name: 'reviewer_role', type: 'varchar', length: 100, nullable: true })
  reviewerRole?: string | null

  @Property({ name: 'lawful_basis', type: 'varchar', length: 30, nullable: true })
  lawfulBasis?: LawfulBasis | null

  @Property({ name: 'consent_ref', type: 'varchar', length: 200, nullable: true })
  consentRef?: string | null

  @Property({ name: 'contestable_until', type: Date, nullable: true })
  contestableUntil?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

### `AgentContestCase` (editable → optimistic lock)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type ContestStatus =
  | 'open' | 'under_review' | 'upheld' | 'overturned' | 'withdrawn'

@Entity({ tableName: 'agent_contest_cases' })
@Index({ name: 'agent_contest_cases_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_contest_cases_subject_idx', properties: ['organizationId', 'subjectId'] })
@Index({ name: 'agent_contest_cases_decision_idx', properties: ['decisionRecordId'] })
export class AgentContestCase {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'decision_record_id', type: 'uuid' })
  decisionRecordId!: string // FK id → agent_decision_records (same module)

  @Property({ name: 'subject_id', type: 'varchar', length: 100 })
  subjectId!: string // FK id → data subject

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId!: string | null // FK id → review workflow instance once opened

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'open' })
  status: ContestStatus = 'open'

  @Property({ name: 'grounds', type: 'text' })
  grounds!: string // claimant-supplied reason for contesting

  @Property({ name: 'resolution', type: 'text', nullable: true })
  resolution?: string | null

  @Property({ name: 'reviewer_user_id', type: 'uuid', nullable: true })
  reviewerUserId?: string | null // mandatory human at resolution; FK id → auth user

  @Property({ name: 'correction_id', type: 'uuid', nullable: true })
  correctionId?: string | null // FK id → agent_corrections (trace spec) on overturn

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date() // optimistic-lock header source; returned as updatedAt in APIs

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### `AgentFairnessMetric` (append-only, abbreviated)

```typescript
@Entity({ tableName: 'agent_fairness_metrics' })
// [OptionalProps]?: 'createdAt'
// id (uuid PK), tenant_id (uuid), organization_id (uuid)
// capability (varchar), window (varchar, e.g. '2026-06'),
// by_cohort (jsonb — outcome/approval rates per privacy-safe cohort),
// flagged (boolean default false — threshold breach),
// threshold (jsonb nullable — configured limits),
// created_at (Date, onCreate). No updated_at / deleted_at.
```

## Capabilities

- **Plain-language explanation.** A `DecisionExplanationService` (`lib/compliance/`) composes `plainExplanation` from the disposition + `factorsUsed` + the context spec's lineage, never leaking the raw engineer trace. Persisted as an `AgentDecisionRecord` on `agent_orchestrator.decision.recorded`.
- **Contest / appeal workflow.** A `business_rules` ACTION rule (matched on the decision outcome / contest request) opens an `AgentContestCase` and starts a `workflows` review process. Resolution **requires** a `reviewerUserId` (mandatory human — enforced in the resolve command). An `overturned` resolution writes an `AgentCorrection` (trace spec) and sets `correctionId`, feeding this module's eval harness.
- **Human-involvement disclosure.** `humanInvolved` + `reviewerRole` record whether a human meaningfully reviewed (AI Act Art. 14, anti-rubber-stamp). Cross-checked against the cockpit's sampled-review signals.
- **GDPR rights.** DSAR export reuses the `audit_logs` exporters joined with this module's decision records (decrypted via `findWithDecryption`). Erasure resolves the **AI-Act-≥6yr-immutability vs GDPR-Art.17-erasure tension** via a COMBINATION (GAP-12), because there is **no per-subject encryption key today** — only a per-tenant key (`tenant_key_<tenantId>`) in `TenantDataEncryptionService` / `KmsService`, with no per-subject DEK and no `deleteDek`: **(a) subjectId tagging/index** on every PII-bearing `agent_` row for discovery; **(b) a registry-driven DSAR/erasure service** that walks a per-entity subject-field registry (reusing the `audit_logs` exporters); and **(c) per-subject crypto-shredding** — subject artifacts (`storage-s3` blobs + sensitive columns) are encrypted under a per-subject key, and erasure destroys that key, leaving the immutable audit rows intact (audit-preserving tombstone). This **REQUIRES a NET-NEW per-subject DEK extension** to `TenantDataEncryptionService` / `KmsService` (adding `deleteDek`) — a dependency / effort-**L** item that must land for crypto-shredding to be real. `lawfulBasis` / `consentRef` capture lawful basis and consent.
- **Bias/fairness monitoring.** A scheduled worker rolls up `AgentFairnessMetric` by privacy-safe cohort per capability per window; threshold breaches set `flagged` and emit `agent_orchestrator.fairness.flagged` for human review.
- **AI Act conformity programme.** A system-card / technical-documentation generator assembles the agent registry + trace lineage into a conformity pack via the `audit_logs` exporters. **Post-market monitoring** is built on this module's metrics (`AgentFairnessMetric`, decision/contest volumes) surfaced through the **`dashboards` module** — NOT a telemetry module. A serious-incident reporting workflow (`agent_orchestrator.incident.reported`) routes qualifying events to a documented response process.

## API Contracts

### Portal (claimant — real portal convention)

- `GET /[orgSlug]/portal/decisions/:id` — plain-language explanation for one decision. Page: `frontend/[orgSlug]/portal/decisions/[id]/page.tsx` + sibling `page.meta.ts` with `requireCustomerAuth` and `requireCustomerFeatures(['agent_orchestrator.portal.decisions.view'])`; enforced by the `(frontend)` catch-all via `CustomerRbacService`. Returns only the subject's own records (scoped by authenticated `customer_accounts` subject + `organizationId`).
- `POST /[orgSlug]/portal/decisions/:id/contest` — opens an `AgentContestCase` (Command + mutation guard). Body validated by Zod (`grounds`). Triggers the `business_rules` ACTION rule → review workflow.

### Admin (operator / regulator)

- `GET /api/agent_orchestrator/compliance/dsar/:subjectId` — DSAR export (decision records + audit-log entries, decrypted), feature `agent_orchestrator.compliance.dsar`.
- `POST /api/agent_orchestrator/compliance/erasure/:subjectId` — audit-preserving erasure via the registry-driven DSAR/erasure service: per-subject crypto-shredding (destroy the per-subject DEK, requiring the NET-NEW `deleteDek`; GAP-12) leaving immutable audit rows as tombstones; Command + mutation guard, feature `agent_orchestrator.compliance.erasure`.
- `GET /api/agent_orchestrator/compliance/fairness?capability&window` — fairness metrics by cohort, feature `agent_orchestrator.compliance.fairness`.
- CRUD reads for `agent_decision_records` and `agent_contest_cases` via `makeCrudRoute` + `indexer` + `openApi` (admin review queue); contest resolution is a non-CRUD Command write with optimistic lock.

## Phases

1. **`AgentDecisionRecord` + claimant explanation surface** (GDPR Art. 22 / AI Act Art. 86 minimum): entity, explanation service, portal `decisions` pages + `page.meta.ts`, portal nav block, `agent_orchestrator.decision.recorded`.
2. **Contest/appeal workflow + human-involvement disclosure**: `AgentContestCase`, `business_rules` ACTION rule, review workflow with mandatory reviewer, overturn → `AgentCorrection`, optimistic-locked resolve command, portal contest endpoint.
3. **GDPR DSAR / erasure / consent**: DSAR exporter integration, audit-preserving erasure command, lawful-basis/consent flags.
4. **Bias/fairness + conformity programme + incident reporting**: `AgentFairnessMetric` rollup worker, fairness API, system-card generator, post-market monitoring dashboards (`dashboards` module), serious-incident workflow.

## Acceptance

- A claimant can authenticate to the portal and view a plain-language reason for their outcome at `/[orgSlug]/portal/decisions/:id`, scoped to their own records only.
- A claimant can open a contest that routes (via a `business_rules` ACTION rule) to a `workflows` review process that **cannot be resolved without a human reviewer**.
- An `overturned` contest writes an `AgentCorrection` (trace spec) and feeds this module's eval harness.
- `AgentFairnessMetric` rollups by privacy-safe cohort are computable and set `flagged` on threshold breach.
- DSAR export returns the subject's decrypted records across all PII-bearing `agent_` tables; erasure crypto-shreds the subject's PII (per-subject DEK destroyed) while preserving the immutable audit rows as tombstones.
- A conformity pack (system card) is generated from registry + trace; post-market monitoring renders through the `dashboards` module.
- Two-column tenancy is enforced; no portal or admin endpoint returns cross-tenant rows.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Cross-tenant leak on portal/DSAR endpoints | Critical | portal, compliance API | Two-column tenancy; filter by `organizationId` + authenticated subject; integration tests assert isolation | Low |
| Explanation leaks engineer-trace internals or other subjects' data | High | DecisionExplanationService | Derive only from disposition + `factorsUsed` + lineage refs; never serialize raw spans; review gate | Low |
| Erasure breaks the immutable audit record (AI-Act ≥6yr immutability vs GDPR Art. 17 erasure) | High | audit_logs, decision records, encryption | Combination per GAP-12: subjectId tagging/index for discovery + registry-driven DSAR/erasure service (reusing audit_logs exporters) + per-subject crypto-shredding (encrypt subject artifacts under a per-subject key, destroy the key on erasure, immutable audit rows survive). REQUIRES a NET-NEW per-subject DEK extension to `TenantDataEncryptionService`/`KmsService` with `deleteDek` (no per-subject key exists today — only per-tenant `tenant_key_<tenantId>`); effort-L dependency. Legal sign-off | Medium |
| Rubber-stamp human review (Art. 14 non-compliance) | High | contest workflow | Mandatory `reviewerUserId`; cross-check against cockpit sampled-review signals; fairness flags | Medium |
| Fairness metrics themselves expose protected attributes | High | AgentFairnessMetric | Aggregate, privacy-safe cohorts only; no per-subject attribute storage | Low |
| Assuming a `telemetry-and-otel` substrate that does not exist | Medium | post-market monitoring | Build monitoring on this module's metrics + `dashboards`; corrected in this spec | Low |
| Late retrofit of conformity programme for a high-risk domain | High | whole module | Capture decision records + lineage from first decision; ship programme at go-live | Medium |
| Optimistic-lock false 409 on contest resolution touching other entities | Medium | resolve command | Per-child header override; `enforceCommandOptimisticLock`; `surfaceRecordConflict` | Low |

## Integration Coverage

Per the repo QA rule (every feature lists coverage for affected API + key UI paths; tests ship with the change). Playwright via `.ai/qa`; self-contained two-org fixtures (`agentFixtures.ts`) created in setup and cleaned up in teardown; no reliance on seeded data.

| Surface / path | Test | Type |
|---|---|---|
| `GET /[orgSlug]/portal/decisions/:id` | Claimant sees a plain-language explanation (no engineer-trace internals); factors trace to lineage | E2E (portal) |
| `POST /[orgSlug]/portal/decisions/:id/contest` | Opens an `AgentContestCase` → review workflow with a **mandatory human reviewer**; overturn writes an `AgentCorrection` (feeds eval harness) | E2E |
| Contest resolution | `reviewerUserId` mandatory (anti-rubber-stamp); optimistic-lock 409 surfaced on concurrent resolve | API |
| `GET /api/agent_orchestrator/compliance/dsar/:subjectId` | **DSAR export completeness** — every subject-field-registry entry across all PII-bearing `agent_` tables is exercised | API |
| `POST /api/agent_orchestrator/compliance/erasure/:subjectId` | **Audit-preserving erasure** — subject PII is crypto-shredded (per-subject key destroyed) while immutable Art.12 audit rows survive (GAP-12) | API |
| `GET /api/agent_orchestrator/compliance/fairness?capability&window` | Returns privacy-safe aggregate cohorts only (k-anonymity); no per-subject protected attributes leak | API |
| RBAC / feature-gate | Portal pages enforce `requireCustomerAuth`/`requireCustomerFeatures`; admin APIs gated by `agent_orchestrator.*` features | API |
| **Tenant isolation (mandatory)** | Cross-tenant access to a decision, contest, DSAR, or fairness metric is **denied** (two-org fixture) | API |

## Migration & Backward Compatibility

- All three entities are **new tables** (`agent_decision_records`, `agent_contest_cases`, `agent_fairness_metrics`) — purely additive; no existing schema is modified by this spec. Ship MikroORM migrations + `.snapshot-open-mercato.json`.
- New ACL features are additive; add to `setup.ts` `defaultRoleFeatures` and run `yarn mercato auth sync-role-acls`.
- New event ids are additive and declared `as const` in `events.ts`.
- Depends on `AgentCorrection` and lineage from the trace/context specs — coordinate ordering: trace/context land first so `correctionId` and `factorsUsed` lineage refs resolve.
- Portal pages and `page.meta.ts` follow the existing `(frontend)` catch-all convention; no portal-routing contract changes. New portal capability `agent_orchestrator.portal.decisions.view` is additive.
- No contract-surface removals; nothing here triggers the deprecation protocol.

## Final Compliance Report

- **Tenancy:** both `tenant_id` and `organization_id` on every row; all reads filter by `organizationId`; portal scoped to authenticated subject. ✔
- **ORM:** v7 `/legacy` decorators, explicit `@Property`, UUID PK `gen_random_uuid()`, append-only logs omit `updated_at`/`deleted_at`, editable `AgentContestCase` carries `updated_at`. ✔
- **No cross-module ORM relations:** FK ids only. ✔
- **Reads via `makeCrudRoute` + indexer + openApi; writes via Command + mutation guard + optimistic lock.** ✔
- **ACL** in `acl.ts` + `setup.ts`; portal RBAC via `page.meta.ts` `requireCustomerAuth`/`requireCustomerFeatures`. ✔
- **i18n** for all user-facing strings; **DS status tokens** for outcome/contest states (no hardcoded Tailwind colors). ✔
- **Encryption** of subject PII via `TenantDataEncryptionService` / `findWithDecryption`. ✔
- **Integration coverage** required for: portal explanation + contest endpoints, DSAR/erasure/fairness admin APIs, contest mandatory-human resolution, cross-tenant isolation, **DSAR export completeness across all PII-bearing `agent_` tables** (every subject-field-registry entry is exercised), and **audit-preserving erasure asserting PII is crypto-shredded while the immutable audit rows survive** (GAP-12). ✔ (to implement with the spec)
- **No false dependency** on `telemetry-and-otel` or `eval-runner` — corrected to `dashboards` + this module's own eval harness. ✔

## Changelog

- **2026-06-20:** Corrected the GDPR DSAR/erasure capability to match verified code: there is **no per-subject encryption key today** — only the per-tenant `tenant_key_<tenantId>` in `TenantDataEncryptionService` / `KmsService`, with no per-subject DEK and no `deleteDek`. Reframed erasure as the GAP-12 combination — (a) subjectId tagging/index for discovery, (b) a registry-driven DSAR/erasure service walking a per-entity subject-field registry (reusing the `audit_logs` exporters), and (c) per-subject crypto-shredding of subject artifacts (`storage-s3` + sensitive columns) that destroys the per-subject key on erasure while immutable audit rows survive — and flagged the **NET-NEW per-subject DEK extension (with `deleteDek`)** as an effort-L dependency. Updated the GDPR capability, the erasure Risks row, the erasure admin API, the Acceptance line, and the Integration coverage line (DSAR completeness across `agent_` tables + audit-preserving erasure) accordingly.
- **2026-06-19:** Rewrote the legacy `SPEC-COMPLY-01` draft to real OM conventions and the verified 2026-06-19 architecture. Replaced pseudocode entities with full MikroORM v7 `AgentDecisionRecord` (append-only) and `AgentContestCase` (editable, optimistic-lock) plus abbreviated `AgentFairnessMetric`; added two-column tenancy; moved the claimant surface to the real portal convention (`frontend/[orgSlug]/portal/decisions/` + `page.meta.ts`); corrected post-market monitoring to `dashboards` + this module's metrics (removed the non-existent `telemetry-and-otel` substrate); corrected the eval feedback to the trace spec's own harness (removed `eval-runner`); aligned module id/paths to `agent_orchestrator`; added Architecture, Risks & Impact, Migration & BC, and Final Compliance sections.
