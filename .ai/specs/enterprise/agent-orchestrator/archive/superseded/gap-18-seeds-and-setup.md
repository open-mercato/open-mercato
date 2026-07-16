> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Seeds & Setup Inventory — Design Analysis

> **Gap:** GAP-18 · **Priority:** P3 · **Status:** Draft · **Created:** 2026-06-19
> **Related:** orchestration (`2026-06-19-agent-orchestration-step-and-proposal.md`), guardrails (`2026-06-19-agent-runtime-guardrails.md`), dispatch (`2026-06-19-agent-dispatch.md`), identity (`2026-06-19-agent-identity-and-on-behalf-of.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`); core **Module Setup Convention** (`packages/core/AGENTS.md`).
> **Note:** `telemetry-and-otel` does NOT exist; no telemetry seeding is in scope.

## 1. Gap statement

Every sub-spec *references* default config that ships with the module but **none enumerates it**. Specifically:

- The orchestration spec says disposition is a `business_rules` rule pack with `entityType 'agent_orchestrator:proposal'` (auto-approve thresholds on confidence/fraud/payout) — but no default pack is listed, and there is no `agent_orchestrator/setup.ts` `seedDefaults`.
- The guardrails spec says guardrail **sets** are "authored as YAML-in-repo and synced to a DB table during `setup.ts` `seedDefaults`, mirroring the `business_rules` rule-pack pattern (version + content-hash, idempotent upsert)" — but no default sets, no `agent_guardrail_sets` seed body, and no schema/tool-scope/PII/injection/grounding policy defaults are enumerated.
- "Starter capability definitions" are implied (each guardrail set and proposal Zod contract is keyed by `capability`) but never listed.
- Five specs each declare `defaultRoleFeatures` line items in passing (`agent_orchestrator.invoke`, `.proposal.{dispose,view}`, `.guardrail.{read,manage}`, dispatch/trace/identity features) — but there is **no single `setup.ts` inventory** mapping every `acl.ts` feature to roles, and no `onTenantCreated` config-row list.

Without this inventory there is no source of truth for `setup.ts`, the ACL-sync invariant (`yarn mercato auth sync-role-acls`) cannot be satisfied, and a freshly provisioned tenant boots with no disposition rules and no guardrails — i.e. agents would run *ungated*, violating the "LLM proposes, OM disposes" and "block before disposition" invariants.

## 2. Architectural drivers

- **Idempotency.** Seeds run on every init/onboarding and on `sync-role-acls`; re-running must not duplicate. Precedent (`workflows/lib/seeds.ts`): find-by-stable-id within `(tenantId, organizationId)`, create-if-absent, update-only-on-change, flush once, invalidate the discovery cache.
- **Source of truth.** Three candidates: code-declared (`seedDefaults` literals), YAML/JSON-in-repo synced to DB, or DB-only (admin authors everything). The first two keep defaults in version control and reviewable; only YAML/JSON gives content-hash-versioned upgradeability, which the guardrails spec already mandates.
- **Tenant-scoping.** Every seeded row (rule, guardrail set, config) carries `tenant_id` **and** `organization_id` (conventions §3.5). No global rows.
- **Upgradeability of defaults.** Guardrail sets are explicitly **versioned** (`guardrailSetVersion` recorded per check). Defaults must support "ship a new version on content change without clobbering tenant overrides" — content-hash + append-by-version, never in-place overwrite of a customized set.
- **ACL grant sync.** Features in `acl.ts` MUST be mirrored in `setup.ts` `defaultRoleFeatures`; new tenants get them at setup, existing tenants only after `yarn mercato auth sync-role-acls`. This is a hard convention (core AGENTS → ACL Grant Sync).
- **No ungated boot.** Disposition packs + guardrail sets are *defaults*, not examples — they belong in `seedDefaults` (always runs), not `seedExamples` (skipped with `--no-examples`).

## 3. Approaches

- **(A) Code-declared `seedDefaults`.** Rule packs and guardrail sets as TS object literals in `setup.ts`/`lib/seeds.ts`. Simple, type-checked, no file IO. But diverges from the established rule-pack pattern, has no content-hash/version story, and mixes large config blobs into code.
- **(B) YAML/JSON-in-repo synced to DB.** Disposition pack as `examples/*.json` (exact `business_rules` precedent); guardrail sets as `examples/guardrails/*.yaml` synced to `agent_guardrail_sets` with `version` + `content_hash`. `lib/seeds.ts` reads files, idempotent upsert keyed by stable id, flush + cache-invalidate. Matches both existing precedents verbatim.
- **(C) DB-only / admin-authored.** No seed; operator builds rules and sets in the cockpit. Zero default safety, fails the "no ungated boot" driver, and gives nothing to review in PRs.

## 4. Trade-off matrix

| Driver | (A) Code-declared | (B) YAML/JSON→DB | (C) DB-only |
|---|---|---|---|
| Idempotency | OK (manual) | **Strong** (proven pattern) | N/A |
| Matches existing precedent | Partial | **Exact** (rule-pack + set spec) | No |
| Versioned/upgradeable defaults | Weak (no hash) | **Strong** (version + content-hash) | None |
| Reviewability of defaults | Medium (in TS) | **High** (declarative files) | None |
| Tenant override survives upgrade | Hard | **Yes** (append-by-version, hash skip) | N/A |
| No ungated boot | Yes | **Yes** | **No** |
| Implementation cost | Low | Medium | Low |

## 5. Recommendation

**Adopt (B): YAML/JSON-in-repo synced to DB, plus `defaultRoleFeatures` declared in `setup.ts`.** It is the *only* option consistent with both shipped precedents — the `business_rules` rule-pack JSON (`order-approval-guard-rules.json` + `workflows/lib/seeds.ts` upsert) and the guardrails spec's own "YAML→DB, version + content-hash, idempotent upsert" mandate — and it is the only one that satisfies versioned upgradeability and "no ungated boot" together. Concretely:

- Disposition rule pack ships as `examples/proposal-disposition-rules.json`, seeded via the **exact** `seedGuardRules` upsert (find by `ruleId` in `(tenantId, organizationId)`, create-if-absent, flush, `invalidateBusinessRuleDiscoveryCache`).
- Guardrail sets ship as `examples/guardrails/<capability>.yaml`, synced to `agent_guardrail_sets` keyed by `(tenantId, organizationId, capability, version)` with `content_hash`; identical hash → skip, changed body → new version row (append, never overwrite).
- `setup.ts` declares `seedDefaults` (calls both seeders), `onTenantCreated` (config rows), and `defaultRoleFeatures` for **every** `agent_orchestrator.*` feature across the five specs; CI/dev runs `yarn mercato auth sync-role-acls`.

## 6. Effort & dependencies

- **Effort: M.** ~`setup.ts` + `lib/seeds.ts` (two seeders, reuse `workflows` pattern) + 1 disposition JSON + N guardrail YAMLs + a small YAML→DB sync helper with content-hash. The `agent_guardrail_sets` entity (GAP for guardrails spec) and the `AgentProposal` Zod contracts must exist first.
- **Key dep: `business_rules` rule-pack seeding pattern** (`workflows/lib/seeds.ts` `seedGuardRules` + `invalidateBusinessRuleDiscoveryCache`) — reuse verbatim. Secondary deps: `agent_guardrail_sets` entity + per-capability Zod contracts (`data/validators.ts`), and the `acl.ts` feature list being final.

## 7. Deliverables — concrete seed inventory

**(a) Default disposition rule pack** — `examples/proposal-disposition-rules.json` (`business_rules` JSON, like `order-approval-guard-rules.json`), `entityType: 'agent_orchestrator:proposal'`:
- `agent_proposal_auto_approve_high_confidence` — `VALIDATION`, `confidence ≥ 0.8 AND fraudScore < 0.4 AND payoutAmount ≤ 10000` → pass = `auto_approved`.
- `agent_proposal_escalate_high_payout` — `VALIDATION`, `payoutAmount > 10000` → fail → raise `USER_TASK`.
- `agent_proposal_escalate_low_confidence` — `VALIDATION`, `confidence < 0.8 OR fraudScore ≥ 0.4` → fail → `USER_TASK`.
- `agent_proposal_guard_block_on_guardrail` — `GUARD` (`pre_transition`), block if `guardResults.result == 'block'`.
- `agent_proposal_arbitrate_multi` — `ACTION/CALCULATION`, select highest-confidence proposal or raise `USER_TASK` (arbitration).
- (Thresholds are conservative defaults; tenants tune in the cockpit. Seeded enabled, priority set so GUARD > VALIDATION.)

**(b) Default guardrail sets** — `examples/guardrails/<capability>.yaml`, one per starter capability, synced to `agent_guardrail_sets` (version + content_hash). Each declares which `kind`s apply + severity policy:
- `schema` → `block` (always; output must match per-capability Zod contract).
- `tool_scope` → `block` (reuse `ai_assistant` `allowedTools` + mutation-policy; no raw-write tools).
- `pii` → `warn` on summary, redact-before-persist on payload.
- `prompt_injection` → `block` on untrusted-content tool attempts.
- `grounding` → `warn` below threshold for factual capabilities, `block` for payout-bearing ones.
- `moderation` → `block` on disallowed input (pre-call gate).
- Body carries `capability`, `version`, ordered `checks[]` with thresholds.

**(c) Starter capability definitions** — minimal registry (in `lib/orchestration/` or a seeded `agent_capabilities` config) keyed by `capability` id, each pointing at its proposal Zod contract + default guardrail set version. Suggested starters (insurance domain): `claim.triage`, `claim.damage_estimate`, `claim.fraud_screen`, `claim.payout_recommendation`, `doc.extract`. Each must have a matching guardrail YAML (b) and a matching Zod proposal schema in `data/validators.ts`.

**(d) `defaultRoleFeatures`** (in `setup.ts`, mirroring `acl.ts`, synced via `yarn mercato auth sync-role-acls`):
- `superadmin`: `agent_orchestrator.*` (all, including `.guardrail.manage`, dispatch/identity admin).
- `admin`: `agent_orchestrator.*` (full operational + config; same as superadmin for this module unless a feature is reserved).
- `operator`: `agent_orchestrator.invoke`, `.proposal.view`, `.proposal.dispose`, `.guardrail.read` (works the queue, disposes proposals).
- `engineer`: `.proposal.view`, `.guardrail.read`, trace/eval read features (debug runs, no dispose/manage).
- `compliance`: `.proposal.view`, `.guardrail.read`, decision-record/contest read features (audit-only; no dispose, no config).
- (Exact list driven by the final `acl.ts`; every concrete feature MUST appear under at least one role.)

**(e) `onTenantCreated` config rows** (always-run, idempotent settings — not reference data):
- `agent_orchestrator.dispatch.lease_timeout_ms`, `.dispatch.max_retries`, `.dispatch.dead_letter_after`.
- `agent_orchestrator.invoke.default_timeout_ms`, `.invoke.retry_budget`.
- `agent_orchestrator.guardrail.default_set_version` (fallback when a capability has no set).
- `agent_orchestrator.proposal.auto_approve_enabled` (master toggle, default on).
- Stored via the `configs` module pattern, scoped by `tenant_id` + `organization_id`.

### Acceptance

- Fresh tenant init seeds the disposition pack + all starter guardrail sets + config rows; re-running init/onboarding seeds nothing new (idempotent) and updates only on content change.
- Every `agent_orchestrator.*` feature in `acl.ts` is present in `setup.ts` `defaultRoleFeatures`; `yarn mercato auth sync-role-acls` grants new features to existing tenants.
- All seeded rows carry `tenant_id` + `organization_id`; no global/cross-tenant rows.
- Changing a guardrail YAML produces a new `agent_guardrail_sets` version (content-hash differs); an unchanged file is skipped; a tenant-customized set is not clobbered.
- A capability with no matching guardrail set falls back to `agent_orchestrator.guardrail.default_set_version` rather than running ungated.
- A guard test asserts the seed leaves no `agent_orchestrator.*` ACL feature unmapped to a role.

## Changelog

- **2026-06-19:** Initial GAP-18 design analysis. Enumerated the previously-unlisted seed inventory (disposition rule pack, guardrail sets, starter capabilities, `defaultRoleFeatures`, `onTenantCreated` config). Recommended YAML/JSON-in-repo→DB matching the `business_rules` rule-pack (`order-approval-guard-rules.json` + `workflows/lib/seeds.ts`) and guardrail-set version+content-hash precedents, with `defaultRoleFeatures` in `setup.ts`.
