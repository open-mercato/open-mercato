# Audit dependency advisories on release branches

## Goal

Report npm advisories for main and the v0.9 and v0.10 maintenance branches on the existing schedule. Keep high and critical advisories as the blocking threshold and report moderate and low results in the workflow summary.

## Implementation plan

1. Extend the current audit script to report below-threshold matches without making them blocking or changing the existing PR audit.
2. Use the workflow revision's audit script against each target lockfile. Exercise representative release graphs and validate the GitHub workflow.
3. Record verification and send the PR for maintainer acceptance.

## Risks

The existing job opens tracking issues when its high-severity gate fails. Keep its issue behavior and avoid installing release dependencies in a job with issue-write permission.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Branch coverage and verification

- [ ] 1.1 Add optional reporting below the failure threshold
- [ ] 1.2 Audit the release graphs on the existing schedule
- [ ] 1.3 Verify workflow and report results
