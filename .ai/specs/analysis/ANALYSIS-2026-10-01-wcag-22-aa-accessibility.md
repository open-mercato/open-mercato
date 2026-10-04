# WCAG Package — Readiness and Existing Work Analysis

Date: 2026-10-02, extended 2026-10-04. Scope: [master specification](../2026-10-01-wcag-22-aa-accessibility.md), [Guardian](../2026-10-01-wcag-guardian-pr-review.md), [Storybook](../2026-10-01-storybook-wcag-quality-gates.md), `om-wcag-guardian` sources, existing specifications, skills, UI, harness, CI, and related issues. Method: `om-pre-implement-spec`, independent read-only reviews, and upstream verification. This analysis does not authorize application implementation or review/CI changes.

## Executive Summary

**The program is justified, but the Guardian package needs corrections before PR enforcement.** Existing work includes storefront WCAG specifications, CRM requirements, enterprise accessibility patterns, DS Guardian, primitive tests, standalone quality-state contracts, and Storybook. The new contribution is a shared scope for the entire product, a criterion–process–configuration–state–method–build ledger, and evidence requirements. No equivalent program was identified in the searched sources of either inspected branch; this finding does not cover private trackers or unrestricted customer extensions.

Key findings:

- The Guardian source initially had no tier assignment and failed Skills Tiers Lint; it is now registered in the opt-in `analysis` tier (R1 resolved).
- The validator can accept `ready` despite crash, zero-test, or axe-incomplete data; it does not interpret that data.
- Applicability evidence, provenance, and environment versions are enforced less strictly than the intended contract specifies.
- Storybook already exists upstream. Token parity/contrast already has a test executed in CI.
- Some related fixes are in open PRs, while Calendar and deal status fixes were merged into develop on 2026-10-02. Do not plan duplicate fixes without retesting.

## Version Baseline and Evidence Limits

Reviewed package: the three specifications, the `om-wcag-guardian` sources, and the audit templates submitted together with this report.

Verified upstream snapshots: main `fefc71d09efe2aa8c732dc6fafaa084a0e0dae3c`, develop `7f0ebf65398fbf75a3f2485cc79d31da92a108b3`. The inventory covers specifications, skills, UI, design_system, harness, DS tooling, and CI; it is not a complete code audit of every module and submodule. Later merges may require another snapshot.

The statuses, content, and history of 22 related issues and the statuses of nine relevant PRs were read from GitHub on 2026-10-02. The [master issue map](../2026-10-01-wcag-22-aa-accessibility.md#existing-issue-links) is the canonical table of owners, criteria to evaluate, and further evidence. Open does not mean unfixed, closed does not mean pass, and a cross-reference does not prove a fix. No comments were published, no issues were created, and no labels or PRs were changed.

## Existing Work / Ownership

Detailed links to pinned sources are in the [master reuse table](../2026-10-01-wcag-22-aa-accessibility.md#upstream-verification-and-existing-work--2026-10-02).

| Capability | Existing owner | Next decision |
|---|---|---|
| Storefront WCAG 2.2 AA | SPEC-029 §18 on main; storefront-app specification on develop | Reuse processes and requirements; apply the broader master standard covering all A/AA criteria |
| CRM WCAG 2.1 AA | CRM detail UX specification | Extend evaluation to 2.2 and complete processes |
| Enterprise keyboard/navigation | Agent-orchestrator UX specifications | Retain commercial owners and include configurations in manifests |
| DS rules/primitives/review | DS foundation, DS Guardian, PR checklist, DS lint | Consume canonical guidance; do not duplicate rules or reporting |
| Token parity/contrast | check-token-parity + real CSS test + test:scripts CI | Retain the gate; add rendered pairs and unresolved values |
| Catalogue/Storybook | Existing design_system registry, AST generator, and smoke tests | Extend upstream sources; do not recreate infrastructure |
| Standalone UI knowledge | backend-ui-design references and OMH-092/115/137/176 | Reuse or strengthen the narrowest existing owner; add cases only for distinct gaps |
| Product evidence program | Master specification and QA manifest/evaluation templates | New integrating capability; templates remain unevaluated |

Older storefront requirements incorrectly assign 44×44 to SC 2.5.8 and focus appearance to SC 2.4.11. The master correctly distinguishes AA from AAA. During implementation, agree on corrections to older references without lowering additional product requirements. See [SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum) and [SC 2.4.11](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum).

## Backward Compatibility Audit

The current `BACKWARD_COMPATIBILITY.md` contains **14** categories, despite the count of 13 in root/skill guidance. All 14 were reviewed; the documentation package itself changes no public contracts. The following constraints apply to future fixes.

| Surface | Result / constraint |
|---|---|
| Auto-discovery conventions | No module convention file changes; the skill must satisfy the existing tier invariant |
| Public types/interfaces | Preserve props/defaults; keep gallery metadata in a sidecar without new required fields |
| Function signatures | Do not remove or narrow parameters; apply fixes through existing call sites |
| Import paths | Do not move public paths or remove exports |
| Event IDs | Do not change IDs/payloads; status announcements must not duplicate mutations |
| Widget injection spots | Preserve spot IDs, replacement handles, and injected fields/actions |
| API URLs/responses | No new API; do not change response/auth contracts for scanner needs |
| Database schema | No entities/migrations; evidence is a QA artifact |
| DI service names | No new or changed DI keys |
| ACL feature IDs | Preserve metadata/RBAC and tenant/organization scoping |
| Notification IDs | Do not change types; keep announcements minimal and scoped |
| AI IDs/overrides | No changes to agent/tool/UI-part IDs or override semantics |
| CLI commands | Add tooling commands only additively, without replacing existing commands |
| Generated contracts | Sources/generators own these contracts; do not edit generated output manually |

## Spec Completeness / AGENTS Compliance

The master includes the required sections, manifest perimeter, roles, phases, frontend budget, complete-flow sampling/expansion, separation of the 55-criterion index from the evaluation ledger, fail/unknown roll-up, and evidence revalidation. It does not omit a delivered module merely because it is inactive in one build, or omit an external process step. AAA recommendations are distinguished from AA; a keyboard fallback does not replace the non-drag single-pointer alternative required by SC 2.5.7.

UI/HTTP/DS/i18n/guards/optimistic-locking requirements and the absence of runtime scanner dependencies are correctly preserved in the design. New storage, encryption maps, commands, DB transactions, and cache invalidation are N/A for this scope. Product tests require API fixtures and cleanup; Storybook tooling does not prove permissions, payment behavior, or AT behavior. Read area-specific AGENTS guidance again for each implementation PR.

The lessons index was searched for UI/design_system/harness/accessibility; existing lessons on source inventory versus coverage and canonical primitive reuse were applied. One lesson was added with this package: write specifications in English.

Still outstanding: a complete route/config/API manifest, named approvers, a runtime baseline, complete-process evaluation, and manual AT testing. These are explicit phase 0 deliverables, not evidence of a completed audit. Before each family of fixes, require a concrete path manifest and integration tests in the same PR.

## Findings / Risks / Gaps

| ID / severity | Problem and reproduction | Impact / required resolution |
|---|---|---|
| R1 High (resolved) | `.ai/skills/om-wcag-guardian/SKILL.md` initially had no assignment in tiers.json, which the Skills Tiers Lint workflow rejects for `.ai/skills/**` | Resolved: registered in the opt-in `analysis` tier; lint is not disabled. Promotion to `core` remains a later, separately approved step |
| R2 High | An in-memory report with an assessment marked pass and `runResult={exitCode:1, discoveredTests:0, axeIncomplete:[...]}` still yields ready; the validator ignores this additional object | False green on failure/incomplete execution. Require a typed execution contract and adapter, derive the result from execution, and test negative cases before caller integration |
| R3 Medium | All required assessments marked N/A with empty evidence and an arbitrary rationale yield ready | Real requirements can be omitted. Require applicability evidence or a verified manifest decision for the surface/state/configuration |
| R4 Medium | An honest incomplete report with base=null is rejected by mandatory SHA/snapshot requirements | There is no way to report unavailable provenance. Allow nullable facts only in an incomplete branch, without fabricated IDs |
| R5 Medium | Changing base/head while retaining snapshotId is accepted; Chrome/Windows/NVDA metadata without versions and a date in 2099 also pass | Require structured commit/build/dirty identity, versions/time, trusted caller evidence binding, and explicit reuse revalidation. A schema does not prove authenticity |
| R6 Medium | The initial G3 did not identify existing OMH cases and knowledge owners | Parallel knowledge/harness risk. The specification now requires reuse/strengthening of OMH-092/115/137/176; execution remains future work |
| R7 Medium | The actual caller does not yet exist; generic review severity shortcuts and the CI ratchet may diverge from the verdict | Acceptance tests must cover every applicable failure, including minor failures, and incomplete results. The caller reads the verdict; legacy debt must not convert fail to ready |
| R8 Medium | The first draft treated the catalogue/Storybook layer as lacking upstream confirmation | Upstream presence is now confirmed; S1/S2 require source/generator/build provenance |
| R9 Low (resolved) | Finding evidence was required in prose, but the validator mainly checks the failed checkId | Resolved: the report contract states that a finding inherits the evidence of the failed assessment it references |
| R10 Medium | The validator rejects a `criterionId` outside the 55 WCAG criteria, so the supplement requirements added on 2026-10-04 cannot be reported as assessments | A change that breaks only a supplement requirement, such as an e-mail template or a sanitizer, cannot be expressed as a failed assessment. Extend the contract to supplement identifiers, with tests, before G2; until then the product ledger carries those results |

R2–R5 are synthetic validator probes, not evidence of defects in the current application. CLI exit 0 means structural validity even for changes_required/incomplete; it is not a standalone gate success. The scanner is not credited with coverage of all 55 criteria or the ability to verify screen reader speech.

## Normative Coverage Review — 2026-10-04

The package was compared with the texts it has to satisfy: WCAG 2.2 (criteria and conformance requirements), EN 301 549 V3.2.1 Table A.1 and V4.1.1 (clauses 4.2, 5, 6, 7, 9.6, 9.7, 10, 12, 14, clause A.2 with Tables A.1 to A.5, and Annexes ZA and ZB), Directive (EU) 2019/882 (Annex I Sections III and IV(g), Article 13, Annex V), and Directive (EU) 2016/2102 Article 7. A read-only survey of the product source at develop `7f0ebf65398fbf75a3f2485cc79d31da92a108b3` established which conditional requirements apply. Before this review the package covered the 55 criteria and nothing else.

| Gap | Why it matters | Resolution |
|---|---|---|
| N1. No normative basis or version policy | The target could not be traced to the standard deployers are measured against, and EN 301 549 V4.1.1 was published in September 2026 with new numbering | Master: Normative Basis and Version Policy; stable identifiers with both clause numberings |
| N2. EN 301 549 requirements outside clause 9 were absent | User preferences, authoring tools, downloadable documents, conversion, biometrics, documentation, and support apply to web content under V3.2.1 Table A.1 and V4.1.1 Annex ZA; non-web documents in general, including e-mail, and the functional performance criteria apply under V4.1.1 clause A.2 | Supplement index (48 rows) and master: User Preferences and Platform Settings, Requirements Beyond the Web Interface |
| N3. Nothing let a deployer meet its own obligations | Under the EAA a service provider must prepare information on how the service meets the requirements, show accessibility information about goods sold when the operator provides it, and keep and demonstrate conformity; under the WAD a public sector body must also publish a statement with a feedback mechanism | Master: Information a Deployer Must Be Able to Publish |
| N4. Conformance requirements and reporting were not specified | Passing criteria on sampled pages is not conformance; accessibility-supported technologies, non-interference, overlays, and the report format were undefined | Master: Conformance Requirements and Reporting |
| N5. Twenty-three criteria had no product contract beyond a mention | The index listed them, but nothing said what the product must do about time limits, automatic updates, flashing, changes of context, consistency, input purpose, language of parts, or error prevention | Master: Timing, Predictability, and Error Prevention; additions to Forms and Authentication |
| N6. Forced colors was classified as optional | EN 301 549 requires that user-agent settings are followed (V3.2.1) and not blocked or explicitly overridden (V4.1.1) | Reclassified as a requirement (`ENS-13`); visibility of focus and state in that mode is a program reading awaiting confirmation |
| N7. The manifest could not hold the new scope | Messages, authoring surfaces, templates, documentation, embeds, and the standards and accessibility-support baselines would never be evaluated | Manifest template version 2 |
| N8. Continuity had no owner | Third-party intake, feedback intake, competence, release cadence, and the standards watch were undefined | Master: Governance and Continuity |
| N9. The report cannot carry supplement results | See R10 | Open |

An independent review of the extension on the same day corrected eighteen statements, added sixteen supplement rows, and found that the extension implies eight separately deployable capabilities. The master lists them as dependent specifications and defines the requirement and acceptance only; whether that split is accepted is the master's open question Q1. The source observations recorded in the master are evaluation leads with method `source`, not findings. The 44×44 references in the storefront specifications stay with their owner, as already recorded above.

## Remediation Plan / Acceptance

1. **Done with this package**: draft registration in the opt-in `analysis` tier; Skills Tiers Lint passes without activating review. Router code is unchanged.
2. **G1 before G2**: correct the contract/validator for R2–R5/R9/R10; tests must reject every false-green probe and accept an honest incomplete report. The caller verifies required source/runner/artifact provenance.
3. **Before application fixes**: select a current develop snapshot, refresh existing issues/PRs, and establish the baseline. First review/retest existing #5536/#5966/#6792; retest merged #6737/#6487 without duplicate fixes.
4. **Before Storybook/CI rollout**: approve a concrete guide/sidecar/runner/dependency diff. Reuse existing generators and the CI token gate; a failing fixture must fail, its correction must pass, and zero tests/incomplete/stale evidence must never yield green.
5. **Before standalone/core enforcement**: reuse the listed knowledge owners, a failure-first harness, and packed-preset proof; test the actual caller for UI/CSS/locale changes, minor failures, incomplete results, and genuine N/A. Preserve QA labels and merge policy.

## Validation / Recommendation

Runner: **local Python/shell**, read-only analysis; no module file generation or application runtime.

- The 25 validator tests passed. This proves the current assertions, not every specification promise.
- Seven independent in-memory probes verified the contract limitations listed in R2–R5.
- `sh scripts/validate-skills-tiers.sh` passes with the skill registered in the `analysis` tier, and `node packages/create-app/agentic/shared/scripts/check-lessons.mjs --root .` passes.
- Existing main/develop sources and live issue/PR states were checked. No application build, Storybook/axe run, manual AT testing, migrations, skill installation, or automation changes were performed.

Recommendation: **continue program alignment and the baseline; hold PR enforcement until R2–R5, R10, and caller acceptance are resolved.** Product conformance remains unevaluated, the skill is not installed by default, and the application and CI remain unchanged.

## Changelog

- 2026-10-02 — Independent review, upstream deduplication, 14-surface BC audit, 22 linked issues, identified readiness blockers, and concrete conditions for further implementation.
- 2026-10-02 — Translated the report into technical English and aligned master specification anchors; no changes to findings, evidence, or implementation readiness.
- 2026-10-02 — Updated for the submitted package: R1 and R9 resolved; validator tests extended to 25 with a unified method vocabulary, tool-based `automated` evidence, and rejection of expired legacy debt. R2–R5 and the caller remain open.
- 2026-10-04 — Normative coverage review against WCAG 2.2, EN 301 549 V3.2.1 and V4.1.1, Directive (EU) 2019/882, and Directive (EU) 2016/2102: nine gaps recorded, eight closed in the master specification and its templates, R10 opened for the report contract. An independent review then corrected eighteen statements and extended the supplement from 32 to 48 rows.
