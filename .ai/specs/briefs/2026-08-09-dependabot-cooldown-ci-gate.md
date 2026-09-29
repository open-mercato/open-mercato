# Raise npmMinimalAgeGate from 1d to 5d

- Date: 2026-08-09
- Category: security
- Priority signal: medium — proactive hardening; no active incident, but the gap is real and the fix is cheap
- Risk signal: low — one config value in `.yarnrc.yml` + template sync
- Routing: Next: om-auto-create-pr "Raise npmMinimalAgeGate to 5d — brief: .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md"

## Problem

Open Mercato's dependency pipeline already quarantines freshly-published npm packages through
Yarn's `npmMinimalAgeGate`, but only at its default of one day (`.yarnrc.yml`, landed in #4644
together with `scripts/ci/npm-retry-on-quarantine.sh` and
`scripts/__tests__/npm-minimal-age-gate.test.mjs`).

One day is too short. The attack this gate defends against is a compromised maintainer account
publishing a malicious patch release; the defence works only if the quarantine outlasts the time
the ecosystem needs to notice and unpublish. Recent incidents were caught quickly, but several took
longer than 24 hours:

| Incident | Vector | Time to detection |
|----------|--------|-------------------|
| @lottiefiles/lottie-player (2024) | Compromised npm token, crypto-drainer | ~hours |
| Solana web3.js (2024) | Compromised maintainer account, wallet backdoor | ~5 hours |
| gulp-debugbar (2025) | Reverse shell in postinstall | ~1–2 days |
| rand-user-agent (2025) | Hijacked package, RAT via postinstall | ~2 days |
| ethers.js typosquats (2025) | Typosquat packages stealing private keys | ~days |

A gate of one day covers only the fastest of these. Raising it closes the window for every install
path at once — developer `yarn add`, CI, Dependabot — without a custom CI workflow.

## Agreed direction

Set `npmMinimalAgeGate: 5d` in `.yarnrc.yml` and in
`packages/create-app/template/.yarnrc.yml.template`, so scaffolded apps inherit the same protection
instead of silently keeping the 1d default. The existing
`npmPreapprovedPackages: ["@open-mercato/*"]` stays untouched as the bypass for first-party packages,
which are consumed minutes after publishing.

**Why 5 days, and not 14 or 3.** The first draft of this brief proposed 14 days. Review pushed back:
a two-week gate delays legitimate security patches and pushes every urgent upgrade through a
`npmPreapprovedPackages` entry that someone then has to remember to remove, which is a worse failure
mode than the one being fixed. The reviewer put the reasonable range at 3–7 days and suggested 3d,
reasoning that `main` already sits behind a 3-day code freeze before releases. Five days sits inside
that range: it covers every incident in the table above with margin, while staying short enough that
a genuinely urgent third-party patch is reachable within a work week.

For the rare patch that cannot wait, the escape hatch is per-call rather than persistent:
`yarn add pkg@version --no-time-gate`. It is explicit, it shows up in the diff, and it leaves no
standing exception behind to clean up — which is the specific objection raised against relying on
`npmPreapprovedPackages` for urgent upgrades.

**Rejected alternatives:**
- **Custom CI workflow** — a GitHub Actions workflow checking npm publish dates on Dependabot PRs.
  Rejected: Yarn's built-in gate already covers all install paths with better fail-closed behavior,
  per-package bypass via `npmPreapprovedPackages`, and no new failure modes.
- **Switch to Renovate** — native `minimumReleaseAge`, but the migration blast radius is not
  justified when Yarn already has the feature.

## Resolved unknowns

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| Cooldown duration? | 5 days — inside the 3–7 day range agreed in review, with margin over the longest detection time on record |
| Scope? | All install paths (Yarn-level, not CI-gate) |
| Bypass for first-party packages? | `npmPreapprovedPackages` (already configured for `@open-mercato/*`) |
| Bypass for an urgent third-party patch? | `yarn add pkg@version --no-time-gate`, per call — no standing exception to clean up |
| Effect on existing installs? | None. The gate fires during resolution, not on `yarn install --immutable`; versions already pinned in `yarn.lock` are not re-checked |
| Implementation? | One config value in `.yarnrc.yml` + the same value in the create-app template |

## Non-goals

- Custom CI workflow for publish-age checking
- Migrating from Dependabot to Renovate
- Replacing the daily `yarn npm audit` workflow

## Known follow-up

`.github/dependabot.yml` declares no `cooldown`, so Dependabot may still propose a version younger
than the gate; the resulting PR fails `yarn install` with `YN0016 … quarantined` until the version
ages past 5 days. Aligning a Dependabot `cooldown` with this gate is tracked separately so that this
change stays a config-only diff.

## Affected areas

- `.yarnrc.yml` — add `npmMinimalAgeGate: 5d`
- `packages/create-app/template/.yarnrc.yml.template` — same value for scaffolded apps
