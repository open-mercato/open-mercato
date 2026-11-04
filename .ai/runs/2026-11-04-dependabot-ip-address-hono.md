# Remediate Hono and ip-address Dependabot alerts

## Goal

Remove vulnerable Hono and ip-address resolutions with minimal same-major updates; keep the PR draft for independent parent review.

## Scope

Only root `package.json`, generated `yarn.lock`, and this plan. No source, workflows, issues, advisory changes, readiness, merges, settings, or age-gate changes. Base: `66f0e39dbc28dcc4f29f3320af06db286f91208b` (latest main at selection).

## Evidence and selection

Authenticated `gh api --paginate --slurp` returned 42 open alerts (one page), and all PR history returned 49 pages / 4,893 PRs (352 open, 3,506 merged). Compared package/GHSA/manifest identities against all open/merged titles/bodies and inspected root manifest/lock patches in all 23 open PRs touching them; none remediates these selected versions/identities. Prior security pins in merged #4930/#5085 fix older advisories, while main still resolves the vulnerable versions. All prior security-issue tasks are settled; concurrent advisory automation only has read-only triage. Refreshed open PRs before initial publication.

Highest advisory score is ip-address 6.9 (SSRF classification); Hono reaches 6.5 (cross-request disclosure/path traversal). Both groups share the lockfile and ship together.

Parent-first assessment: MCP SDK is already the latest eligible 1.32.2 and accepts Hono `^4.11.4`. Its parent upgrade cannot override the existing forced Hono 4.12.25 resolution. ip-address parents are socks 2.8.7/2.8.9 and express-rate-limit 8.3.1. Newer parents still cannot override the existing forced 10.4.0 pin; changing those parents would add unrelated churn. Update the existing two same-major security pins; introduce no new override. Existing express-rate-limit exact ip-address 10.1.0 request already receives 10.4.0 through this pin; retain that pre-existing override relationship.

Five-day gate: ip-address 10.7.5 published 2026-10-25T01:32:24.393Z; Hono 4.13.14 published 2026-10-25T07:19:30.732Z. ip-address 10.7.6 is too young (2026-11-03); do not select it. Preserve pinned Yarn 4.17.1 with integrity and `.yarnrc.yml` 5d gate.

## Stable source identities

| Alert | Package | GHSA | Manifest | Before | After |
| --- | --- | --- | --- | --- | --- |
| 468 | ip-address | GHSA-rxp7-6hxx-x8q5 | yarn.lock | 10.4.0 | 10.7.5 |
| 434 | hono | GHSA-5r4p-p66f-jhc7 | yarn.lock | 4.12.25 | 4.13.14 |
| 397 | ip-address | GHSA-h3mg-xc3c-68pw | yarn.lock | 10.4.0 | 10.7.5 |
| 396 | ip-address | GHSA-rpw4-54j3-4h4q | yarn.lock | 10.4.0 | 10.7.5 |
| 394 | hono | GHSA-hxh3-vqpv-xpqv | yarn.lock | 4.12.25 | 4.13.14 |
| 389 | ip-address | GHSA-j6r3-76f7-8jcv | yarn.lock | 10.4.0 | 10.7.5 |
| 354 | ip-address | GHSA-2vr4-cq9g-pvrc | yarn.lock | 10.4.0 | 10.7.5 |
| 321 | hono | GHSA-g6gw-c38x-mqfc | yarn.lock | 4.12.25 | 4.13.14 |
| 320 | hono | GHSA-crvj-82cr-hjcx | yarn.lock | 4.12.25 | 4.13.14 |
| 319 | hono | GHSA-gqvv-2mrq-wpjv | yarn.lock | 4.12.25 | 4.13.14 |
| 294 | hono | GHSA-f23p-vx2j-j53r | yarn.lock | 4.12.25 | 4.13.14 |
| 293 | hono | GHSA-79qm-7rj5-m7r9 | yarn.lock | 4.12.25 | 4.13.14 |
| 292 | hono | GHSA-54fx-42gc-7vw4 | yarn.lock | 4.12.25 | 4.13.14 |
| 280 | hono | GHSA-8j4g-w8fx-2239 | yarn.lock | 4.12.25 | 4.13.14 |
| 235 | hono | GHSA-hvrm-45r6-mjfj | yarn.lock | 4.12.25 | 4.13.14 |
| 234 | hono | GHSA-w62v-xxxg-mg59 | yarn.lock | 4.12.25 | 4.13.14 |
| 233 | hono | GHSA-xgm2-5f3f-mvvc | yarn.lock | 4.12.25 | 4.13.14 |

## Implementation plan

1. Commit this plan and immediately push a dedicated branch/open a draft PR with source markers.
2. Update the two existing pins and regenerate the lockfile using pinned Yarn; inspect the diff and prove all target vulnerable resolutions are absent.
3. Run the ordered validation gate using local runner, resolution/lint checks and security probes. Request `ci-full` for explicit integration coverage. Refresh alerts/PRs/claims before final push; report exact evidence and leave draft for parent independent review.

## Risks and validation

Runner: local. Both compose probes found no running app (fullapp probe lacks JWT_SECRET). Fresh worktree has no node_modules. Dependency install/build availability may block the gate; record each command result without calling missing coverage passed. No public contract or DB change intended. Keep draft regardless of results.

Ordered gate: `yarn build:packages`; `yarn generate`; `yarn build:packages`; `yarn i18n:check-sync`; `yarn i18n:check-usage`; `yarn typecheck`; `yarn test`; `yarn build:app`. Additional: `yarn check:resolutions`, `yarn lint`, immutable install and before/after resolution assertions/security probes. CI integration requested through existing `ci-full` label; no workflow edits.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Publish plan

- [ ] 1.1 Commit plan and open draft PR

### Phase 2: Remediate dependencies

- [ ] 2.1 Regenerate minimal patched dependency resolutions

### Phase 3: Validate and hand off

- [ ] 3.1 Record ordered validation and vulnerability-removal evidence

Status: in-progress
