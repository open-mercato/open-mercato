# Pre-Implementation Analysis: ts-morph Module Fact-Sheets — Generated Standalone Guides

- **Spec:** `.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`
- **Analysis date:** 2026-06-27 (refreshed — second pass, post-D6)
- **Analyst:** pre-implement-spec
- **Scope reviewed:** create-app guide wiring (`build.mjs`, `shared.ts`, `AGENTS.md.template`), the scaffold flow (`index.ts` → `wizard.ts` → `tools/{shared,codex}.ts`), template `enabledModules`, cli ts-morph generator infra, customers-module facts
- **Supersedes:** the first pass (this same file, 14:16) whose findings GAP-1/2/3/4 + the missing test section are now **incorporated into the spec** (see "Prior pass — resolved"). This refresh re-validates those and focuses on the newly added **Decision D6** (dynamic per-enabled-module AGENTS.md), **R5**, and **T6**.

## Executive Summary

The spec's architecture remains sound and the prior pass's critical data-accuracy defects are **all resolved in the current text** (colon-form entity IDs, the `apis[].metadata` auth source, the versioned committed-output location, corrected counts, and a real §10 test section). The new **D6** (generate the AGENTS.md *Module-Specific Guides* table per app from the enabled module set) is a correct, well-scoped addition: it honors the §2 Non-Goal by keeping the 7 package/conceptual rows static and confining "dynamic" to the genuinely per-module surface, and its claimed reuse of the Codex marker-injection idiom and its scaffold-ordering assumption both **check out against the code**.

There are **no Critical blockers**. D6 ships with **one Important clarification gap**: it says "read the already-written `targetDir/src/modules.ts`" but never specifies *how* to extract the enabled set, and the real `enabledModules` is a static literal array **plus conditional `.push()` calls and a `...officialModuleEntries` spread** — a naive static read sees only the literal. This happens to be safe (all 9 D5 modules are static literals), but the spec must say so explicitly or an implementer will either over-engineer (dynamic import) or silently regress. Two Minor items: pick one enabled-set mechanism for both invocation sites, and correct the T5/T6 test locations (they are create-app tests, not cli tests).

**Recommendation: Ready to implement after minor spec clarifications** (D6-A extraction mechanism + static-literal caveat; D6-B single mechanism; D6-D test location). All are documentation precision, not architecture.

---

## Prior pass — resolved (re-validated against current spec text)

| Prior finding | Status now |
|---|---|
| GAP-1 / BC-1 — API auth read from the wrong manifest | **Resolved** — §4 row, §5 "CRUD route auth caveat", D4 now read auth from `modules.runtime.generated.ts` `apis[].metadata` via `buildApiMetadataLiteral()`; `api-routes.generated.ts` explicitly excluded. `buildApiMetadataLiteral` confirmed present in `packages/cli/src/lib/generators/module-registry.ts`. |
| GAP-2 — dotted `customers.person` entity IDs that don't exist in `E` | **Resolved** — all examples now colon form (`customers:customer_person_profile`), with the dotted-enricher-alias distinction documented. |
| GAP-3 — committed output in git-ignored `.mercato/generated/` | **Resolved** — D4/§5/§7 now write versioned `apps/mercato/src/module-facts.generated.json`. |
| GAP-4 — fabricated counts | **Resolved** — ACL 21, events 49, search 6, notifications 2; `diTokens`/`cli` empty. |
| Missing test/BC-guard section | **Resolved** — §10 added (T1–T5) incl. the BC guard (T3). |

Infrastructure re-confirmed present: `packages/cli/src/lib/generators/{entity-ids,module-di,module-registry}.ts`, `extensions/events.ts`, `ast/{index,imports,source-file,writers}.ts`; the 9 module-level + 7 package-level `agentic/standalone-guide.md` files exist exactly as the spec's counts state.

---

## Backward Compatibility (D6 delta)

Still a docs/tooling change — no runtime types, events, routes, schema, DI keys, ACL features, or notifications. BC exposure remains limited to generated-file/guide-path contracts and CLI commands; the §7 redirect-stub bridge for the 9 legacy `core.<module>.md` names is intact.

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| BC-D6-1 | (13) Generated-file/guide paths | D6 makes the scaffolded `AGENTS.md` *Module-Specific Guides* rows point at `.ai/guides/modules/<module>.md` and **stop referencing** `core.<module>.md`. The §7 legacy `core.<module>.md` redirect stubs are for **in-place upgrades** of existing apps, not fresh scaffolds (a fresh D6 app references neither). | None (consistent) | No change required. Optionally clarify in §7 that fresh D6-scaffolded apps don't reference the legacy stubs — the stubs exist purely for apps upgrading in place. Confirm the stubs are still bundled by `build.mjs` even though the D6 dynamic block never links them. |
| BC-D6-2 | Internal asset, not a third-party contract | `AGENTS.md.template`'s *Module-Specific Guides* section moves from static table to marker-delimited generated block. | None | The template is an internal create-app asset; only the emitted `.ai/guides/...` paths are a contract, and those are handled. |

---

## Spec Completeness (D6 delta)

D6 added a matching Goal, the D6 decision row, §7 wiring (3 bullets), R5, and T6 — structurally complete. Remaining precision gaps:

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §7 "Enabled-module source (D6)" | States *what* to read (`targetDir/src/modules.ts`) but not *how*. The real `enabledModules` (template `src/modules.ts:65`) is a typed array literal of ~50 static `{ id, from }` entries **followed by** conditional `.push()` blocks (official modules, `example_customers_sync`, `storage_s3`, enterprise `record_locks`/`sso`/`security`) and a `...officialModuleEntries` spread, gated on env/preset. A static AST read of the literal does **not** see the conditional pushes. | Specify: **AST-parse the `enabledModules` array-literal** with ts-morph (already a dep), collect `id` string-literals, **intersect with the D5 allowlist**. Add the explicit caveat that this reads the *static literal*, not the runtime-resolved conditional set — which is correct **because all 9 D5 modules (`auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are static literal entries**, and a user disables a core module by deleting its literal line (which the AST read detects). Do **not** dynamically import `modules.ts` — at scaffold time the app's deps/env aren't available. |
| §7 "Enabled-module source (D6)" | Offers two mechanisms ("extend `AgenticConfig`" **or** "read `targetDir/src/modules.ts`") without choosing. `generateShared` runs from **two** sites: the create-app wizard (`wizard.ts:146`) and retroactive `yarn mercato agentic:init` (`packages/cli/.../agentic-init.ts`, per lessons.md). | Pick the **file-read** (`read targetDir/src/modules.ts`) so both invocation sites share one mechanism. Extending `AgenticConfig` (today `{ projectName, targetDir }`) forces the `agentic:init` path to also populate it — two code paths that can diverge. |
| §10 preamble | Says "Tests live in `packages/cli/src/lib/generators/__tests__/`", but **T5** (`build.mjs` smoke) and **T6** (`shared.ts` module-guides) test the **create-app** package, not a cli generator. | Split the statement: AST/extractor unit+snapshot tests (T1–T4) in `packages/cli/.../__tests__/`; build/shared wiring tests (T5, T6) in `packages/create-app` (run via `yarn test:create-app`). |

---

## AGENTS.md Compliance (D6 delta)

| Rule | Assessment |
|------|-----------|
| Code placement | ✓ Extractor in `packages/cli`; AGENTS.md generation in `packages/create-app/src/setup/tools/shared.ts`; both correct. |
| Reuse canonical infra, no new deps | ✓ Marker-injection reuses the existing Codex idiom (`codex.ts` `MARKER_START`/`MARKER_END`); enabled-set read reuses ts-morph (already a cli dep). |
| create-app AGENTS.md "Always #8" (keep standalone agent guidance aligned with generator behavior; update **both** `template/AGENTS.md` and `agentic/shared/AGENTS.md.template`) | ✓ The guide routing lives only in `agentic/shared/AGENTS.md.template` (verified: `template/AGENTS.md` has zero `.ai/guides` refs), so D6 touches one surface — but flag the rule so the implementer confirms `template/AGENTS.md` genuinely needs no change. |
| lessons.md "Keep standalone agentic content in sync with module conventions" | ✓ D6 **is** that sync work. |
| lessons.md "Standalone generators must reuse package-generated metadata, not parse compiled `dist`" / "must not assume monorepo-only paths" | ✓ Not violated by D6 — `shared.ts` reads `targetDir/src/modules.ts`, which is **template source** (always present in a scaffold), not compiled `dist`. (Still applies to the deferred R1 generate-time extractor path, already cited under R1.) |
| Tool-scoped regeneration must not be blocked by unrelated files (lessons.md, `agentic-init.ts`) | ⚠ Implementation note: when `agentic:init` re-runs D6 generation on an existing `AGENTS.md`, it MUST replace only the content **between the module-guides markers** (idempotent re-emit), exactly as Codex does — never duplicate or block on the pre-existing block. |
| No `any` | ⚠ Implementation-time — the modules.ts AST read must type its node handling. |

---

## Risk Assessment (D6 delta)

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Enabled-set extraction silently under/over-reports** (the GAP-D6-A subtlety). If an implementer AST-reads only the literal and a future core module the team wants documented is added via a conditional push, it'd be missed; if they try to resolve conditionals, they over-engineer. | Wrong/empty Module-Specific Guides table — the exact "guide is wrong" failure the spec exists to prevent, now in the routing layer. | Pin the mechanism (AST-read the literal ∩ D5 allowlist) + the static-literal caveat in §7. Add T6 assertions for a module that is **present-but-not-enabled** (no row) and **enabled-and-allowlisted** (row), and ideally one that is enabled but **not** in the allowlist (no row). |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| R5 as written ("runs before `src/modules.ts` exists") | Empty table | **Largely already mitigated by ordering** — `index.ts:604` writes the template (incl. `src/modules.ts`) before `:612` runs agentic setup, and the `agentic:init` path runs entirely post-scaffold. R5's fallback-to-allowlist is still a reasonable belt-and-suspenders; keep it but note the ordering already prevents the primary scenario. |
| Idempotent re-emit on `agentic:init` re-run | Duplicated/garbled block | Replace strictly between markers (see Compliance note). Covered if T6 also asserts a second generation pass is stable. |
| Stale legacy stubs in fresh apps | 9 unreferenced `core.<module>.md` files in a fresh scaffold | Harmless; optionally have the D6 filtered copy skip legacy stubs for fresh scaffolds. Not blocking. |

---

## Gap Analysis (D6 delta)

### Critical Gaps (Block Implementation)
- **None.** Prior criticals (GAP-1/2/3) are resolved in the spec.

### Important Gaps (Should Address)
- **GAP-D6-A (extraction mechanism + static-literal caveat):** Specify AST-parsing the `enabledModules` literal ∩ D5 allowlist; document that it reads the static literal (correct because all 9 D5 modules are static entries) and explicitly forbid dynamic-import of `modules.ts` at scaffold time.
- **GAP-D6-B (single mechanism for both invocation sites):** Choose the `targetDir/src/modules.ts` file-read over extending `AgenticConfig`, so create-app scaffold and `mercato agentic:init` share one path.

### Nice-to-Have Gaps
- **GAP-D6-C (test location):** Move T5/T6 to `packages/create-app` tests in §10; keep T1–T4 in cli.
- **GAP-D6-D (intro copy):** The template's "These guides ship automatically when the corresponding module is installed." intro above the table should be reworded for per-enabled generation.
- **GAP-D6-E (idempotency assertion):** Have T6 also assert a second D6 generation pass over an already-generated `AGENTS.md` is stable (marker-replace, not append).
- **GAP-D6-F (legacy-stub clarification):** Note in §7 that fresh D6 scaffolds reference neither legacy `core.<module>.md` nor the stubs; stubs exist only for in-place upgrades.

---

## Remediation Plan

### Before Implementation (Must Do)
1. **GAP-D6-A:** Add to §7 the exact enabled-set extraction (AST-read `enabledModules` literal via ts-morph, intersect D5 allowlist) and the static-literal caveat; forbid dynamic import at scaffold time.
2. **GAP-D6-B:** State the chosen mechanism (file-read of `targetDir/src/modules.ts`) and apply it to both `generateShared` invocation sites.

### During Implementation (Add to Spec / Tests)
1. **GAP-D6-C:** Correct §10 test locations (T5/T6 → create-app).
2. **GAP-D6-E:** Extend T6 with the not-enabled / not-allowlisted / second-pass-idempotency cases.
3. **GAP-D6-D / -F:** Reword the table intro; clarify legacy-stub scope.
4. Implement the marker block as an idempotent between-markers replace (mirror `codex.ts`).

### Post-Implementation (Follow Up)
1. R1 deferred generate-time regeneration in scaffolded apps (so the per-module table can also reflect *installed* package versions, reusing the package-shipped `generated/` per lessons.md).
2. Extend D5 to the remaining core modules; revisit whether package guides should become conditional on installed packages (would require revisiting the §2 Non-Goal — out of scope now).

---

## Recommendation

**Ready to implement after minor spec clarifications.** The architecture (D1–D5), the prior data-accuracy fixes, and the new D6 are all sound; D6's two load-bearing claims (Codex marker idiom; `src/modules.ts` written before agentic setup) are **verified true against the code**. The only must-do items are documentation precision around D6's enabled-set extraction (GAP-D6-A) and choosing a single mechanism (GAP-D6-B) — neither changes the design. Once those land, the spec can be implemented against the existing `packages/cli` AST infra and the `packages/create-app` agentic generators.
