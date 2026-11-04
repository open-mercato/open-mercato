# Bearer-authenticated staff logout

## Goal
Revoke the staff session authenticated by a bearer JWT when logging out without cookies.

Source identity: GHSA-fgj7-295f-f5pr
Source fingerprint: packages/core/src/modules/auth/api/logout.ts cookie-only access-token selection

## Scope
Reuse the existing verified JWT sid revocation path with the same bearer-before-cookie token selection as staff authentication. Preserve refresh-cookie revocation, redirects, cookie cleanup and anonymous behavior. Add unit and self-contained integration regression coverage. No schema, token-format, ACL, dependency, advisory-state or issue changes.

## Implementation Plan
### Phase 1: Fix and regression coverage
1.1 Reproduce bearer-only revocation failure, select bearer credentials consistently and add coverage.
### Phase 2: Verification and review
2.1 Run ordered configured validation, targeted regressions and applicable lint; document limitations.
2.2 Obtain independent review, record evidence and finalize the existing draft PR.

## Risks
Auth/session changes require careful mixed-credential precedence. Native dependency builds emitted existing optional build warnings during immutable installation. Keep the PR draft if verification is incomplete.

## Advisory triage
Verified main: 66f0e39dbc28dcc4f29f3320af06db286f91208b. Authenticated paginated API returned 23 repository advisories. Independent history scan covered 4,895 PRs through PR1. Fifteen findings have fixing code on main; attachment-owner finding GHSA-w32x-583w-gx4c has existing PR7989 and is skipped. Highest unresolved GHSA-2hrh-c89p-42qv requires a compatible shared-server-key delegation design and is blocked under architecture/contract approval rules. GHSA-9mqj-q2h7-8279 and GHSA-429h-x9x8-rv2m require contract decisions; no speculative breaking fixes. Other unresolved findings remain deferred: trace values GHSA-xch5-xj47-xcxm, scope-cookie identity GHSA-6729-5rxh-qg37, pending confirmation race GHSA-4cj8-2g3g-p4m3 (overlaps open AI policy work PR7794). This run selects one focused auth remediation group. No issues created or advisories changed.

## Progress
PR: #8719

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression coverage
- [x] 1.1 Reproduce bearer-only revocation failure, select bearer credentials consistently and add coverage. — 997a58f03e

### Phase 2: Verification and review
- [ ] 2.1 Run ordered configured validation, targeted regressions and applicable lint; document limitations.
- [ ] 2.2 Obtain independent review, record evidence and finalize the existing draft PR.
