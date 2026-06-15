# Run: Tenant-scoped search settings (spec + tracking issue)

## Overview

- Goal: Author a spec that makes vector/fulltext search settings tenant-scoped, inherit unset settings from env-derived defaults, and verify provider availability with a real health probe before a provider can be selected. Ship the spec as a docs-only PR and open a tracking GitHub issue.
- Affected modules/packages (for the spec, not this PR): `packages/core` (`configs` module — `ModuleConfig` / `ModuleConfigService`), `packages/search` (embedding config, global-search strategies, provider availability, settings UI).
- Smallest safe scope for THIS PR: one new spec file under `.ai/specs/` plus a tracking GitHub issue. No code changes.
- Non-goals: implementing the fix, changing runtime behavior, migrating data, touching enterprise specs.

### Decisions locked via Open Questions gate (2026-06-15)

- Q1 Scoping approach → **Scope `ModuleConfig` generally**: add optional `tenant_id`/`organization_id` to `module_configs` + `ModuleConfigService`, scoped lookup with global fallback; migrate search keys to scoped reads/writes.
- Q2 Default inheritance → **Env-derived defaults only**: an unset tenant inherits read-only defaults computed from env vars; existing global rows become the instance default/backfill.
- Q3 Provider check → **Active probe, cached**: per-provider `isAvailable()` health probe (Ollama reachability etc.), short-TTL cached; UI disables unreachable providers.

## Risks

- Spec must respect `BACKWARD_COMPATIBILITY.md`: `module_configs` schema, `ModuleConfigService` signature, and search API routes are contract surfaces. The spec must keep changes additive/BC-safe.
- Tenant-isolation correctness is the whole point; the spec must spell out the fallback resolution order and migration of existing global rows precisely.
- Provider probes must be fail-closed, timeout-bounded, and never block page render.

## Implementation Plan

### Phase 1: Plan and spec authoring

1. Add the run plan on the task branch.
2. Author the full spec at `.ai/specs/2026-06-15-tenant-scoped-search-settings.md` (TLDR, Problem, Solution, Architecture, Data Models, API Contracts, UI, Migration & BC, Risks, Phasing, Test Plan, Compliance, Changelog).

### Phase 2: Delivery

1. Open a tracking GitHub issue linking the spec path and the spec PR.
2. Commit, push, open the docs-only PR against `develop`, normalize labels, post the run summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan and spec authoring

- [x] 1.1 Add the run plan on the task branch — 2803ede84
- [x] 1.2 Author the full spec at `.ai/specs/2026-06-15-tenant-scoped-search-settings.md` — e024ac938

### Phase 2: Delivery

- [ ] 2.1 Open a tracking GitHub issue linking the spec path and the spec PR
- [ ] 2.2 Commit, push, open the docs-only PR, normalize labels, post run summary
