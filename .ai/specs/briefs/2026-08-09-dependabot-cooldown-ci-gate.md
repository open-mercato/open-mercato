# Add 14-day publish-age CI gate for Dependabot PRs

- Date: 2026-08-09
- Category: security
- Priority signal: medium — proactive hardening; no active incident, but the gap is real and the fix is cheap
- Risk signal: low — single new workflow file + one label; no code changes, no dependency changes
- Routing: Next: om-prepare-issue "Add 14-day publish-age CI gate for Dependabot PRs — brief: .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md"

## Problem

Open Mercato's dependency pipeline has no quarantine against freshly-published npm packages. Dependabot opens update PRs immediately after a new version is published. The daily `yarn npm audit` workflow catches known advisories reactively, but there is a zero-day window where a malicious version (compromised maintainer account publishing a poisoned patch, typosquat) could be proposed and merged before any advisory exists. A 14-day cooldown would close this window for the automated update channel — the primary high-volume path for new dependency versions entering the repo.

## Agreed direction

Add a GitHub Actions workflow that triggers on Dependabot PRs and checks the npm registry publish date of every bumped package version. If any version is younger than 14 days, the check fails and the PR cannot merge until the cooldown expires.

A `skip-cooldown` label (maintainer-only) bypasses the gate for urgent security patches where the fix version is itself younger than 14 days.

**Rejected alternatives:**
- **Switch to Renovate** — native `minimumReleaseAge` support, but the migration blast radius is not justified for this single feature.
- **`.npmrc` `minReleaseAge` globally** — would block manual `yarn add` during development; user wants the gate scoped to the automated channel only.
- **Build nothing** — the existing daily audit is reactive-only; the zero-day window between publication and first advisory remains open.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Cooldown duration? | 14 days |
| Scope? | Dependabot PRs only (not manual installs or feature PRs) |
| Bypass mechanism? | `skip-cooldown` label applied by a maintainer |
| Dependabot or Renovate? | Keep Dependabot; CI gate workflow approach |

## Non-goals

- Migrating from Dependabot to Renovate
- Gating manual `yarn add` or non-Dependabot PRs (noted as future improvement — see below)
- Replacing the daily `yarn npm audit` workflow
- Blocking PRs that only update `resolutions`/`overrides` without changing direct dependency versions

## Future improvement (out of scope for v1)

Extend the CI gate to trigger on *any* PR that modifies `yarn.lock`, not just Dependabot PRs. This would close the gap where a developer manually adds a freshly-published package in a feature PR. Same `skip-cooldown` bypass applies. The implementation difference is minimal (trigger condition change), but the policy decision and team buy-in are separate.

## Affected areas (if known)

- `.github/workflows/` — new workflow file (e.g., `dependency-cooldown.yml`)
- `.github/dependabot.yml` — no changes needed, but the workflow keys off Dependabot's actor/label
- Repository label set — new `skip-cooldown` label
