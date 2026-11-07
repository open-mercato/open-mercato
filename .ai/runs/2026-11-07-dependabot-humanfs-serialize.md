# Patch HumanFS and JavaScript serialization dependencies

## Goal
Remove Dependabot 310 (GHSA-p498-v437-472g) and 485 (GHSA-m5mm-p8h7-m29v) from the installed Yarn graph.

## Scope
One coupled dependency group: root manifest, shared yarn.lock and focused synthetic security regressions. Upgrade HumanFS within ESLint's existing ^0.16.6 range and the existing serialize-javascript pin to 7.1.3. Both releases exceed five days. No new override or dependency. No modules, API, schema or workflow changes.

## Implementation Plan
### Phase 1: Dependency remediation
1.1 Add exploit and ordinary-use regressions; demonstrate baseline failure.
1.2 Generate minimal compatible dependency updates and verify target removal.
### Phase 2: Verification and review
2.1 Run ordered configured gate and applicable resolution/lint checks; request ci-full for integration.
2.2 Independent review and PR evidence; retain draft when verification incomplete.

## Risks
/tmp is quota-exhausted; use /var/tmp/om-06e3151a. Existing claimed PRs 8971,8946,8857,8809,8778,8747 cover 15 source alerts. Skip their claims. Blocked groups: 508 deepmerge has no patch; 413 KaTeX patched version exceeds Mermaid range; 541 glob and 543 minimatch require incompatible major/parent upgrades, requiring maintainer approval under AGENTS.md. No issues, merges, alerts dismissed, settings/workflows changed or advisories published. No finding is declared fixed on main by a PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependency remediation

- [ ] 1.1 Add exploit and ordinary-use regressions; demonstrate baseline failure
- [ ] 1.2 Generate minimal compatible dependency updates and verify target removal

### Phase 2: Verification and review

- [ ] 2.1 Run ordered configured gate and applicable resolution/lint checks
- [ ] 2.2 Independent review and PR evidence
