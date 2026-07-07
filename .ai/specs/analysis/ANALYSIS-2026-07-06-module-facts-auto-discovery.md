# Pre-Implementation Analysis: Module Fact-Sheets — Auto-Discovery Beyond the Core Allowlist

**Spec:** [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](../2026-07-06-module-facts-auto-discovery.md) · **Issue:** #3752 · **Date:** 2026-07-06

> **Superseded in part (2026-07-07):** the committed monorepo artifact `apps/mercato/src/module-facts.generated.json` was dropped (no runtime/test consumer) — see the spec's **Reframe** section. This moots the two governance gaps below (G2 / M1 — whether the committed OSS artifact should carry enterprise or example/probe module facts): there is no committed OSS artifact anymore. Auto-discovery now lives only in the standalone bundle (`discoverPackageModuleSources`, package modules only), so enterprise/`@app` inclusion is no longer a committed-repo concern. The R1 BC-guard finding still stands and is still honored by the (unchanged) discovery-derived guard.

## Executive Summary

The spec is architecturally sound and close to implementation-ready — it reuses existing resolver infra (`loadEnabledModules`, `getModulePaths`, `discoverPackages`) rather than inventing discovery, and the create-app side needs almost no change. **One hard blocker** surfaced by the R1 audit: the BC-guard rewrite (T2), as worded, asserts `id.startsWith(`${moduleId}.`)` for events/ACL, and **three real enabled modules violate that** — it will fail CI on first run. Two governance gaps also need a decision before coding: whether the committed OSS artifact should include **enterprise** and **example/probe** module facts (the enabled set is ~55 modules, not the spec's estimated ~40). All fixes are spec edits; no code blockers. **Recommendation: minor spec updates first, then implement.**

## Backward Compatibility

Checked all 13 surface categories. This is a build-time generator with no runtime/HTTP/DB/event/ACL/DI surface of its own, so 10 categories are N/A. Relevant categories:

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 2 | Type/value exports | `MODULE_FACTS_ALLOWLIST` + `ModuleFactsModuleId` are exported from the importable subpath `@open-mercato/cli/lib/generators/module-facts` (confirmed: `build.mjs` imports it). Dropping them is a STABLE-surface break. | Warning | **Already handled** in spec §7/A4: retain both as `@deprecated` re-exports (values unchanged) for ≥1 minor + `RELEASE_NOTES.md`. No further action. |
| 3 | Function signatures | `extractModuleFacts` / `extractAllModuleFacts` gain params. | None | Additive-only (`moduleRoot?`, `sources?`); legacy `{ coreSrcRoot, moduleIds? }` shape still resolves and still defaults to the allowlist. Compliant. |
| 13 | Generated file contract | `apps/mercato/src/module-facts.generated.json` widens from 9 → ~55 top-level keys. | None (additive) | Keys are additive; consumers key by module id. **But see Gap G2** — *which* modules widen into a committed OSS file is a governance decision, not a BC break. |

### Missing BC Section
None. The spec has a dedicated §7 Backward Compatibility with the deprecation protocol. ✓

## Spec Completeness

All required sections present and appropriate for a generator spec.

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| UI/UX | N/A | Correctly omitted — no UI surface. |
| Data Models | Low | Correctly delegated — the JSON schema is unchanged from the parent spec and referenced, not restated. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| §9 T2 (BC-guard test) | The guard's invariant is under-specified given confirmed real violations (see Risk H1). "asserts namespacing only over non-empty sections" does **not** save it — the violating sections are non-empty. | Rewrite T2's invariant (see Remediation "Before Implementation" #1). |
| §8 R1 mitigation | Says a violation is "a real finding to fix or explicitly exempt" — too hand-wavy; the audit found 3 pre-existing violations that are **intentional** (not bugs to fix). | Convert R1 mitigation into the concrete guard design chosen in #1. |
| §8 R3 | Estimates "~9 → ~40". Actual enabled set is **~55** (incl. enterprise + official-module packages + app-local example/probe). | Update the count and reference G2. |

## AGENTS.md Compliance

| Rule | Location | Status / Fix |
|------|----------|-----|
| **Lesson (`.ai/lessons.md` §161-169):** CLI generators MUST resolve app/package paths via the shared resolver, never hardcode `packages/*`/`apps/mercato/*`. | Spec A5 / `build.mjs` | **Action needed.** `build.mjs` today hardcodes `coreSrcRoot = join(packagesDir, 'core', 'src', 'modules')`. A5 says "discover via `resolver.discoverPackages()`" — make it explicit that the hardcoded path is *replaced*, and that discovery runs through the resolver. |
| **Lesson (§151-159):** standalone generators must not parse compiled `dist` `.js` (entity-id generator already lost package entities this way). | Spec A3 | **Validated.** A3 (source-only, skip `.js`-only roots) is the correct, lesson-backed choice; strengthens the case for deferring compiled-`.js` to a follow-up. |
| create-app AGENTS "MUST keep standalone agent guidance aligned with generator behavior" (`agentic/` templates). | Spec §6 Phase 3 | **Add:** if the Module-Specific Guides table shape/behavior changes, sync `packages/create-app/agentic/shared/AGENTS.md.template`. Low effort, easily missed. |
| Encryption maps / CRUD factory / DS tokens / tenant scoping / zod / events-as-side-effects | — | **N/A.** No runtime data, HTTP, UI, or cross-module surface. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **H1 — Widened BC guard (T2) fails on real modules.** Confirmed by audit: `ai_assistant` emits `ai.action.confirmed` / `ai.action.cancelled` / `ai.action.expired` / `ai.token_usage.recorded` (prefix `ai`); `dashboards` declares ACL `analytics.view`; `storage_s3` declares ACL `storage_providers.manage`. A blanket `startsWith(moduleId)` assertion over the enabled set red-fails CI immediately. | Blocks Phase 2; would also block Phase 1's snapshot commit if the guard runs in `yarn generate` as a warning-that-becomes-error. | **Choose the guard invariant explicitly (Remediation #1):** drop the strict module-prefix namespacing assertion and keep the *meaningful* invariants — id **uniqueness** + **resolve-against-live-source** (every emitted entity/event/ACL/search id still exists in `E`/`events.ts`/`acl.ts`/`search.ts`) — which is the parent spec's actual T3 purpose. Optionally keep namespacing behind a tiny documented exemption map `{ ai_assistant:['ai'], dashboards:['analytics'], storage_s3:['storage_providers'] }`, but that reintroduces a hand-maintained list (against the spec's spirit). **Recommend: drop strict namespacing.** |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **M1 — Enterprise module facts in a committed OSS artifact.** The enabled set includes `security`, `sso`, `record_locks`, `system_status_overlays` (`@open-mercato/enterprise`). Auto-discovery would write their entity/event/ACL ids into the committed `apps/mercato/src/module-facts.generated.json` in the OSS repo. | Governance: commercial-module surface (metadata only, not logic) lands in the OSS tree; also breaks reproducibility for OSS-only checkouts where the enterprise package is absent (the file would differ). | Decision required (G2). Options: (a) exclude `from` matching `@open-mercato/enterprise` from the committed artifact; (b) accept it as non-sensitive contract metadata. A3's `hasReadableModuleSource` skip already handles the *absent-package* case gracefully, but not the *present-in-this-checkout* case. |
| **M2 — `build.mjs` resolver-path compliance.** Replacing the hardcoded `coreSrcRoot` with package discovery must go through the resolver (lesson §161), and must scope to package modules only (A5), excluding `apps/*`. | A wrong scope leaks `apps/mercato` demo modules (`example`, `ratelimit_probe`) into every scaffold, or misses non-core packages. | A5 already pins the intent; make the resolver requirement explicit in the step and cover it with the updated `agents-md.module-guides.test.ts`. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **L1 — Example/probe modules in the committed artifact.** `example`, `example_customers_sync`, `ratelimit_probe` are enabled app-local modules and would get committed fact-sheets. | Noise in the committed file. | Decide alongside G2 — likely acceptable (they're real enabled modules), or filter `from: '@app'` from the committed monorepo artifact if undesired. |
| **L2 — Artifact size / diff churn.** ~55 modules vs 9 (~6×). | Larger committed file + larger future regeneration diffs. | Deterministic alphabetical sort keeps diffs stable; one-time growth reviewed. Update R3 count. |
| **L3 — Generation cost.** ~55 modules × recursive `backend/**` scan for table ids. | Slower `yarn generate`. | Build-time only; measure in Phase 1, cache-by-mtime only if material. |
| **L4 — `shared.ts` vs `loadEnabledModules` asymmetry.** `shared.ts:readEnabledModuleIds` reads only the static `enabledModules` array literal, while the monorepo generator's `loadEnabledModules()` also resolves `.push()` blocks + official-module spread. | Not a bug (different consumers), but a scaffold whose modules are added via `.push()` would not get guide rows. | Document the asymmetry; unchanged from parent spec's D6 caveat. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **G1 — BC-guard invariant undefined against reality.** The spec must state the exact T2 invariant given the 3 confirmed pre-existing namespacing exceptions. Without this, Phase 2 (and possibly Phase 1's snapshot) fails. → Remediation #1.

### Important Gaps (Should Address)
- **G2 — Committed-artifact module scope.** The spec does not decide whether the committed OSS `module-facts.generated.json` includes enterprise (`@open-mercato/enterprise`) and/or app-local example modules. Needs an explicit filter rule or an explicit "include all enabled" decision. → Remediation #2.
- **G3 — `build.mjs` resolver routing made explicit.** State that the hardcoded `coreSrcRoot` is removed and discovery routes through the resolver (lesson §161). → Remediation #3.

### Nice-to-Have Gaps
- **G4 — `agentic/` template sync** noted in Phase 3 (create-app AGENTS rule).
- **G5 — R3 count correction** to ~55.

## Remediation Plan

### Before Implementation (Must Do — spec edits only)
1. **Redefine T2 / R1 (G1).** Change the BC guard to assert **uniqueness + resolve-against-live-source** for every emitted id, and **remove the strict `startsWith(moduleId)` assertion** for events/ACL. State the three known cross-namespace modules (`ai_assistant`→`ai`, `dashboards`→`analytics`, `storage_s3`→`storage_providers`) as the rationale. (If keeping namespacing, spec the exemption map explicitly — not recommended.)
2. **Decide committed-artifact scope (G2).** Add a decision (A6) on enterprise/app-local inclusion. Recommended default: **include all enabled source-available modules** (simplest, matches "what the app runs") **but** exclude `from: '@open-mercato/enterprise'` from the committed OSS artifact to keep the OSS tree package-reproducible — or explicitly accept inclusion. Flag for user choice.
3. **Make `build.mjs` resolver routing explicit (G3).** In Phase 3, state the hardcoded `coreSrcRoot` is replaced by resolver-based package discovery (A5 + lesson §161).
4. **Fix R3 count** to ~55 and cross-link G2.

### During Implementation (Add to Spec / hold to)
1. Keep the `customers` fixture test (T3) untouched as the content lock — proves widening didn't alter extraction content.
2. Run discovery + full extraction once at the start of Phase 1 and eyeball the emitted JSON for any *new* non-conforming module beyond the 3 known, before committing the snapshot.
3. Sync `packages/create-app/agentic/shared/AGENTS.md.template` if the guides-table behavior changes (G4).

### Post-Implementation (Follow Up)
1. Remove the deprecated `MODULE_FACTS_ALLOWLIST` export after the ≥1-minor bridge window.
2. Compiled-`.js` / generate-time regeneration in standalone apps (parent R1) — separate spec.

## Recommendation

**Needs spec updates first** (small, targeted — items #1–#4 above), then ready to implement. No code-level blockers; the architecture and BC handling are sound. The single must-fix is the BC-guard invariant (G1/H1), which is confirmed against the live codebase; G2 (enterprise inclusion) needs a one-line product decision.
