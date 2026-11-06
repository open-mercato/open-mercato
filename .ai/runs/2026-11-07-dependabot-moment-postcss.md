# Patch Moment and PostCSS dependency vulnerabilities

## Goal
Remove installed vulnerable Moment and PostCSS versions for Dependabot alerts 378 and 284.

## Scope
One coupled dependency PR: both fixes modify the shared Yarn graph. Refresh Moment within existing parent ranges; update the existing PostCSS resolution without adding an override. Preserve five-day age gate and public contracts.

## Non-goals
No issues, alert dismissals, workflow/settings changes, new dependencies, major upgrades, merges or other remediation groups. Serialize485 and humanfs310 deferred by the two-group limit. Existing active PRs cover13 dependency alerts and both CodeQL occurrences. Blocked:543/minimatch and541/glob need incompatible parent upgrades;508/deepmerge has no patch;413/KaTeX needs a major parent whose release fails the age gate. Retry only after relevant upstream/code/authorization changes.

## Implementation plan
Phase1: prove baseline and patch compatible versions with focused security regression coverage.
Phase2: ordered validation, vulnerability-removal proof, dedup recheck and independent review; keep draft if incomplete.

## Risks
Dependency graph compatibility and existing baseline failures. No alert is fixed on main until merged and verified in a later run.

Source identities: dependabot:open-mercato/open-mercato:378 GHSA-4p3w-j4w9-5jqw npm:moment yarn.lock; dependabot:open-mercato/open-mercato:284 GHSA-fxqj-rqcc-2cmp npm:postcss yarn.lock.
Baseline main:620dfa185f340dddbd8cb0d20637e64040a27ef2. Authenticated paginated source APIs returned21 dependency and2 CodeQL alerts. Read-only triage independently checked active security automations and PRs; selected candidates unclaimed.
Engine: om-auto-create-pr (steps:4, --loop:no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Patch dependencies

- [ ] 1.1 Verify installed vulnerable paths and add regression coverage
- [ ] 1.2 Upgrade compatible dependencies and prove removal

### Phase 2: Verify and publish

- [ ] 2.1 Run ordered validation and record exact results
- [ ] 2.2 Recheck duplicates and obtain independent review
