> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent Identity & On-Behalf-Of

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Updated:** 2026-06-19
> **Module:** `agent_orchestrator` (core module at `packages/enterprise/src/modules/agent_orchestrator/`) · **subdomain:** `identity` · **Depends:** `auth`, `audit_logs`, `api_keys`, orchestration spec (`2026-06-19-agent-orchestration-step-and-proposal.md`)
> **Conventions:** Governed by `2026-06-19-agent-orchestrator-conventions.md` (normative; wins on any entity/structure conflict).

## TLDR

Make agents **first-class principals** so every agent action is registered, authorized, and audited *identically to a human's* — through Open Mercato's existing Command/CRUD/ACL/audit pipeline — and record a verifiable **on-behalf-of** chain from the agent back to the human (or system) that invoked it. Humans authenticate interactively; agents authenticate via a **non-interactive standard credential flow** (OAuth client-credentials now, **net-new** but built on the proven `signAudienceJwt` helper + the `api_keys` session-token scoping/revocation precedent; `auth.md`/ID-JAG self-registration later). The interactive password/SSO path is simply not exposed to `kind='agent'` — a property of the principal, not a special block.

Identity introduces one new principal kind on `auth.User`, one new attribution column on `audit_logs.ActionLog`, two new module-owned entities (`AgentPrincipal`, `AgentDelegationGrant`), and the **no-bypass invariant** that makes the "every agent write is audited" guarantee real.

## Overview

The orchestration spec defines the `INVOKE_AGENT` step that runs an agent in-process. This spec answers: *who is the actor on the resulting writes, and on whose behalf?* It models the agent as a passwordless `auth.User` row (`kind='agent'`), links that user to its agent definition + scoped role via `AgentPrincipal`, and threads an `onBehalfOfUserId` through the execution context onto every `ActionLog`. External agents obtain scoped, revocable credentials bound to an `AgentPrincipal` and an `AgentDelegationGrant`.

## Problem Statement

Agent actions today would be attributed either to the invoking human (wrong — hides the agent) or to a generic system actor (wrong — loses accountability). There is no agent principal, no human→agent attribution chain, and no standard way for external agents to obtain scoped, revocable credentials. For a high-risk regulated domain this breaks auditability and AI Act Art. 12/14 traceability.

Two assumptions in earlier drafts were verified false and are corrected here:

1. **`auth.User` has no `kind` field** and **`audit_logs.ActionLog` has no `onBehalfOfUserId`** — both must be added.
2. **`ActionLog` writes are NOT universally automatic.** Audit is **opt-in**: there are ~226 `.flush()` sites outside `audit_logs`, and `ActionLog` is written via the Command path or by calling `actionLogService.log()` explicitly — there is no blanket "every `em.flush()` is audited" guarantee. So the "every agent action audited identically to a human" promise is an **invariant this spec must enforce at runtime**, not one it inherits for free.
3. **`api_keys` has no OAuth client-credentials flow today** — it issues opaque keys + `sess_*` session tokens only. The external-agent client-credentials `/token` server is therefore **net-new**, built on the proven `signAudienceJwt` helper (`packages/shared/src/lib/auth/jwt.ts`) plus the `api_keys` session-token scoping/revocation precedent (including the 2026-05-23 `opencodeSessionId` fail-closed binding). This is net-new-built-on-precedent, **not** reuse of an existing OAuth endpoint.

## Proposed Solution

- Add `User.kind: 'human' | 'agent' | 'service'` (NOT NULL, default `'human'`) in the **`auth`** module.
- Add `ActionLog.onBehalfOfUserId: uuid | null` (indexed) in the **`audit_logs`** module, and add `'agent'` to the `ActionLogSourceKey` union in `audit_logs/lib/projections.ts`.
- Add module-owned `AgentPrincipal` and `AgentDelegationGrant` entities under `agent_orchestrator/data/entities.ts`.
- Provide `ExecutionContext.runAs({ agentUserId, onBehalfOfUserId })` so the orchestration spec's `INVOKE_AGENT` step sets `{ actorUserId, onBehalfOfUserId, sourceKey: 'agent' }` and the existing audit/ACL pipeline applies automatically.
- Enforce the **no-bypass invariant** with a **three-layer model**: (1) a fail-closed MikroORM flush-time write-interceptor that rejects any `kind='agent'` write lacking actor + audit context, (2) structural propose-only execution (object-mode, no tools), and (3) the shipped release-gate test as a backstop asserting no `kind='agent'` actor appears on any write outside the audited Command path.
- For external/A2A/BYO agents: a **net-new** OAuth client-credentials `/token` server (scoped, revocable tokens built on `signAudienceJwt` + the `api_keys` session-token scoping/revocation precedent) + an `AgentDelegationGrant` binding the agent to its on-behalf-of human.

## Architecture

```
Human invokes workflow ──▶ orchestration INVOKE_AGENT step
                              │
                              ▼
        ExecutionContext.runAs({ agentUserId, onBehalfOfUserId: invokerId })
                              │  sourceKey = 'agent'
                              ▼
        Agent calls tools ──▶ ai_assistant tool allowlist + mutation-policy
                              │  (raw-write tools forbidden)
                              ▼
        Command / CRUD path ──▶ emits ActionLog (actorUserId=agentUserId,
                              │                    onBehalfOfUserId=invokerId,
                              │                    sourceKey='agent')
                              │  + events + index side effects
                              ▼
        audit query: GET /api/.../audit/by-instigator/:humanUserId
                       joins ActionLog on onBehalfOfUserId
```

External agents enter through `POST /api/agent_orchestrator/identity/token` (client-credentials) → receive a scoped JWT bound to an `AgentPrincipal` → all subsequent writes funnel into the same Command path with the same `sourceKey='agent'` attribution.

What Open Mercato already provides (reuse — this is why it is cheap):

- **`auth`**: single `User` entity with **nullable `passwordHash`** (passwordless principals already supported); `Role`/`RoleAcl`/`UserAcl` RBAC; JWT sessions; `customer_users` as a separate table — precedent for distinct principals. JWT helper at `packages/shared/src/lib/auth/jwt.ts`.
- **`audit_logs.ActionLog`**: `actorUserId`, `sourceKey` (currently `['ui','api','system']`, derived via `deriveActionLogSource()`), `context_json`, `parentResource*` chaining, before/after snapshots.
- **`api_keys`**: real module (`ApiKey` with key hash/prefix/roles/session) issuing **opaque keys + `sess_*` session tokens** — the scoping/revocation precedent (incl. the 2026-05-23 `opencodeSessionId` fail-closed binding) the net-new client-credentials `/token` server builds on. Note: `api_keys` has **no** OAuth client-credentials flow today.
- **`signAudienceJwt`** (`packages/shared/src/lib/auth/jwt.ts`): the audience-scoped JWT signing helper the net-new `/token` server uses to mint scoped, revocable agent tokens.

The hard part (threading actor identity + the audit pipeline) exists. This spec adds a principal *kind*, an on-behalf-of field, two entities, and a net-new credential flow built on these precedents.

## Data Models

### AgentPrincipal (module-owned, editable → has `updated_at`)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentCredentialMode = 'internal' | 'oauth_client' | 'authmd'

@Entity({ tableName: 'agent_principals' })
@Index({ name: 'agent_principals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_principals_user_idx', properties: ['userId'] })
export class AgentPrincipal {
  [OptionalProps]?: 'enabled' | 'credentialMode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string // FK id → auth.User (kind='agent'); NOT an ORM relation

  @Property({ name: 'agent_definition_id', type: 'uuid' })
  agentDefinitionId!: string // FK id → orchestration AgentDefinition

  @Property({ name: 'role_id', type: 'uuid' })
  roleId!: string // FK id → auth.Role (scoped, least privilege)

  @Property({ name: 'credential_mode', type: 'varchar', length: 20, default: 'internal' })
  credentialMode: AgentCredentialMode = 'internal'

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### AgentDelegationGrant (module-owned, editable via revoke → has `updated_at`)

Binds an agent to the human it acts on behalf of. For external agents it also carries the OIDC/ID-JAG assertion fields (issuer/subject/audience) so the same record bridges the OAuth-now and ID-JAG-later paths.

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'agent_delegation_grants' })
@Index({ name: 'agent_delegation_grants_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_delegation_grants_agent_idx', properties: ['agentUserId'] })
@Index({ name: 'agent_delegation_grants_obo_idx', properties: ['onBehalfOfUserId'] })
export class AgentDelegationGrant {
  [OptionalProps]?: 'scopes' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_user_id', type: 'uuid' })
  agentUserId!: string // FK id → auth.User (kind='agent')

  @Property({ name: 'on_behalf_of_user_id', type: 'uuid' })
  onBehalfOfUserId!: string // FK id → auth.User (kind='human')

  @Property({ name: 'issuer', type: 'varchar', length: 255, nullable: true })
  issuer?: string | null // OIDC/ID-JAG iss

  @Property({ name: 'subject', type: 'varchar', length: 255, nullable: true })
  subject?: string | null // OIDC/ID-JAG sub

  @Property({ name: 'audience', type: 'varchar', length: 255, nullable: true })
  audience?: string | null // OIDC/ID-JAG aud

  @Property({ name: 'scopes', type: 'jsonb', nullable: true })
  scopes?: any | null // shape enforced by Zod in data/validators.ts

  @Property({ name: 'issued_at', type: Date, onCreate: () => new Date() })
  issuedAt: Date = new Date()

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### Additive changes to OTHER modules' entities

These are **additive changes to contract surfaces owned by other modules** (`auth`, `audit_logs`), governed by `BACKWARD_COMPATIBILITY.md` (DB schema + types are STABLE/ADDITIVE-ONLY). They land in their **home modules**, NOT in `agent_orchestrator/data/extensions.ts` (entity extensions are for new *linked entities*, not new columns on a core entity). Each ships its own migration + `.snapshot-open-mercato.json` and is coordinated with the module owner.

```typescript
// auth/data/entities.ts — ADD to User (NOT NULL, defaulted; existing rows unaffected)
export type UserKind = 'human' | 'agent' | 'service'

@Property({ name: 'kind', type: 'varchar', length: 20, default: 'human' })
kind: UserKind = 'human'
```

```typescript
// audit_logs/data/entities.ts — ADD to ActionLog (nullable, indexed; existing rows unaffected)
@Property({ name: 'on_behalf_of_user_id', type: 'uuid', nullable: true })
@Index({ name: 'action_logs_obo_idx' })
onBehalfOfUserId?: string | null
```

```typescript
// audit_logs/lib/projections.ts — ADD 'agent' to the union (additive only)
export type ActionLogSourceKey = 'ui' | 'api' | 'system' | 'agent'
```

## Authentication Model (two standard flows, one principal model)

- **Humans** → existing interactive JWT session + 2FA. Unchanged. The interactive login path is not exposed to `kind='agent'` (a property check, not a special block).
- **Internal agents** (in-process, via the orchestration spec's `INVOKE_AGENT` step) → **no network auth**. The step sets execution context `{ actorUserId: agentUserId, onBehalfOfUserId: invokerId | null, sourceKey: 'agent' }`. Existing audit + ACL then apply automatically. The wrapper is `ExecutionContext.runAs({ agentUserId, onBehalfOfUserId })`.
- **External / A2A / BYO agents** → non-interactive standard credentials:
  - **Now:** a **net-new** OAuth **client-credentials** `/token` server issuing scoped, revocable tokens to an `AgentPrincipal` — built on `signAudienceJwt` (`jwt.ts`) + the `api_keys` session-token scoping/revocation precedent (incl. the 2026-05-23 `opencodeSessionId` fail-closed binding), **not** a reused existing OAuth endpoint — with an `AgentDelegationGrant` binding the agent to its on-behalf-of human.
  - **Later (additive, gated on external self-onboarding at scale):** `auth.md` discovery + Protected Resource Metadata (`/.well-known/oauth-protected-resource`) + `/agent/auth` verifying a provider **ID-JAG** against its JWKS → issues the scoped token + `AgentDelegationGrant`. `auth.md`/ID-JAG is an **external standard (future)**; the net-new client-credentials server on `signAudienceJwt` + `api_keys` precedent is the **now-path**. The ID-JAG is the verifiable, revocable on-behalf-of proof when it arrives.

## The No-Bypass Invariant (load-bearing, three-layer)

`ActionLog` writes are **not** universally automatic — audit is opt-in across ~226 `.flush()` sites — so the "every agent action is audited identically to a human" guarantee cannot rely on a test alone. It needs a **runtime control** plus structural narrowing plus a backstop. Enforce it in three layers:

1. **Layer 1 — fail-closed flush-time write-interceptor (runtime control, the load-bearing layer).** Add a MikroORM `EventSubscriber` that fires on flush (mirroring the existing `TenantEncryptionSubscriber` at `packages/shared/src/lib/encryption/subscriber.ts`) and **rejects any write attributed to a `kind='agent'` actor that lacks actor + audit context** (no `actorUserId`/`onBehalfOfUserId`/`sourceKey='agent'` propagated, i.e. not on the audited Command path). This makes the bypass *impossible at runtime*, not merely detectable after the fact — a raw `EntityManager` write by an agent throws at flush.
2. **Layer 2 — structural propose-only.** Agents run in object-mode with **no tools** (propose-only); combined with the `ai_assistant` tool allowlist + mutation-policy forbidding raw-write tools and the guardrails spec's tool-scope check, an agent has no path to a direct mutation in the first place.
3. **Layer 3 — release-gate test (backstop).** Ship the no-bypass test asserting no `kind='agent'` actor ever appears on a write that did not flow through the audited Command path. It gates merge as a regression backstop behind the runtime control — not the sole guarantee.

This three-layer model (runtime interceptor + structural propose-only + release-gate test) is the contract; see GAP-16 for the broader audit-completeness analysis it cross-references.

## API Contracts

- **Internal:** `ExecutionContext.runAs({ agentUserId, onBehalfOfUserId })` — wrapper used by the orchestration `INVOKE_AGENT` step. Sets `sourceKey='agent'`.
- **External token (now):** `POST /api/agent_orchestrator/identity/token` — **net-new** OAuth client-credentials server (built on `signAudienceJwt` + `api_keys` session-token scoping/revocation precedent, not a reused endpoint) → scoped JWT + `AgentDelegationGrant`. Custom write → Command + mutation-guard (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`).
- **Revocation:** `POST /api/agent_orchestrator/identity/grants/:id/revoke` → sets `revokedAt`; enforces optimistic locking (`enforceCommandOptimisticLock`) since `AgentDelegationGrant` carries `updatedAt`; surfaces 409 via `surfaceRecordConflict`.
- **Audit query:** `GET /api/agent_orchestrator/audit/by-instigator/:humanUserId` → all actions a human caused directly or via agents, joined on `ActionLog.onBehalfOfUserId`.
- **Later:** `GET /.well-known/oauth-protected-resource`, `GET /auth.md`, `POST /agent/auth` (ID-JAG verify → token).

CRUD reads (`/identity/principals`, `/identity/grants`) use `makeCrudRoute` with `indexer: { entityType: 'agent_orchestrator:agent_principal' }` etc., and each route file exports `openApi`.

## Phases

1. `User.kind` (auth) + `AgentPrincipal` provisioning (agent `User` + scoped `Role`) — internal agents fully attributed.
2. `ActionLog.onBehalfOfUserId` + `'agent'` source key (audit_logs) + `runAs` context propagation in `INVOKE_AGENT` (and through dispatch/trace) + audit UI chain ("Agent X on behalf of Y").
3. External agents: net-new OAuth client-credentials `/token` server (scoped tokens on `signAudienceJwt` + `api_keys` precedent) + `AgentDelegationGrant` + the three-layer no-bypass enforcement (flush-time write-interceptor + structural propose-only + release-gate test).
4. `auth.md` / ID-JAG self-registration (`/.well-known` + `/agent/auth`) for external-agent onboarding at scale (additive).

## Acceptance

- Every agent action writes an `ActionLog` with `actorUserId` = the agent principal and, when human-invoked, `onBehalfOfUserId` = the human — through the same Command/CRUD/ACL path as a human action.
- Agents cannot use the interactive login flow; they authenticate only via non-interactive standard credentials.
- A single query (`/audit/by-instigator/:humanUserId`) returns everything a given human caused directly and via agents.
- No `kind='agent'` actor appears outside the audited Command path (enforced at runtime by the fail-closed flush-time write-interceptor, narrowed by structural propose-only, backstopped by the release-gate test).
- External-agent tokens are scoped and revocable; revoking an `AgentDelegationGrant` stops further action immediately.
- `User.kind` defaults `'human'` for all existing rows; `ActionLog.onBehalfOfUserId` defaults `null`; no existing reader breaks.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Raw `EntityManager` write by an agent bypasses audit | High | audit completeness, AI Act Art. 12 | Three-layer no-bypass invariant: fail-closed flush-time write-interceptor (runtime) + structural propose-only + release-gate test backstop | Low — runtime interceptor makes the bypass throw, not just flag |
| `User.kind` migration breaks external readers of `auth.User` | Medium | auth contract surface | NOT NULL + default `'human'`; additive only; coordinate with auth owner; ship migration + snapshot | Low |
| `ActionLog.onBehalfOfUserId` / `'agent'` source key breaks audit consumers | Medium | audit_logs contract surface | Nullable + indexed; union additive only; coordinate with audit_logs owner | Low |
| Stale/over-broad agent token after human revokes access | High | least privilege, accountability | Short-lived scoped JWT + `AgentDelegationGrant.revokedAt` checked per request; revoke endpoint with optimistic lock | Low |
| Cross-tenant leakage on principal/grant rows | High | tenant isolation | Both `tenant_id` and `organization_id` on every row; queries filter by `organizationId` | Low |
| Confusion between internal (no-auth) and external (token) flows | Low | implementation correctness | `credentialMode` on `AgentPrincipal` selects the path explicitly | Low |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-IDN-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts`). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `/api/agent_orchestrator/identity/token` | `POST` | happy path (client-credentials → scoped, revocable JWT bound to `AgentPrincipal` + `AgentDelegationGrant`); invalid-credential rejection (401); RBAC/feature-gate; tenant-isolation (org B credentials cannot mint a token scoped to org A) |
| `/api/agent_orchestrator/identity/grants/:id/revoke` | `POST` | happy path (sets `revokedAt`); revoked token denied on the **next** write — revoking the grant stops further action immediately; optimistic-lock 409 on stale `updatedAt` via `surfaceRecordConflict`; tenant-isolation (org B 404 on org A grant) |
| `/api/agent_orchestrator/audit/by-instigator/:humanUserId` | `GET` | returns actions a human caused **directly + via agents** (joined on `ActionLog.onBehalfOfUserId`, `actorUserId`=agent principal, `onBehalfOfUserId`=human); org-scoped; RBAC; tenant-isolation |
| `/identity/principals`, `/identity/grants` (CRUD) | `GET` | list returns `updatedAt`; org-scoped; RBAC read; tenant-isolation |
| Interactive login path for `kind='agent'` | — | an agent principal **cannot** authenticate via the interactive login flow (property of the principal, not a special block) |
| No-bypass invariant (release gate) | — | **no `kind='agent'` write appears outside the audited Command path** — a raw `EntityManager` write by an agent throws at flush (Layer 1 interceptor); the release-gate test backstops it |

**Per-action attribution (the headline assertion):** every agent action writes an `ActionLog` with `actorUserId` = the agent principal and, when human-invoked, `onBehalfOfUserId` = the human — through the same Command/CRUD/ACL path as a human action.

**Tenant-isolation harness (mandatory for every entity surface):** create two orgs/tenants (`createUserFixture` per org), seed an `AgentPrincipal`/`AgentDelegationGrant` in org A, assert org B's token gets 404/403 (never the row) on read, revoke, and CRUD list. Cleanup both in teardown.

## Migration & Backward Compatibility

This spec touches **three contract surfaces owned by other modules** — all governed by `BACKWARD_COMPATIBILITY.md` (DB schema + types: STABLE / ADDITIVE-ONLY). All changes are additive; none remove or rename existing fields.

1. **`auth.User.kind`** (`varchar(20)`, NOT NULL, default `'human'`). Existing rows backfill to `'human'` via the column default — no data migration step needed. New type `UserKind`. Lands in the `auth` module with its own migration + `auth/migrations/.snapshot-open-mercato.json`. Coordinate with the auth module owner.
2. **`audit_logs.ActionLog.onBehalfOfUserId`** (`uuid`, nullable, indexed `action_logs_obo_idx`). Existing rows default to `null`. Lands in the `audit_logs` module with its own migration + snapshot.
3. **`ActionLogSourceKey` union** in `audit_logs/lib/projections.ts`: add `'agent'` to `['ui','api','system']`. Additive only — existing source keys and `deriveActionLogSource()` behavior unchanged. Lands in `audit_logs`.

The two module-owned entities (`AgentPrincipal`, `AgentDelegationGrant`) are net-new tables in `agent_orchestrator` with their own migration + snapshot — no backward-compat concern. Per the conventions doc, these additive column changes do **not** go through `agent_orchestrator/data/extensions.ts` (that mechanism is for new linked entities, not new columns on a core entity). No deprecation protocol is required because nothing is removed; the deprecation rules would only apply if a later change narrowed or dropped these surfaces.

## Final Compliance Report

- **Tenancy:** every new row carries both `tenant_id` and `organization_id`, indexed together; all queries filter by `organizationId`. ✓
- **MikroORM v7:** `/legacy` decorators, `OptionalProps`, explicit `@Property({ name, type })`, UUID PK `defaultRaw 'gen_random_uuid()'`, varchar+TS-union enums, jsonb+Zod, no cross-module ORM relations (FK ids only). ✓
- **Optimistic locking:** `AgentPrincipal` and `AgentDelegationGrant` are editable → expose `updated_at`, return `updatedAt` in list/detail; revoke enforces command-level optimistic lock + `surfaceRecordConflict`. ✓
- **Audit:** three-layer no-bypass invariant — fail-closed flush-time write-interceptor (runtime, mirrors `TenantEncryptionSubscriber`) + structural propose-only + release-gate test backstop. ✓
- **API:** `/api/agent_orchestrator/...`; custom writes via Command + mutation guard + optimistic lock; CRUD reads via `makeCrudRoute` + `indexer` + `openApi`. ✓
- **ACL:** `agent_orchestrator.identity.*` features in `acl.ts` + `setup.ts` `defaultRoleFeatures` (run `yarn mercato auth sync-role-acls`). ✓
- **Events:** declared in `events.ts` via `createModuleEvents` (`module.entity.action`, past tense), e.g. `agent_principal.created`, `agent_delegation_grant.revoked`. ✓
- **i18n / HTTP / UI:** all strings via `i18n/`; `apiCall*`; custom UI writes via `useGuardedMutation`. ✓
- **Backward compatibility:** all cross-module changes additive, in home modules, with per-module migration + snapshot. ✓

## Changelog

- **2026-06-20:** Applied cross-cutting corrections verified against real code. (1) `api_keys` has **no** OAuth client-credentials flow today (only opaque keys + `sess_*` session tokens), so the external-agent `/token` server is reframed as **net-new built on precedent** — `signAudienceJwt` (`packages/shared/src/lib/auth/jwt.ts`) + the `api_keys` session-token scoping/revocation precedent (incl. the 2026-05-23 `opencodeSessionId` fail-closed binding) — not reuse of an existing OAuth endpoint. (2) Audit is **opt-in** (~226 `.flush()` sites outside `audit_logs`; `ActionLog` written via the Command path / explicit `actionLogService.log()`), so the No-Bypass Invariant is strengthened from a test-only guarantee to a **three-layer runtime model**: a fail-closed MikroORM flush-time `EventSubscriber` write-interceptor rejecting any `kind='agent'` write lacking actor+audit context (mirroring `TenantEncryptionSubscriber` at `packages/shared/src/lib/encryption/subscriber.ts`) + structural propose-only (object-mode, no tools) + the release-gate test as backstop (cross-refs GAP-16). Propagated both corrections through TLDR, Problem Statement, Proposed Solution, Architecture-precedents, Authentication Model, API Contracts, Phases, Acceptance, Risks, and Final Compliance Report. Added the `## Integration Coverage` section per GAP-17 (token client-credentials flow, grant revocation/immediate-stop, by-instigator audit join, agents-cannot-interactive-login, no-bypass release gate, per-action attribution, and the mandatory two-org tenant-isolation harness; tests module-local under `__integration__/` with self-contained fixtures + teardown).
- **2026-06-19:** Rewrite to real Open Mercato conventions and verified architecture. Corrected: package→core-module framing; `@Json()`/`@Enum()`/bare-prop pseudocode → full MikroORM v7 entities; single-column tenancy → `tenant_id` + `organization_id`; renamed `DelegationGrant` → `AgentDelegationGrant`; API paths to `/api/agent_orchestrator/identity/...`. Made explicit that `User.kind` is NOT NULL default `'human'`, `ActionLog.onBehalfOfUserId` is nullable+indexed, and `'agent'` joins the `ActionLogSourceKey` union — all additive changes in their home modules (auth, audit_logs), not in `data/extensions.ts`. Reframed the audit guarantee as the load-bearing **no-bypass invariant** (tool allowlist + mutation-policy + guardrails tool-scope + release-gate test), since `ActionLog` writes are not automatic. Clarified internal (in-process, no-auth, `runAs`) vs external (OAuth client-credentials now on `api_keys` + `jwt.ts`; `auth.md`/ID-JAG later) flows. Added required Risks & Impact Review and Migration & Backward Compatibility sections.
