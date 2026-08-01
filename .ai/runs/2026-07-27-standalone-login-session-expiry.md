# Fix standalone login session expiry

## Goal

Ensure a newly scaffolded standalone app accepts its newly issued staff session immediately after login instead of showing the session-expired notification.

## Scope

- Trace the post-login authentication probe shown in the report (`/api/auth/feature-check`).
- Add regression coverage that exercises the standalone scaffold's login/session hand-off.
- Make the smallest compatible fix in the shared auth or standalone template surface, and keep template counterparts aligned.

## Non-goals

- Change the session lifetime, JWT format, RBAC behavior, or session-revocation contract.
- Modify existing standalone apps outside the generated template.
- Change unrelated login, onboarding, or custom-domain flows.

## Risks

- Session validation is security-sensitive: the fix must preserve immediate revocation for deleted or expired sessions.
- Standalone scaffolds consume published packages, so coverage must exercise the generated-app path rather than only the monorepo route graph.
- The standalone Playwright smoke harness could not start because an unrelated `mercato-verdaccio` container already owns its fixed name; it was left untouched.
- GitHub does not permit the PR author to approve this PR, so an independent reviewer must submit the final approval before the run can complete.

## Implementation Plan

### Phase 1: Reproduce and cover the hand-off

1. Identify why the login response's new session fails the next authenticated feature-check request in a standalone scaffold.
2. Add focused regression coverage for successful post-login authentication in the generated standalone app path.

### Phase 2: Correct and verify

3. Implement the minimal fix, synchronize any affected standalone template file, and run targeted checks.
4. Run the full validation gate, complete the authoritative review pass, and prepare the PR for review.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproduce and cover the hand-off

- [x] 1.1 Identify why the login response's new session fails the next authenticated feature-check request in a standalone scaffold. — ed2db898d
- [x] 1.2 Add focused regression coverage for successful post-login authentication in the generated standalone app path. — ed2db898d

### Phase 2: Correct and verify

- [x] 2.1 Implement the minimal fix, synchronize any affected standalone template file, and run targeted checks. — ed2db898d
- [ ] 2.2 Run the full validation gate, complete the authoritative review pass, and prepare the PR for review.
