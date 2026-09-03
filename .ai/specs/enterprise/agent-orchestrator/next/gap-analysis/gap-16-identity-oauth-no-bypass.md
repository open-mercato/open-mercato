> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# IDENTITY: OAuth Client-Credentials Server & Runtime No-Bypass Enforcement — Design Analysis

> **Status:** Analysis · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19 · **Gap:** GAP-16 · **Priority:** P2
> **Related:** [`2026-06-19-agent-identity-and-on-behalf-of.md`](../2026-06-19-agent-identity-and-on-behalf-of.md) (identity), [`2026-06-19-agent-dispatch.md`](../2026-06-19-agent-dispatch.md) (worker auth = agent principals), [`gap-01-internal-agent-runtime.md`](./gap-01-internal-agent-runtime.md) (propose-only runtime), `api_keys` module (credential primitive), `ai_assistant` (tool allowlist + mutation policy), conventions doc (normative)

## 1. Gap statement (two parts)

The identity spec asserts two guarantees it does not yet build. Both are load-bearing for AI Act Art. 12/14 traceability and for the dispatch spec's "worker auth = agent principals."

**Part A — a real OAuth client-credentials server for external agents.** The spec promises `POST /api/agent_orchestrator/identity/token` issuing "scoped, revocable tokens on `api_keys` + `jwt.ts`," but no such endpoint, grant type, scope/claims model, or revocation path exists. Today `api_keys` exposes only CRUD key routes (`api/keys/route.ts`; ACL `api_keys.{view,create,delete}`) — there is no token endpoint and no OAuth grant. External/A2A/BYO/pull workers (dispatch spec) therefore have **no standard way to obtain a credential scoped per capability + tenant and revocable per delegation grant**.

**Part B — RUNTIME no-bypass enforcement, not just a release-gate test.** The spec's "every agent action is audited identically to a human" rests on the **no-bypass invariant**, but its only enforcement is a *shipped test* asserting no `kind='agent'` write escapes the Command path. A test is a regression gate, not a runtime control: it catches a known violation in CI, never a novel one at runtime, and never an out-of-tree caller. The codebase confirms the danger is real — **audit is not automatic**: `ActionLog` rows are written only by the Command path or an explicit `actionLogService.log()` call, and **226 files under `packages/core/src/modules` (excluding `audit_logs`/tests) call `.flush()` directly**. Any one of those, reached with a `kind='agent'` actor, would mutate state with zero audit. The invariant needs a runtime mechanism, with the test demoted to backstop.

## 2. Architectural drivers

1. **Standards conformance (Part A)** — external agents and A2A runtimes expect OAuth 2.0 client-credentials (RFC 6749 §4.4): `grant_type=client_credentials`, `scope`, a Bearer access token, and `token_type`/`expires_in`. A bespoke header scheme would not interoperate with the A2A Agent Card auth schemes the dispatch spec adopts.
2. **Revocability** — a human revoking an agent's delegation MUST stop further action *immediately*, not at token expiry. Revocation is the accountability spine: short TTL + per-request `AgentDelegationGrant.revokedAt` check.
3. **Scope granularity = capability + tenant** — the dispatch spec scopes worker credentials *per capability + tenant*. The token's claims/scope MUST encode both, and tenant scope MUST be unforgeable (never widenable by the client).
4. **Attack surface** — a token endpoint is a new unauthenticated-ish ingress (client id/secret is the only gate). It must use constant-time secret comparison, bcrypt-hashed client secrets, no secret echo, audience-bound signatures, and fail-closed verification.
5. **Audit completeness (Part B)** — the AI Act traceability claim is only as strong as its weakest write path. Defense must be *structural where possible* and *fail-closed where not*, so an un-audited agent write is impossible by construction rather than merely tested-for.
6. **OM-fit / reuse** — `api_keys` is the sanctioned credential primitive and already ships the exact session-token precedent (short-lived bearer minted from a key, scoped by roles/tenant/org, encrypted-at-rest, session-bound, fail-closed on reuse). `jwt.ts` already derives audience-scoped signing keys. A global flush-time `EventSubscriber` choke point already exists (`TenantEncryptionSubscriber`). Reuse beats reinvention on every axis.
7. **Edition** — both parts are OSS-core (identity is a core module). No enterprise gating; the later `auth.md`/ID-JAG self-onboarding path is the only deferred slice.

## 3. Approaches considered

### Part A — OAuth client-credentials server

**(A-a) Build on `api_keys` + `jwt.ts` — RECOMMENDED.** The token endpoint authenticates a client id/secret against an `AgentPrincipal` (`credentialMode='oauth_client'`), then mints a short-lived **audience-scoped JWT** via `signAudienceJwt('agent', { sub: agentUserId, obo: onBehalfOfUserId, scope, tenantId, organizationId, grantId })` (8h default → tighten to minutes for agents). Note the deliberate split from the existing precedent: today's `api_keys` session tokens are **opaque** (`sess_*` + DB lookup, no JWT) — the OAuth access token is a *new JWT layer* (the spec's "on `api_keys` + `jwt.ts`"), so verification is stateless signature-check first, then a stateful grant-revocation check, rather than a pure DB lookup. The client secret is a `generateApiKeySecret()`-style `omk_*` value, bcrypt-hashed in an `api_keys` row (`createApiKey`); the issued access token reuses `createSessionApiKey`'s scoping/TTL semantics (roles/scope, tenant/org, expiry, optional encrypted-at-rest). Verification reuses `verifyAudienceJwt('agent', token)` plus a per-request `AgentDelegationGrant.revokedAt`/`expiresAt` check. **Maps to OM primitives:** `api_keys` (`createApiKey`, `createSessionApiKey`, `findApiKeyBySecret`, `bcrypt` cost 10), `jwt.ts` (`signAudienceJwt`/`verifyAudienceJwt`, derived-secret isolation), IDENTITY (`AgentPrincipal`, `AgentDelegationGrant`), RBAC (`AgentPrincipal.roleId` → `rbacService.loadAcl`). **Pros:** zero new dependency; reuses a proven, security-reviewed primitive (the 2026-05-23 `opencodeSessionId` fail-closed binding is precedent for grant-scoped tokens); audience-derived secret means an agent JWT cannot be replayed as a staff/customer session; revocation is one column. **Cons:** we hand-implement the `/token` request/response shape and scope parsing (small, RFC-bounded); HS256 symmetric (fine for first-party issuance — no third-party verifier needs a public key yet).

**(A-b) Adopt an OAuth2 library / authorization server (e.g. `node-oidc-provider`).** Standards-complete (discovery, JWKS, introspection, DPoP). **Cons:** a heavy new production dependency and a second identity surface to operate, secure, and keep tenant-scoped — for a single grant type we already have the primitives for. Asymmetric JWKS only matters once external parties verify our tokens (the ID-JAG-later path), not for client-credentials issuance. **Reject for now; reconsider only with (A-c).**

**(A-c) Defer to an external IdP / the `auth.md`/ID-JAG path.** The spec's documented *later* path: Protected Resource Metadata + `/agent/auth` verifying a provider ID-JAG against its JWKS. **Cons:** depends on external self-onboarding at scale that does not exist yet; ID-JAG/`auth.md` is a still-emerging external standard. **Adopt later, additively** — the `AgentDelegationGrant` already carries `issuer`/`subject`/`audience` so the same record bridges OAuth-now and ID-JAG-later with no schema change.

### Part B — runtime no-bypass enforcement

**(B-a) Test-only assertion — INSUFFICIENT (flagged).** A release-gate test asserting "no `kind='agent'` write outside the Command path." **Cons:** catches only known, in-tree, exercised paths; 226 raw `.flush()` sites mean coverage is structurally incomplete; no runtime protection against a new caller or an out-of-tree module. Necessary as a backstop, **never sufficient alone.**

**(B-b) Runtime write-interceptor — DEFENSE-IN-DEPTH.** A global MikroORM `EventSubscriber` (`beforeCreate`/`beforeUpdate`/`beforeDelete`, `getSubscribedEntities()=[]` → all entities) that resolves the request-scoped actor and, when the actor is a `kind='agent'` principal, **rejects (fail-closed) any write lacking a valid audit/command context**. **Maps to OM primitives:** the identical pattern already ships in `packages/shared/src/lib/encryption/subscriber.ts` (`TenantEncryptionSubscriber` — a global all-entity flush-time hook registered once per `EventManager`), plus the DI-scoped request container that already threads the actor. **Pros:** a single runtime choke point that covers all 226 flush sites and any future one; fail-closed; cheap because the hook infrastructure exists. **Cons:** needs a reliable "this write is inside an audited Command" signal on the scoped context (a flag the Command path sets, e.g. `ctx.commandAuditScope`); a coarse hook can't easily distinguish the `AgentProposal`/`AgentRun` writes the agent's *own* Command legitimately makes — so the gate must key on "command-audited context present," not "no agent writes at all."

**(B-c) Structural propose-only — RECOMMENDED PRIMARY (ties to GAP-01).** Orchestrated agent principals are issued **read + propose tools only — no mutating tools at all** — so there is nothing to bypass. Per GAP-01, the internal runtime uses `runAiAgentObject` object-mode, which **passes no tools to the model** and runs under `readOnly:true` + `mutationPolicy:'read-only'`; the agent's only "write" is the `AgentProposal` row, emitted by OM's own audited Command path. Execution of the proposal happens later as OM effector activities under **OM's own authority**, not the agent's. **Maps to OM primitives:** `ai_assistant` mutation-policy gate (strips every `isMutation:true` tool from a read-only agent — confirmed in `agent-tools.ts`/`prepare-mutation.ts`: `prepareMutation` throws `read_only_agent` and **never invokes the tool handler**), the allowlist intersection, GAP-01's object-mode posture. **Pros:** the strongest guarantee — propose-only is *by construction*, the agent cannot mutate even if every other control failed; reuses the existing, already-enforced policy gate. **Cons:** covers *orchestrated/internal* agents fully; external/A2A agents that OM grants a token to (Part A) could in principle call write APIs, so (B-c) must be **paired with (B-b)** to cover the token-bearing external case.

## 4. Trade-off matrix

| Driver | A-a api_keys+jwt | A-b OAuth lib | A-c external IdP | B-a test-only | B-b interceptor | B-c structural propose-only |
|---|---|---|---|---|---|---|
| Standards conformance | High (RFC 6749 §4.4) | High (full AS) | High (ID-JAG) | — | — | — |
| Revocability | High (grant column) | High | Medium (external) | — | n/a | n/a |
| Scope granularity (cap+tenant) | High (claims) | High | Medium | — | High (enforced) | High (no tools) |
| Attack surface | Low (reuse hardened) | Medium (new AS) | Medium (trust) | — | Low | Lowest (nothing to attack) |
| Audit completeness | n/a | n/a | n/a | Low (CI only) | High (all writes) | High (by construction) |
| OM-fit / reuse | High | Low (new dep) | Low (future) | High | High (subscriber exists) | High (policy gate exists) |
| Effort | S–M | L | L (later) | XS | M | S (rides GAP-01) |

## 5. Recommendation

**Conclusive.**
- **Part A:** adopt **(A-a)** — build the client-credentials `/token` server on `api_keys` + `jwt.ts` now; keep **(A-c)** (`auth.md`/ID-JAG) as the additive later path on the same `AgentDelegationGrant`. Reject (A-b) until an external verifier (asymmetric JWKS) is actually required. Rationale: the session-token precedent (`createSessionApiKey` + `signAudienceJwt` + the `opencodeSessionId` fail-closed binding) already implements ~80% of this — short-lived bearer minted from a hashed key, scoped by roles/tenant/org, revocable, audience-isolated. A new dependency would re-derive a worse version.
- **Part B:** adopt **(B-c) as the primary structural defense + (B-b) as defense-in-depth + (B-a) as the regression backstop** — a three-layer fail-closed posture. Rationale: (B-c) makes orchestrated agents incapable of un-audited writes *by construction* (no mutating tools), which is the cheapest and strongest guarantee and rides GAP-01 for free; (B-b) extends fail-closed coverage to the token-bearing external case across all 226 flush sites via the already-proven global-subscriber pattern; (B-a) keeps the named release-gate test as a cheap, fast CI signal. No single layer is trusted alone — that is the point.

## 6. Effort, risks, dependencies

**Effort: M.** Part A: `/token` endpoint + scope/claims model + client-secret provisioning on `AgentPrincipal` + verification middleware + `/grants/:id/revoke` (with `enforceCommandOptimisticLock`) — S–M, mostly composition of `api_keys`/`jwt.ts`. Part B: (B-c) is S (rides GAP-01's read-only object-mode); (B-b) is M (the `AgentKindNoBypassSubscriber` + the "command-audited context" flag on the scoped container); (B-a) is XS.

**Risks:**
- *Token over-scope / tenant widening* (High→Low): scope/tenant come from the server-side `AgentPrincipal` + `AgentDelegationGrant`, never from client input; tenant is signed into the JWT and re-checked per request. Mitigate via a scope-narrowing test (client cannot request a capability/tenant outside its grant).
- *Stale token after revoke* (High→Low): short TTL (minutes) + per-request `revokedAt`/`expiresAt` check + `getSharedApiKeyAuthCache().invalidateByKeyId` on revoke (existing helper).
- *Interceptor false-positives on the agent's own legitimate writes* (Medium): (B-b) must key on "no command-audited context present," not "actor is agent" — the `AgentProposal`/`AgentRun` Command writes carry the flag and pass. Mitigate with a unit test for both directions (legit command write passes; raw `em.flush()` with agent actor throws).
- *Symmetric HS256 limits external verification* (Low, deferred): acceptable for first-party issuance; revisit asymmetric JWKS only with the ID-JAG path (A-c).
- *Subscriber registration ordering* (Low): mirror `TenantEncryptionSubscriber`'s `registeredEventManagers` WeakSet so the guard is attached exactly once.

**Dependencies:** IDENTITY (`AgentPrincipal` with client-secret fields + `AgentDelegationGrant`); GAP-01 (read-only object-mode runtime — supplies (B-c)); `api_keys` (`createApiKey`/`createSessionApiKey`/bcrypt/auth cache); `jwt.ts` (`signAudienceJwt`/`verifyAudienceJwt`); the DI-scoped request container that threads the actor (for (B-b)); `ai_assistant` mutation-policy gate (already enforced, supplies (B-c) for any chat-mode agent).

## 7. Concrete deliverables + acceptance

**Deliverables (OM conventions, module `agent_orchestrator`, code under `lib/identity/`):**
- **Token endpoint:** `POST /api/agent_orchestrator/identity/token` — OAuth client-credentials. Body `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`. Validates secret (bcrypt, constant-time) against the `AgentPrincipal`'s `api_keys` row → mints `signAudienceJwt('agent', …)` with `expires_in`; returns RFC-6749 `{ access_token, token_type:'Bearer', expires_in, scope }`. No secret echo. Custom write → Command path + mutation guard.
- **Scope / claims model:** JWT claims `{ iss:'open-mercato', aud:'agent', sub:agentUserId, obo:onBehalfOfUserId|null, tenantId, organizationId, scope:'<capability>:<action> …', grantId }`. Scope and tenant are server-derived from `AgentPrincipal` + `AgentDelegationGrant`; client input never widens them. Capability + tenant are the granularity unit (dispatch contract).
- **Verification middleware:** `verifyAudienceJwt('agent', token)` + load the `AgentDelegationGrant` and reject when `revokedAt != null` or `expiresAt < now`; attach `{ actorUserId:sub, onBehalfOfUserId:obo, sourceKey:'agent', features:acl.features }` to the request actor.
- **Revocation:** `POST /api/agent_orchestrator/identity/grants/:id/revoke` → sets `revokedAt`; `enforceCommandOptimisticLock` (grant carries `updatedAt`); 409 via `surfaceRecordConflict`; `getSharedApiKeyAuthCache().invalidateByKeyId`.
- **No-bypass mechanism (3 layers):**
  - *(B-c) structural:* orchestrated/internal agent principals carry READ + propose tools only; object-mode passes no tools (GAP-01) — assert zero `isMutation:true` tools reachable.
  - *(B-b) runtime:* `AgentKindNoBypassSubscriber` (global `EventSubscriber`, all entities, mirrors `TenantEncryptionSubscriber`) that throws fail-closed on a create/update/delete when the scoped actor is `kind='agent'` and no command-audited context flag is present.
  - *(B-a) backstop:* the shipped release-gate test asserting no `kind='agent'` actor on any write outside the audited Command path.

**Acceptance:**
- An external agent obtains a Bearer token via client-credentials, scoped to exactly its granted capability + tenant; a request for a capability/tenant outside its grant is rejected.
- Revoking the `AgentDelegationGrant` stops further agent action immediately (next request fails verification), not at token expiry.
- An agent JWT cannot be replayed as a staff or customer session (audience-derived secret isolation).
- A raw `em.flush()` reached with a `kind='agent'` actor and no command-audited context is rejected at runtime by (B-b); the agent's own `AgentProposal` Command write passes.
- No orchestrated agent holds any mutating tool (B-c); the release-gate test (B-a) passes.

## Changelog

- **2026-06-19:** Created. Analyzed GAP-16's two parts. Part A: recommended building the OAuth client-credentials `/token` server on `api_keys` + `jwt.ts` (A-a), justified against the verified session-token precedent (`createSessionApiKey` + `signAudienceJwt` + the `opencodeSessionId` fail-closed binding) and `api_keys`' lack of any token/OAuth route today; rejected a heavy OAuth library (A-b); kept `auth.md`/ID-JAG (A-c) as the additive later path on the existing `AgentDelegationGrant` issuer/subject/audience fields. Part B: recommended structural propose-only (B-c, tied to GAP-01's tool-less object-mode + the confirmed `ai_assistant` mutation-policy gate) as primary, a runtime fail-closed write-interceptor (B-b, mirroring the existing global `TenantEncryptionSubscriber`) as defense-in-depth, and the named release-gate test (B-a) as backstop. Documented the load-bearing finding that audit is NOT automatic — 226 `.flush()` sites outside `audit_logs` — which is why a test alone is insufficient.
