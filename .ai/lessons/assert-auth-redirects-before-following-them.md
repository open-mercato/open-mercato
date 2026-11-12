---
title: "Assert auth redirect responses before following them"
modules: ["auth", "sso"]
areas: ["integration", "testing"]
topics: ["testing", "api-contracts", "redirects", "session-revocation"]
---

# Assert auth redirect responses before following them

The #7824 SCIM regression expected `GET /api/auth/session/refresh` to return 401 after revocation. That browser endpoint actually returns a 307 redirect to `/login` and clears staff cookies. Playwright followed the redirect, so the assertion observed the login page's 200 and failed before testing fresh password denial or reactivation.

Check the handler and its existing route tests before asserting authentication status codes. For browser endpoints, set `maxRedirects: 0` and assert the redirect status and destination. Verify the JSON API separately: `POST /api/auth/session/refresh` accepts `{ refreshToken }` and returns 401 for the revoked credential. A final response status after redirects does not establish whether the original endpoint accepted the credential.

Evidence: `packages/core/src/modules/auth/api/session/refresh.ts`; `packages/core/src/modules/auth/api/__tests__/session.refresh.test.ts`; `packages/enterprise/src/modules/sso/__integration__/api/TC-SSO-007-deactivation-login.spec.ts`; [CI job for PR #8088](https://github.com/open-mercato/open-mercato/actions/runs/40594390188/job/122511460353).
