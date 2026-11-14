# Review evidence and report contract v1

The caller supplies the reviewed snapshot and affected scope. A snapshot is a commit/build plus a digest identifying dirty work if present. Do not invent it. Pin the same snapshot in every evidence record. A changed commit, dirty overlay or build invalidates earlier evidence unless its relevance is explicitly re-established.

## Report fields

| Field | Meaning |
|---|---|
| schemaVersion | `1` |
| base / head | Actual 40-character commit SHAs |
| snapshotId | Stable commit/build/dirty digest identifier |
| scopeRelevant / scopeRationale | Reasoned impact decision |
| requiredChecks | Nonempty list of check IDs for relevant scope, declared before evaluating |
| assessments | One per check; checkId, criterionId, surfaceId, state, method, status, evidence; rationale for N/A or unverified. `criterionId` is a WCAG 2.2 A/AA success criterion number. Supplement identifiers (`ENS-*`, `EAA-*`, `WAD-*`) are part of the target but are not accepted by this contract version: name them in `scopeRationale`, record their result in the product ledger, and return `incomplete`, or `changes_required` for a confirmed supplement failure |
| findings | Confirmed failures with checkId, severity, userImpact and reproduction; the evidence is the evidence of the failed assessment the finding references; do not fabricate source locations |
| legacyDebt | Separate list of inherited problems with fingerprint, owner, reference, expiry and surfaceId |
| verdict | Derived from all required assessments |

## Methods

The same vocabulary is used by the report, the [criterion index](../../../qa/accessibility/wcag-22-aa-matrix.csv) and the evaluation ledger.

| Method | Meaning | Required `environment` for pass/fail |
|---|---|---|
| `source` | Reading code, tokens, locale files | none |
| `automated` | Scanner or linter result (axe, static rule) | `tool` with version |
| `browser` | Interaction and state inspection in a real browser | `browser` with version |
| `measurement` | Numeric measurement of rendered output (contrast, geometry, flash) | `browser` with version |
| `manual` | Human judgement without assistive technology (captions, consistency, instructions) | none |
| `manual_at` | Session with a screen reader or other assistive technology | `browser`, `os`, `assistiveTechnology` with versions |

Status: `pass`, `fail`, `not_applicable`, `not_evaluated`. Evidence: snapshotId, source (artifact/path/run reference), observedAt (ISO date, `YYYY-MM-DD`), description. Source confidence is not a reader result, and an `automated` pass covers only the part of a criterion the tool can detect.

Required checks should include separate source/browser/AT entries when the changed behavior needs them. The bundled validator verifies coverage of declared checks and internal consistency, not whether the reviewer declared enough checks. Peer review and forward-tests evaluate selection quality. A source-only pass cannot discharge an undeclared required browser or reader check.

`legacyDebt` is context, never a blanket pass exemption. Required checks must not omit a regression or new barrier just because a baseline issue has a similar rule/count. Use stable fingerprints and explicit evidence of unchanged scope. The validator rejects a report that lists debt past its expiry: repair it or renew it with the owner first. The product ledger retains failures until repaired.

## Human result

Lead with ready/changes_required/incomplete/not_applicable and the actual reviewed scope. List confirmed findings by human impact; for each give criterion, affected state, reproduction, confidence and minimal fix/test. Separately list unverified checks, tools unavailable and legacy debt. Report commands actually executed, exit results and artifact references; no implied runs. End with remaining limitations and the existing caller's next action.

Blocker/major/minor/nit describe human impact, not WCAG A/AA level or axe impact. Any applicable confirmed A/AA failure or supplement failure within the required change scope yields changes_required; enhancements and product decisions that go beyond a clause do not. Missing mandatory evidence yields incomplete when there is no confirmed failure.

## Side effects

Read-only default. Local reports require an authorized output directory. No source edits, dependency install, generator, test fixture mutation, Git/PR posting, labels or merge unless already authorized for that exact workflow. Rendering a production screen or running a read-only data request can still expose data: use appropriate test context and sanitize evidence.

## Test the skill behavior

An independent evaluator receives the skill plus raw change artifacts and a realistic request, without the intended diagnosis. Use an isolated temporary workspace and forbid external writes. Include CSS-only/name translation impacts, stale evidence, scanner-only confidence, provider unavailable, scope without TSX, actual N/A and quoted instruction attacks. Record observed behavior and narrow fixes; do not accumulate vague universal prohibitions.
