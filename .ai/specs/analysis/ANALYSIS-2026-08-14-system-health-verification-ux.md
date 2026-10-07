# Pre-Implementation Analysis: System Health — Verified on Entry, Honest in the Panel

**Spec:** [`.ai/specs/enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md`](../enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md)
**Date:** 2026-08-14 · **Analyst:** pre-implement audit (no code modified, spec not modified)
**Verification basis:** codebase read directly (no Explore subagents — this session forbids the Agent tool), `BACKWARD_COMPATIBILITY.md` (14 categories as published), `.ai/lessons.md` tag scan, `.agents/skills/om-code-review/references/review-checklist.md`

## Executive Summary

The spec is architecturally sound and unusually well-grounded: every cost claim was verified against the actual `healthCheck()` bodies, and the contract changes are genuinely additive with a conservative default that keeps unknown third-party adapters out of the auto-probe path. **Two findings block implementation**: an internal contradiction in the roll-up (a new `error` state is added to `HealthState` while the spec simultaneously declares `rollupHealth` untouched — `SEVERITY` has no entry for it, so an error would be silently swallowed), and an authorization gap (the billable `probe=1` path is gated by `proposals.view`, a reviewer-grade feature, and the spec puts a per-row *Test* button behind it on a page every reviewer opens). Three further gaps — no spend rate-limit, no single-flight on concurrent probes, and integration tests pointed at the wrong directory — should be closed in the spec text before coding.

**Recommendation: needs spec updates first** — all five items are text-level fixes, no redesign.

## Backward Compatibility

Checked against all 14 published contract-surface categories in `BACKWARD_COMPATIBILITY.md` (the skill lists 13; the repo file carries 14 — #12 is AI agent/tool/UI-part IDs and #14 is generated files).

| # | Surface | Verdict | Evidence |
|---|---|---|---|
| 1 | Auto-discovery file conventions | **PASS** | new files only (`components/health/*`); no convention file renamed or removed |
| 2 | Type definitions & interfaces (STABLE) | **WARNING** — see BC-1 | `SearchAdapter.probeCost?`, `HealthOptions.maxProbeCost?`, `AdapterHealthReport +probeCost/+probed` are all optional-additive; `HealthState` gains a member |
| 3 | Function signatures (STABLE) | **PASS** | `engine.health()` gains an optional field on an already-optional options object; `deriveWebSearchIndicator` is module-internal (two consumers, both in-module — verified) |
| 4 | Import paths (STABLE) | **WARNING** — see BC-2 | `AdapterHealth` is exported from `AdapterRow.tsx:40` and consumed by `backend/settings/web-search/page.tsx` |
| 5 | Event IDs (FROZEN) | **PASS** | no event declared, renamed, or emitted |
| 6 | Widget injection spot IDs (FROZEN) | **PASS** | tile is rendered directly by `backend/overview/page.tsx:400`, not through a spot |
| 7 | API route URLs (STABLE) | **WARNING** — see BC-3 | URL unchanged; `probe=auto` additive; response fields additive |
| 8 | Database schema (ADDITIVE-ONLY) | **PASS** | no entity, no column, no migration |
| 9 | DI service names (STABLE) | **PASS** | reuses the registered `cache` key exactly as `lib/webSearch/registry.ts:55-63` does |
| 10 | ACL feature IDs (FROZEN) | **PASS** on IDs, **CRITICAL** on assignment — see AUTH-1 | no feature renamed; the spec reuses `agent_orchestrator.proposals.view` |
| 11 | Notification type IDs (FROZEN) | **PASS** | none |
| 12 | AI agent / tool / override IDs | **PASS** | none |
| 13 | CLI commands (STABLE) | **PASS** | none |
| 14 | Generated file contracts (STABLE) | **PASS** | no generated export or `BootstrapData` field touched |

### Violations Found

| # | Surface | Issue | Severity | Proposed fix |
|---|---|---|---|---|
| **BC-1** | 2 — Types | §3.4 adds `error` to `HealthState`, but §3.4 also states "`rollupHealth` is untouched". `SEVERITY` (`lib/systemHealth.ts:16`) is a total `Record<HealthState, number>`; adding a member makes the record fail to typecheck **or**, if widened, makes `SEVERITY['error']` `undefined`, and `undefined > n` is always false — the roll-up would silently ignore a failed health endpoint. | **Critical** | Pick one and write it into §3.4: **(a)** extend the union *and* `SEVERITY` with `error: 4` (worst — a health surface that cannot answer is worse than a dependency known to be down), or **(b)** keep `HealthState` closed and model the fetch failure as a separate `fetchFailed: boolean` on the panel model. (a) is preferred: the roll-up should go red when the page cannot see. |
| **BC-2** | 4 — Import paths | Step 1.5 moves the settings row onto the shared vocabulary. `AdapterRow.tsx:40` exports `type AdapterHealth`, imported by its sibling `page.tsx`. A move without a bridge breaks that import. | **Warning** | Keep `AdapterRow.tsx`'s export as a re-export of the canonical type in `components/health/`, `@deprecated`, for ≥1 minor per the deprecation protocol |
| **BC-3** | 7 — API response | The route's top-level `probed: boolean` currently means "a probe was requested". Under `probe=auto` some rows are probed and some are not, so the field's meaning becomes ambiguous. Row-level `probed` is what `AdapterRow.tsx:232` reads (verified), so no consumer breaks today — but the field's semantics must be pinned before a third party depends on the new mode. | **Warning** | Define in §3.3: top-level `probed` is `true` only when **every enabled adapter** was probed in this response; `auto` responses therefore report `false` unless all enabled adapters are free. Document it in the `openApi` description. |

### Missing BC Section

Present and adequate (§ *Migration & Backward Compatibility*). It must gain rows for BC-1's `SEVERITY` decision and BC-2's re-export bridge.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Changelog | `.ai/specs/AGENTS.md` requires the changelog to be updated after implementation; there is nowhere to write it | Add an empty `## Changelog` with a dated row per phase |
| Final Compliance Report | The spec-writing skill's step 9 output is not recorded, so a reviewer cannot see which MUSTs were checked | Add a compliance matrix (DS tokens, canonical mechanisms, zod, ACL, i18n, BC) |
| Data model | correctly **not applicable** — no entity | none |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Testing | Points integration coverage at `.ai/qa/`. The module's real convention is `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-*.spec.ts`, registered through `__integration__/meta.ts`, which declares `requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES_AGENTS']` so discovery skips the specs when the module is not enabled | Name the cases: `TC-AGENT-HEALTH-001` (readiness response unchanged), `-002` (`probe=auto` issues zero billable calls on a cold cache), `-003` (`probe=1` writes the cache and `auto` then reuses it), `-004` (overview reaches a non-`unknown` headline with no billable request). Follow `TC-AGENT-HONESTY-001.spec.ts`'s header convention (case id + spec back-reference + the defect it pins) |
| §3.3 Cache | The cached value's shape is never specified, yet §3.5 renders a per-row age | Specify `{ ok, detail, latencyMs, probeCost, checkedAt }` per adapter id, and that `checkedAt` is read from the cached value, not from the response envelope |
| §3.3 Cache | No statement of behaviour when the container has no `cache` registration — `registry.ts:55-63` degrades silently to `null` | State: no cache ⇒ `probe=auto` reports billable rows as unverified forever; it must never fall back to probing them |
| §3.1 | `heavy` is defined but its cache/TTL treatment is only implied | State explicitly that `heavy` follows the billable rules for initiation (never on page view) and the same TTL on reuse |
| Env var | `OM_AGENT_HEALTH_PROBE_TTL_MS` is introduced with no documentation step. Note the precedent: `OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS` (`lib/webSearch/policy.ts:113`) is in **neither** `apps/mercato/.env.example` nor `packages/create-app/template/.env.example` — the module already carries this debt | Add a step: document the new var in `apps/mercato/.env.example` **and** mirror it into `packages/create-app/template/.env.example` (root `AGENTS.md` → Template Sync Checklist). Optionally repay the `OM_WEB_SEARCH_*` debt in the same step |

## AGENTS.md Compliance

| Rule | Location | Verdict |
|---|---|---|
| Semantic status tokens, no raw shades | §3.5 mock | **PASS** — spec mandates `status-success-*` and explicitly forbids `bg-green-*` |
| No arbitrary values | §3.5 (`w-96`, `max-h-96`, `text-xs`) | **PASS** — all on the Tailwind scale; `text-overline` exists in the DS (`packages/ui/src/portal/PortalShell.tsx:326`) and is the right token for the section labels |
| Shared primitives | §3.5 | **PASS** — `StatusBadge` supports every variant the spec maps (`success \| warning \| error \| info \| neutral`, `packages/ui/src/primitives/status-badge.tsx:5`); `Alert` exists (`packages/ui/src/primitives/alert.tsx`) |
| Icon-only buttons carry `aria-label` | §3.5 | **PASS** — required explicitly, and already true of today's *Recheck* (`SystemHealthTile.tsx:119`) |
| `apiCall`, never raw `fetch` | existing tile | **PASS** — unchanged |
| `useGuardedMutation` for non-`CrudForm` writes | *Test* button | **N/A** — the probe is a `GET`; the guard registry governs mutations. See AUTH-1/SPEND-1 for the controls that do apply |
| zod on API inputs + OpenAPI doc | Step 2.4 | **PASS** — the `probe` enum and the new response fields are covered |
| Per-method route `metadata` | `route.ts:18-20` | **PASS** — already correct; must not regress to a top-level export |
| i18n, no hardcoded strings | Step 1.6 | **PASS** — verified all five locales are in lockstep at 1419 keys, 11 `overview.health.*` and 3 `settings.webSearch.health*` each, so the deprecation bridge must be applied five times |
| Cache via DI with tenant-scoped tags | §3.3 | **PASS** — key and tag both carry `tenantId`, matching `registry.ts:63` |
| Events for cross-module side effects | — | **N/A** — no side effect leaves the module |
| Commands / undo | — | **N/A** — read-only surface |
| Boy Scout rule on touched lines | Step 1.4 | **PASS** — required explicitly |

### Lessons scan

Tag scan of `.ai/lessons.md` for `module:agent_orchestrator`, `topic:error-states`, `topic:caching` returned three candidate records; one is directly applicable:

- **[Standardize record-not-found as a dedicated page state in backend UI](../../lessons/standardize-record-not-found-as-a-dedicated-page-state.md)** (`area:backend-ui,debugging; topic:error-states,ui-components`) — the same principle the spec applies in §3.4 by separating `error` from `unknown`. Cite it in the spec so the pattern is traceable rather than re-derived.
- **[Optional native dependencies must report load failures accurately](../../lessons/optional-native-dependencies-must-report-load-failures.md)** (`module:cache; topic:error-states`) — reinforces the "no cache ⇒ say so, never silently downgrade" gap noted above.

## Risk Assessment

### High

| Risk | Impact | Mitigation |
|---|---|---|
| **AUTH-1 — billable probe gated at reviewer level.** `route.ts:19` requires `agent_orchestrator.proposals.view`. The settings page that owns the existing *Recheck* is gated at `agent_orchestrator.agents.view` (`page.meta.ts:16`) — a different, higher-intent surface. The spec puts a per-row *Test* on the Overview, which every proposal reviewer opens, so the ability to spend the tenant's Firecrawl/Tavily credits moves from an admin screen to the landing page. | Any reviewer can bill the tenant, repeatedly, with one click | Split the gate in the route: `probe` absent/`0`/`auto` keeps `proposals.view`; `probe=1` requires `agent_orchestrator.agents.manage` (already exists, `acl.ts:12-17`). Hide the *Test* button when the feature is absent. Add the case to the integration suite (403 for a reviewer-only principal) |
| **SPEND-1 — no rate limit on a paid endpoint.** Nothing bounds how often `probe=1` may be called; the module has no rate-limit precedent in `api/`. The new per-row *Test* multiplies the exposure by the adapter count. | Unbounded, self-inflicted cost; also unbounded sidecar spawns for the `heavy` tier | Enforce a minimum interval server-side — reuse the cache: if a fresh entry exists and the caller did not pass an explicit force flag, return it. Disable the button client-side while a probe is in flight and until the row's `checkedAt` exceeds a floor (e.g. 30 s) |

### Medium

| Risk | Impact | Mitigation |
|---|---|---|
| **CONC-1 — concurrent probes.** Two operators clicking *Recheck* in the same tenant issue two billable calls and, for `browser`, two sidecar spawns. The engine already owns a `singleFlight` helper for searches (`engine.ts:535`). | Duplicate spend; process churn | Wrap `probe=1` in a per-tenant single-flight keyed on the cache key; late callers await the in-flight result |
| **STALE-1 — cached verdict outlives a revoked key.** 10-minute TTL means a broken adapter can read green for up to 10 minutes. | Misleading green | Already mitigated in the spec by tag invalidation on settings save and the visible row age; add the invalidation call to Step 2.7's done-criteria explicitly (`deleteByTags(['agent_orchestrator:health:<tenant>'])`) |
| **PERF-1 — page-entry probe on the critical path.** `probe=auto` runs on tile mount; `searxng`'s `/healthz` and `model-native`'s resolver are network/DI calls inside the Overview's first paint window. | Slower Overview if a free adapter hangs | `HEALTH_TIMEOUT_MS` already bounds each adapter (`engine.ts:556-558`); the spec's budget (<2 s p95) needs an explicit assertion in `TC-AGENT-HEALTH-004`, and the tile must render its skeleton before the fetch resolves |
| **TEST-1 — no fixture strategy for adapters.** `.ai/qa/AGENTS.md` requires self-contained tests; a real Firecrawl key must never be needed. | Flaky or unrunnable suite | The spec says "a stub adapter registered in test setup" — name the mechanism (the loader registry in `packages/web-research/src/loader/registry.ts`) and assert cleanup in `finally` |

### Low

| Risk | Impact | Mitigation |
|---|---|---|
| **DISP-1 — disposal on the new path.** Every probe path must still `dispose()`; `route.ts:66-73` does it in `finally` today. | Leaked sidecar | Keep the `finally`; the spec already lists it as a done-criterion in Step 2.3 |
| **DOC-1 — third-party adapter authors.** `probeCost` is only safe if authors know to declare it. `packages/web-research/AGENTS.md` exists and is the right home. | A metered third-party adapter mis-declared as free | Add a step: document `probeCost` in `packages/web-research/AGENTS.md` and in the `om-create-web-research-adapter` skill |

## Gap Analysis

### Critical (block implementation)

- **BC-1**: decide `error`-in-`HealthState` vs `SEVERITY` and write the ordering into §3.4.
- **AUTH-1**: split the route gate so the billable mode requires `agents.manage`.

### Important (should address before coding)

- **SPEND-1 / CONC-1**: rate-limit + single-flight for `probe=1`.
- **Testing section**: relocate to `__integration__/TC-AGENT-HEALTH-00x.spec.ts`, name the cases, honour `meta.ts`'s env gating.
- **Cache value shape** and **no-cache behaviour**.
- **Env var documentation** in both `.env.example` files.

### Nice to have

- Changelog and Final Compliance Report sections.
- Lesson cross-references (`error-states`).
- `probeCost` documentation for adapter authors.
- Repay the pre-existing `OM_WEB_SEARCH_*` env-documentation debt while in the area.

## Remediation Plan

### Before implementation (must do)

1. **§3.4** — add `error: 4` to `SEVERITY` (or drop `error` from the union in favour of a separate flag) and delete the "roll-up untouched" claim; state that a health surface that cannot answer rolls up as the worst state.
2. **§3.3** — split the ACL gate: `auto` / readiness on `proposals.view`, `probe=1` on `agent_orchestrator.agents.manage`; add the 403 case to the test table.
3. **§3.3** — add the spend controls: cache-as-rate-limit for `probe=1` unless forced, per-tenant single-flight, client-side disable while in flight.
4. **Testing** — rewrite for `__integration__` with `TC-AGENT-HEALTH-001..004` and the stub-adapter fixture mechanism.

### During implementation (add to spec as it lands)

1. Cache value shape and the no-cache degradation rule.
2. Top-level `probed` semantics under `auto` (BC-3), reflected in the OpenAPI description.
3. `AdapterHealth` re-export bridge with `@deprecated` (BC-2).
4. Env var documented in `apps/mercato/.env.example` + mirrored into `packages/create-app/template/.env.example`.

### Post-implementation (follow up)

1. Document `probeCost` in `packages/web-research/AGENTS.md` and the adapter-authoring skill.
2. Consider a lesson record if the search-cost/probe-cost conflation turns out to have bitten elsewhere.
3. Move the spec to `.ai/specs/enterprise/implemented/` once both phases ship, with the changelog filled in.

## Recommendation

**Needs spec updates first.** No redesign is required — the architecture holds and the cost analysis behind it was verified against the adapters' actual probe bodies. Close the four "before implementation" items (two of them one-line decisions), then Phase 1 can start immediately; Phase 1 is independent of every finding except the testing-location fix.
