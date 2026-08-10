# Raise npmMinimalAgeGate from 1d to 14d

- Date: 2026-08-09
- Category: security
- Priority signal: medium — proactive hardening; no active incident, but the gap is real and the fix is cheap
- Risk signal: low — one-line config change in `.yarnrc.yml` + template sync
- Routing: Next: om-auto-create-pr "Raise npmMinimalAgeGate to 14d — brief: .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md"

## Problem

Open Mercato's dependency pipeline uses Yarn's `npmMinimalAgeGate` (default 1d) to quarantine
freshly-published npm packages. One day is too short — most supply-chain incidents from 2025/2026
(compromised maintainer accounts publishing malicious patches) had advisories published within
3–14 days. Raising the gate to 14 days closes this window for all install paths (developer
`yarn add`, CI, Dependabot) without any custom CI workflow.

## Agreed direction

Set `npmMinimalAgeGate: 14d` in `.yarnrc.yml` and the create-app template. The existing
`npmPreapprovedPackages: ["@open-mercato/*"]` stays as the bypass for first-party packages
consumed immediately after publishing.

**Rejected alternatives:**
- **Custom CI workflow** — a GitHub Actions workflow checking npm publish dates on Dependabot PRs.
  Rejected: Yarn's built-in gate already covers all install paths with better fail-closed behavior,
  per-package bypass via `npmPreapprovedPackages`, and no new failure modes.
- **Switch to Renovate** — native `minimumReleaseAge`, but the migration blast radius is not
  justified when Yarn already has the feature.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Cooldown duration? | 14 days |
| Scope? | All install paths (Yarn-level, not CI-gate) |
| Bypass mechanism? | `npmPreapprovedPackages` (already configured for `@open-mercato/*`) |
| Implementation? | One-line `.yarnrc.yml` change + template sync |

## Non-goals

- Custom CI workflow for publish-age checking
- Migrating from Dependabot to Renovate
- Replacing the daily `yarn npm audit` workflow

## Affected areas

- `.yarnrc.yml` — add `npmMinimalAgeGate: 14d`
- `packages/create-app/template/.yarnrc.yml.template` — same change for scaffolded apps
