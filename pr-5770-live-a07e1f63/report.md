## 📸 API/browser QA evidence — PASS

QA head: e8923204ed712796435b84663218c00453f01b29

Fresh production build; real Chromium protected-API checks, using only owned fixtures.

| Step | Action | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| 1 | Read protected users API with a live ordinary role | HTTP200 for the live role positive control | HTTP200; isolated marker returns no real user records | PASS |
| 2 | Read protected users API with an unused key after only its role is deleted | HTTP403 and no effective feature grant despite the still-live ACL | HTTP403; API-key principal identity verified; feature-check returned ok:false/granted:[] | PASS |
| 3 | Read protected users API with a live super-admin role | HTTP200 for the live role positive control | HTTP200; isolated marker returns no real user records | PASS |
| 4 | Read protected users API with an unused key after only its role is deleted | HTTP403 and no effective feature grant despite the still-live ACL | HTTP403; API-key principal identity verified; feature-check returned ok:false/granted:[] | PASS |

Backend authorization change: verified the closest observable protected API in a real Chromium browser; no fresh staff form interaction is claimed.

Each API-key browser context is cookie-free. Unused keys prove fresh reads, not eviction of previously cached authority. Existing cache TTL/invalidations remain unchanged.

Only owned roles were soft-deleted; their ACLs deliberately remained live. All key/role fixtures were cleaned and role absence verified.

Separate native tests cover live-vs-revoked ACL role-grant refusal/success.

Evidence only; no independent review, QA approval or merge granted.

Four native security-boundary cases passed at this published head through the repository CLI: revoked-weaker/live-stronger denial; revoked-stronger/live-permitted success; and fresh ordinary/super-admin keys refused after deleting only their role while its ACL remained live. Original source fix passed149 core +64 shared tests and core/shared typechecks; runtime is unchanged by the later test-only password correction. Native fixture code also typechecked.

## Native failure analysis and correction

| Failing test | Evidence | Diagnosis / owner | Correction |
| --- | --- | --- | --- |
| ACL-LIVE-GRANT weaker-history | Runner stack and retry network400 response, sanitized error: password does not meet requirements | Agent/QA: fixture setup failed before the grant assertion | Random password now includes required upper/lower/digit/symbol classes |
| ACL-LIVE-GRANT stronger-history | Same independent setup failure on both attempts | Agent/QA: fixture password policy, not an authorization result | Same compliant random generator; status and side-effect assertions unchanged |

Both deleted-role key scenarios passed. Independent live grant probes using compliant fixture passwords passed403 denial and201 permitted creation, with cleanup. No product policy, authorization assertion, per-test timeout/retry or check was weakened. Final exact-head native re-run passed all four cases.
