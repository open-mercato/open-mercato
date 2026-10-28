---
title: "Serialize deprovisioning with final session issuance"
modules: ["auth", "sso"]
areas: ["module-data", "testing"]
topics: ["security", "concurrency", "session-revocation", "tenant-isolation"]
---

# Serialize deprovisioning with final session issuance

The initial #7824 fix rejected an outstanding SCIM marker during account linking and password verification. Independent review found that a concurrent request could pass those checks, wait for SCIM to revoke sessions, then insert a new session. It also found a supported public configuration path that omits `tenantId`, producing null-tenant markers that exact user-tenant lookups missed.

Serialize final eligibility reads and session insertion with every deactivation writer using the same parent User row lock. Read fresh state and write the session through the transaction's entity manager while retaining the lock until commit. Cover POST `active:false` as well as PATCH and DELETE. A request that commits first must have its session revoked; a request that follows deactivation must be denied. Preserve existing lock order when rechecking eligibility inside role synchronization.

Trace optional scope fields from the public creation schema to persisted markers. For legacy null-tenant markers, prove organization ownership and the configuration's matching scope before applying them to an actual-tenant user. Do not make eligibility depend on the configuration remaining active or undeleted.

Use real database barriers to exercise both transaction orders. Inspect the whole request path when choosing a barrier: password login updates `lastLoginAt` before final issuance, so it can wait on an UPDATE rather than the later user-lock SELECT.

Evidence: `packages/enterprise/src/modules/sso/services/ssoAuthService.ts`; `services/scimService.ts`; `lib/deactivation.ts`; `__integration__/helpers/signInRevocationRace.ts`; `__integration__/api/TC-SSO-007-deactivation-login.spec.ts`; [PR #8088](https://github.com/open-mercato/open-mercato/pull/8088).
