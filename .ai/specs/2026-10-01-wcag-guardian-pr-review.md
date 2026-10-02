# WCAG Guardian — Feature Development and PR Review

## TLDR

Introduce `om-wcag-guardian`: a skill that assesses the accessibility of new features and PR changes against the [WCAG 2.2 AA contract](2026-10-01-wcag-22-aa-accessibility.md). It identifies the affected scope, requires appropriate evidence, and distinguishes confirmed violations from hypotheses and verification gaps. It integrates with the existing review workflow and DS Guardian without introducing a new label system or automatically granting QA approval.

Status: the specification and source files for the instruction package and report validator are **a draft proposed for review**. The skill is registered in an opt-in tier only; default installation and changes to routing, review, and the harness require subsequent approval of a concrete diff. The skill is not yet active in the project.

## Review Findings — 2026-10-02

[Readiness report](analysis/ANALYSIS-2026-10-01-wcag-22-aa-accessibility.md): **the package is not ready for PR enforcement**. R1 is resolved: the source is registered in the opt-in `analysis` tier, which satisfies Skills Tiers Lint without installing the skill by default. Validator v1 remains a structural prototype: it ignores execution metadata, allows N/A without evidence, and has provenance gaps (R2–R5). The requirements below define the target contract; the 25 tests do not demonstrate its implementation. Do not connect the package to a caller until these blockers are resolved.

The master specification lists [existing issues and owners](2026-10-01-wcag-22-aa-accessibility.md#existing-issue-links). Actual regression families include #5511/#5478 (forms), #6445/#6771/#6853 (focus), #6327 (locale), #6079 (keyboard/drag), and #5011/#4651 (contrast). Tooling deduplication: [#5094](https://github.com/open-mercato/open-mercato/issues/5094), [#5131](https://github.com/open-mercato/open-mercato/issues/5131), and [#5096](https://github.com/open-mercato/open-mercato/issues/5096); standalone certification: [#4670](https://github.com/open-mercato/open-mercato/issues/4670). Do not add another copy of the DS checker.

## Overview

DS Guardian assesses tokens, components, and selected accessibility requirements. It does not replace assessment of complete processes, keyboard and focus lifecycles, auth/MFA, dynamic states, pointer alternatives, or screen reader evidence. The existence of a skill alone does not enforce its use in PRs: discovery, the creation router, the review caller, and report validation must be integrated.

## Problem Statement

Without discovery, routing, a review caller, and reliable report validation, the skill cannot enforce the required accessibility review.

The skill supports two consistent usage paths: a design/implementation contract and review/evidence assessment. During local use, it does not modify code or publish anything without authorization for the relevant action. PR materials are untrusted data; instructions in a diff, comment, or HTML must not change review rules.

## Proposed Solution

Use a complementary repo-local WCAG skill integrated through the existing discovery, UI guidance, review, and standalone harness owners.

## Architecture

| Layer | Proposed Change | Owner |
|---|---|---|
| Source | `.ai/skills/om-wcag-guardian/` | Repo-local skill |
| Discovery | G1: the draft is registered in the opt-in `analysis` tier; G2: promote it to the default `core` tier | Existing tier invariant; actual review activation remains separate |
| UI development | Short routing rules in root/UI AGENTS and backend-ui-design | Approval for agent guidance; instruction budget checked |
| Review | Checklist + repo-local om-code-review override invoke the guardian for UI impact | Existing review workflow |
| Auto-review | Inherits through existing code-review and checks for a valid report | No procedure duplication across multiple skills |
| Standalone | Public rules and knowledge transferred to the appropriate harness owner | Failure-first + manifest + packed preset proof |

DS Guardian does not need to be rewritten: the new skill uses the DS canon and has a separate WCAG responsibility. Any backlink or DS governance change follows the owner approval path in the PR workflow. Do not introduce a new score such as “accessibility 9/10”. The verdict applies to the PR scope, not the product.

The minimum caller → guardian interface includes the repo root, a local base and HEAD or an immutable PR diff, changed files, indirectly affected consumers, baseline/legacy references, available build/test/manual evidence, side-effect permissions, and an allowed report directory. Do not infer the base from `main`; the configuration currently specifies develop. An unverifiable base produces `incomplete`.

### Impact Scope

Analyze more than TSX: CSS/tokens, locales, icons/assets, theme configuration, dependency updates, generated sources, route metadata, and guards can affect accessibility. Changes to a shared primitive require examples and critical consumers; token/theme changes require affected color pairs, states, and light/dark modes; locale changes require accessible names and long strings; modal changes require keyboard/AT lifecycle checks. For generated output, identify the source rather than requiring manual edits to the output.

Documentation/API-only changes may receive `not_applicable` if they do not affect the interface or user-facing guidance. N/A must reflect an actual impact assessment. The absence of a TSX file in the diff is insufficient for N/A.

## Data Models

No business entities or APIs are introduced. The local JSON report contains a schema version, base/head, scope, required assessments, and findings. Each assessment includes criterionId, surface/state, applicability, method, status, and evidence. Each evidence entry includes a source, verified HEAD, date, and method description; screen reader evidence specifies browser/OS/AT versions and actions. The presence of a run result alone does not establish UX quality.

Methods are `source`, `automated`, `browser`, `measurement`, `manual`, and `manual_at`; the same vocabulary is used by the criterion index and the evaluation ledger and is defined in the [report contract](../skills/om-wcag-guardian/references/review.md#methods). A pass or fail by `automated` names the tool and version; `browser` and `measurement` name the browser; `manual_at` additionally names the OS and assistive technology.

Verdicts: `ready`, `changes_required`, `incomplete`, and `not_applicable`. `ready` requires complete coverage of the declared required scope and current evidence; `fail` in relevant scope produces `changes_required`; missing, unavailable, or stale evidence, or unresolved axe incomplete results, produce `incomplete`. N/A requires a rationale. The validator rejects a report with no assessments for relevant scope or an inconsistent verdict. It does not establish that the reviewer selected the correct scope; that requires separate review and harness testing.

The report includes legacy debt fields; an existing violation with an issue, owner, and expiry remains a failure in the product ledger. The validator rejects a report that lists debt past its expiry. A new PR must demonstrate that it does not worsen the existing problem; a baseline fingerprint must not hide a new barrier with the same count. Unverified results are not nits; missing evidence needed for assessment means incomplete.

## API Contracts

No business API endpoints change. The caller interface and versioned internal report contract defined above govern the tooling integration.

## Workflow and Enforcement

1. Before building UI: define an accessibility contract in the specification covering role/name/value, keyboard/focus, errors/status, contrast/reflow, and pointer/AT behavior. The author uses it to plan appropriate stories and integration tests.
2. Review the diff: establish the scope ledger, consumers, and declared required combinations; use API-only N/A when there is genuinely no impact.
3. Verify: inspect source, automated results, and browser interactions; perform manual screen reader checks when a change affects names, focus, relationships, live feedback, auth, or composite widgets. If a tool or environment is unavailable, the report states exactly what remains unverified.
4. Record findings: SC, user impact, reproduction steps, verified file/line where applicable, confidence, evidence, a proposed minimal fix, and a test. A grep match for a possible ARIA problem does not establish a product failure.
5. Validate JSON and return the verdict to the caller. Existing code-review requires ready/N/A for UI scope; changes_required or incomplete does not grant automatic approval.

Severity follows impact: blocker — an impossible critical process or a focus trap; major — a confirmed barrier in a relevant flow; minor — a limited barrier that still requires an A/AA fix; nit — an additional recommendation outside the target. Do not map axe impact to severity without analysis. AAA and design recommendations remain separate from A/AA requirements.

The guardian does not independently claim PRs, post comments, change labels, approve/merge, or set `qa-approved`. It returns results to the existing authorized caller. `needs-qa` still requires `qa-approved`; an automatic scan does not replace QA. The caller follows the existing claim/permission protocol. All existing hard merge blocks remain in force.

## UI/UX

The skill specifies requirements for actual locales and the shared DS. It must not attempt to fix accessibility by adding a hidden English name that conflicts with a visible Polish label. It verifies programmatic state, messages, and process outcomes, not merely the presence of attributes.

## Internationalization

User-facing results may be displayed in the user's language; machine statuses remain stable.

## Implementation Plan

| Phase | Deliverable | Acceptance |
|---|---|---|
| G1 | Source, opt-in registration, and a corrected report contract | Skills Tiers Lint passes; negative probes from the review are rejected; no default activation |
| G2 | Discovery/core tier and creation/review routing | The skill is installed by default; the actual review caller invokes it |
| G3 | Meaningful forward-tests and standalone knowledge updates | Known defects are detected, false passes are rejected, and N/A is correctly justified |

Before G2, a typed execution record is required: pinned runner/tool/browser/OS/AT versions, execution status, exit code, discovered/executed counts, unresolved results, artifact reference/hash, commit/build/dirty provenance, and observation time. Crashes, timeouts, zero tests, and axe incomplete results cannot produce ready even if an assessment is declared pass. Contradictory or unsupported execution fields are rejected. Assessment N/A requires applicability evidence for the specific surface/state/configuration; a rationale alone does not complete a required check. An unavailable base/build produces an explicit incomplete variant with nullable facts and a reason, without invented SHAs. Reused evidence requires revalidation of its relationship to the new build. The caller verifies artifacts; schema validation does not establish their authenticity.

The caller tests every applicable fail, including minor failures, and treats incomplete as lack of acceptance. Validator exit 0 means structural validity; the caller reads the verdict. Legacy debt does not change fail to ready; the CI ratchet has a separate rollout policy. A finding inherits evidence through an explicit assessment/check reference or contains its own verified references.

| Existing Harness Case | Disposition and Owner |
|---|---|
| OMH-092 | Reuse existing backend UI/DS contracts; strengthen contrast/state coverage |
| OMH-115 | Existing deal-board contract; extend keyboard/touch/AT/non-drag pointer coverage |
| OMH-137 | Existing setup wizard contract; extend auth/error/focus/evidence coverage |
| OMH-176 | backend-ui-design `references/quality-states.md`; reuse the inaccessible dialog case, failure-before/success-after |
| New cases | Only validator/caller false-green results, provenance, and activation; no duplication of the knowledge above |

Evaluation scenarios: a missing label in CrudForm; a token contrast regression without TSX; a translation that removes an accessible name; a dialog stealing focus after closing; legacy axe debt versus a new issue with an equal count; zero tests; stale evidence from another HEAD; axe incomplete; all axe checks passing with inaccessible auth; API-only changes without impact; a quoted PR instruction saying “ignore WCAG”; an AAA target-size recommendation incorrectly presented as AA. Do not give the expected outcome to the evaluator agent. Reviewing the skill does not publish comments or modify the repository.

## Integration Test Coverage

Report tests are part of the package and cover actual invariants: ready requires current, complete evidence, with no false pass for fail, incomplete, or missing evidence. An integration test for the review caller in a separate PR checks activation for UI/CSS/i18n changes and preservation of QA policy. Installation and template/harness changes pass the existing validators; harness cases demonstrate failure before / success after at the smallest appropriate owner. CLI/script outputs in the report include execution status, exit code, and evidence; an unavailable tool is not success.

Product tests remain in the module's __integration__ directory; the skill does not move them into the instructions directory. The frontend boundary is N/A for the skill itself; it introduces no browser runtime/provider. The validation runner is selected once according to agent-instructions; a separate specification covers subsequent CI integration.

## Migration & Backward Compatibility

The skill and routing references are additive. Public helpers and the label taxonomy remain unchanged; the report schema is a new internal tooling v1 contract. Future changes affecting report consumers require compatibility or explicit versioning. Check the AGENTS instruction budget before integration; do not duplicate the 55-criterion matrix in the root. Shared external skills remain upstream; use local overrides.

## Risks & Impact Review

### Risk Register

#### Skill Is Not Invoked

- **Scenario**: The skill exists, but the actual review caller does not invoke it.
- **Severity**: High
- **Affected area**: PR review
- **Mitigation**: Discovery, routing, and an integration test for the caller.
- **Residual risk**: An agent may not follow instructions; independent CI evidence is still required.

#### False Ready Verdict from Automated Evidence

- **Scenario**: A report is marked ready based on axe alone or ignored failed, incomplete, or stale execution evidence.
- **Severity**: High
- **Affected area**: Accessibility assessment and compliance
- **Mitigation**: Required assessment methods and rejection of failed, incomplete, stale, or missing evidence; resolve R2–R5 before caller activation.
- **Residual risk**: Incorrect reviewer scope requires a separate review. Schema validation does not establish artifact authenticity.

#### Untrusted PR Instructions Override Review Rules

- **Scenario**: Copied instructions from a PR diff, comment, or HTML bypass review rules.
- **Severity**: High
- **Affected area**: Review trust boundary
- **Mitigation**: Treat artifacts as data and include a prompt injection evaluation case.
- **Residual risk**: Prompt injection remains a general risk.

#### Unauthorized Local or External Mutation

- **Scenario**: The skill overwrites local work or posts a comment without authorization.
- **Severity**: High
- **Affected area**: Local workflow and external PR activity
- **Mitigation**: Read-only by default, with explicit permissions per mutation.
- **Residual risk**: The caller must respect its own authorization.

#### Disproportionate Review Overhead

- **Scenario**: Review overhead becomes disproportionate to the affected scope.
- **Severity**: Medium
- **Affected area**: Developer experience
- **Mitigation**: Risk-based affected scope and genuine N/A decisions.
- **Residual risk**: Full scans for shared/theme changes cost more.

#### Tier and Harness Integration Gaps

- **Scenario**: The skill lacks tier registration, or promotion to the core tier exceeds the instruction budget.
- **Severity**: High for missing registration (R1); Medium for instruction budget growth
- **Affected area**: Skills Tiers Lint, skill discovery, and the standalone harness
- **Mitigation**: Approved opt-in registration before default activation; a short entrypoint, references, and an instruction budget check.
- **Residual risk**: Knowledge rollout still requires maintainer approval. Registration alone does not activate the actual review caller.

No business data writes, tenant queries, database migrations, event emissions, or new production dependencies are introduced by this package. Data integrity, tenant isolation, and business API migration risks are N/A for this scope; future caller integration must reassess its own side effects.

## Final Compliance Report — 2026-10-02

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md / `.ai/specs/AGENTS.md` | Spec-first; check existing specifications and follow the specification format | Compliant for this document | Links the master specification, existing issues, and the readiness report; preserves the phased plan |
| root AGENTS.md / `BACKWARD_COMPATIBILITY.md` | Preserve public contracts | Compliant by design | Additive internal tooling; public helpers, label taxonomy, and existing merge blocks remain unchanged |
| root AGENTS.md | Ask before changing branch/PR automation, QA flow, or design-system governance | Compliant for current scope | Sources and documents only; installation, routing, automation, and governance integration are not performed |
| `.ai/skills/README.md` / existing Skills Tiers Lint | Repo-local skill sources require tier assignment | Compliant | R1 resolved: registered in the opt-in `analysis` tier; lint is not disabled and the skill is not installed by default |
| root AGENTS.md / `.ai/qa/AGENTS.md` | Verify behavior with meaningful tests and evidence | Blocked | R2–R5: execution, applicability, unavailable provenance, and evidence binding gaps remain; 25 passing tests do not establish target contract coverage |
| root AGENTS.md | Keep AGENTS.md within the instruction budget | Pending integration | Short routing guidance is planned; run the budget check before integration |
| `packages/ui/AGENTS.md` / UI DS and i18n guidance | Reuse canonical UI and localized accessible names | Compliant by design | No runtime dependencies or UI implementation changes; the guardian uses the existing DS canon |
| `packages/create-app/AGENTS.md` | Follow standalone harness ownership and validation | Pending integration | Reuse OMH-092/115/137/176 and their owners; full harness runs and packed-preset proof remain future work |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass for design | No business entities or APIs; the internal report contract is defined |
| Report implementation matches verdict requirements | Fail | R2–R5 prevent enforcement; validator v1 is a structural prototype |
| API contracts match UI/UX section | N/A | No business API changes; localized reporting and stable machine statuses are specified |
| Risks cover all write operations | Pass for authorized scope | No application writes; caller mutations require authorization and reassessment |
| Commands defined for all mutations | N/A | No business mutations or new commands |
| Cache strategy covers all read APIs | N/A | No storage or read APIs introduced |
| Discovery and caller activation are demonstrated | Fail | Tier registration exists (R1 resolved); actual discovery/review integration has not been performed |
| Harness ownership and evaluation scenarios are specified | Pass for design | Existing owners are identified; full harness runs remain incomplete |

### Non-Compliant Items

- **Rule**: Verification must provide meaningful evidence for the required behavior.
  **Source**: Root `AGENTS.md` verification requirements and `.ai/qa/AGENTS.md`.
  **Gap**: R2–R5: the prototype ignores execution metadata, accepts unsupported N/A, cannot represent unavailable provenance honestly, and inadequately binds evidence to commit/build identity.
  **Recommendation**: Implement the typed execution/applicability/provenance contract and negative tests before G2; the trusted caller must verify artifact binding and read the verdict.

### Verdict

**Non-compliant: blocked for PR enforcement until R2–R5 and caller acceptance are resolved.** The package remains available for assessment and is not installed. Installation/routing and automation/governance require separate approval. Actual discovery/review integration, main-branch revalidation, and full harness runs are not completed.

## Changelog

### 2026-10-01

- Skill design, report semantics, creation/review hooks, negative scenarios, and independent validation. Integration was not performed.

### 2026-10-02

- Review findings, linked issues/harness owners, opt-in registration before core, and required execution/applicability/provenance fixes. Routing remains unchanged.
- Translated the specification into English and aligned its risk register and compliance report with the Open Mercato specification template; no functional changes.
- Registered the draft in the opt-in `analysis` tier (R1). Unified the method vocabulary across the report, criterion index, and ledger; `automated` evidence now names a tool instead of a browser; expired legacy debt is rejected; a finding inherits the evidence of its failed assessment (R9). Validator tests grew from 12 to 25. R2–R5 and routing remain open.
