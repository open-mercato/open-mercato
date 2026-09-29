# Release Upgrade Companion Automation

## TLDR

Release preparation becomes a three-artifact contract: `CHANGELOG.md` selects the release version and date, a matching `UPGRADE_NOTES.md` window is finalized to those values, and a version-specific `om-auto-upgrade-<from>-to-<to>` skill must exist in both the monorepo and standalone agentic harness before the release PR can complete.

This extends the repo-local behavior of the external `om-auto-update-changelog` skill. It does not change runtime code or implement the `mercato upgrade` command proposed in [the related reconcile spec](2026-07-27-mercato-upgrade-reconcile-command.md).

## Overview

`UPGRADE_NOTES.md` is the downstream compatibility ledger. It can contain `(unreleased)` windows while a matching version is already present in `CHANGELOG.md`, and the one existing executable companion covers only `0.4.10 → 0.5.0`. Release preparation therefore does not prove that upgrade guidance has a discoverable, runnable path for standalone users.

The new contract makes the changelog workflow the release coordinator. Once it resolves a release version, date, and previous release, it finds the upgrade section starting at that previous version, finalizes its target/date, and requires a companion skill in both agent surfaces. Tests bind these artifacts together so future releases fail loudly on drift.

## Problem Statement

1. **Version drift is silent.** `CHANGELOG.md` may say `0.6.7 (2026-08-01)` while `UPGRADE_NOTES.md` still says `0.6.6 → 0.6.7 (unreleased)`.
2. **Guidance is not executable by default.** Downstream authors must manually translate prose into source edits and audits even when the transformation is mechanical.
3. **A monorepo-only skill does not reach customers.** Standalone apps install local skills from `packages/create-app/agentic/shared/ai/skills/`, so a release skill present only under `.ai/skills/` is unavailable where it is needed.
4. **The generic changelog skill intentionally edits one file.** Open Mercato needs a repo-specific extension rather than weakening the external skill's portable contract.

## Proposed Solution

### Release window matching

Given selected release `R`, release date `D`, and the changelog entry immediately below `R` with version `P`:

1. Parse `UPGRADE_NOTES.md` headings `## FROM → TO (date-or-unreleased)`.
2. Select the single section where `FROM == P`.
3. Normalize its heading to `## P → R (D)`.
4. Stop on multiple source matches or a duplicate target; do not guess.
5. If no source match exists, retain the external changelog-only behavior.

The same rule handles an amend run where `R` is already the top changelog entry. Dated historical windows and unrelated future windows are immutable.

### Companion skill generation

A matching section requires `om-auto-upgrade-P-to-R`. The section is converted into a complete action matrix:

| Classification | Meaning | Skill behavior |
| --- | --- | --- |
| Automatic | The edit is bounded, unambiguous, and idempotent | Detect, preview, edit minimally, verify |
| Detect and report | Search is reliable but intent is not | List exact files/lines and required decision |
| No code action | Runtime/operational awareness only | Explain the behavior change and validation step |

Even a window with no automatic edit receives a skill. Its value is version-specific routing, deterministic detection, and a complete human-review checklist.

### Distribution invariant

The monorepo file `.ai/skills/<skill>/SKILL.md` and standalone file `packages/create-app/agentic/shared/ai/skills/<skill>/SKILL.md` are byte-identical. Both `tiers.json` manifests list the skill in the opt-in `migration` tier. The release test resolves the latest changelog version and matching upgrade section, then verifies heading date alignment, both files, byte identity, frontmatter name, and tier membership.

### Current release

For `0.6.6 → 0.6.7`, the companion automates the deprecated `isUniqueViolation` import move and safe scheduler payload unwrapping. It detects and reports swallowed query-index callback errors and scheduler metadata dependencies that cannot be reconstructed mechanically.

## Architecture

No runtime component is added. The behavior lives in:

- `.ai/skills/om-auto-update-changelog/SKILL.md` — Open Mercato-specific release coordination override.
- `.ai/skills/om-auto-upgrade-0.6.6-to-0.6.7/SKILL.md` — monorepo migration owner.
- `packages/create-app/agentic/shared/ai/skills/...` — byte-identical standalone asset.
- Both tier manifests — opt-in installation and discovery.
- `packages/create-app/src/lib/release-upgrade-skill-contract.test.ts` — cross-artifact invariant.

The create-app generators already copy the entire agentic source tree recursively, so no generator source change is needed.

## Data Models

No database or application data model changes. The only parsed model is a release window:

```ts
type UpgradeWindow = {
  fromVersion: string
  toVersion: string
  releaseMarker: 'unreleased' | string
  body: string
}
```

It is documentation/test terminology, not a new exported runtime type.

## API Contracts

No HTTP, CLI, event, module, database, DI, ACL, or import-path contract changes. Skill names and tier membership are agentic distribution surfaces; this change is additive. The existing `om-auto-upgrade-0.4.10-to-0.5.0` remains available.

## Migration & Backward Compatibility

- The external `om-auto-update-changelog` behavior is unchanged for other repositories.
- Open Mercato adds a repo-local override under the extension point the external skill already reads.
- Releases without a matching upgrade-note section remain changelog-only.
- Existing migration skills are not renamed or removed.
- The current versioned skill is opt-in through the existing `migration` tier, so default prompt/context size is unchanged.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Wrong upgrade section is rewritten | High | Match exact previous changelog version; stop on ambiguity/duplicate target | Low |
| Generated codemod damages user code | High | Only bounded edits are automatic; preview first; idempotency; typecheck/tests; manual bucket for ambiguous cases | Low–Medium |
| Standalone copy drifts | Medium | Byte-identity regression test and recursive-copy existing contract | Low |
| Migration tier grows indefinitely | Low | Versioned skills remain opt-in; no default-tier addition | Low |
| Release PR broadens beyond intended files | Medium | Explicit allow-list in the repo-local override and normal PR review gate | Low |

Security-sensitive surfaces are not touched. Skills must not read credentials, edit dependencies automatically, or mutate framework-owned/generated/vendor directories.

## Test Coverage

No API or UI path changes, so integration/UI coverage is not applicable. Automated coverage verifies:

- the local changelog override contains exact-match, ambiguity, dry-run, dual-surface, and tier requirements;
- the top changelog release date matches the relevant upgrade-note heading;
- the derived companion skill exists in both locations and is byte-identical;
- both migration tiers include it;
- skill-tier manifests remain valid;
- the focused create-app package suite passes.

## Implementation Plan

1. Add the local changelog override and this specification.
2. Add cross-artifact release invariant tests.
3. Author the current release companion from `UPGRADE_NOTES.md`.
4. Mirror/register/document the skill and finalize release headings.
5. Run focused tests, the configured validation gate, and the automated review pass.

## Final Compliance Report

- [x] Minimal repo-local extension instead of modifying the shared generic skill.
- [x] No runtime or public application contract change.
- [x] Standalone availability is an explicit invariant.
- [x] Versioned skills remain opt-in.
- [x] No database/API/UI integration coverage required.
- [x] Implementation and validation complete.

## Changelog

- 2026-08-01 — Initial specification drafted from the release-upgrade automation request related to PR #4547.
