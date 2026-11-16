## 📸 Exact-head automated complex runtime QA — PASS (runtime PASS)

**QA head:** `dce185804f05cb482e73353d8d751add8c43c80d` (final base `1766b080b2`).

All six fixes, native12tests, liveCLI11cases and controls passed on fresh owned fixtures. This is **not manual human QA, technical acceptance or QA approval**. Previous-head evidence was used as a recipe only.

| Check | Expected and observed | Evidence |
|---|---|---|
| Exact-head CI | Every reported check completed successfully or skipped; all15integration shards and merged coverage; Guard/Mutation green; stable dce1858 | [ci-checks-final.json](ci-checks-final.json) |
| Live production CLI primary | Weak primary default+all4skip aliases exit2; no user/tenant/org count changes. Compliant primary exit0/login200 | [cli-results.json](cli-results.json) |
| Live CLI derived credentials | Explicit nonproduction bypass exit0/login200; weak derived overrides refused in both modes/no writes; compliant derived logins200; strict32 generated derived both comply/login200 | [cli-results.json](cli-results.json) |
| Native credential regression | 11passed; ten immediate reset/login fresh200/old401 cases; customer_accounts module, managed CLI | [native-password.log](native-password.log) |
| Native profile regression | 1passed at320/390/768/1440; portal module, managed CLI | [native-profile.log](native-profile.log) |
| Admin reset EN/PL | Weak400localized/editable/doubleclick; whole record unchanged; Escape/reopen/CtrlEnter200; ten-second settle | [browser-core.log](browser-core.log); [reset-pl-weak.png](reset-pl-weak.png) |
| Empty profile EN/PL | 0roles/0features; long email/name, verifiedbadge, realdates fit at320/390/768/1440 after10sec | [browser-core.log](browser-core.log); [profile-pl-empty-320.png](profile-pl-empty-320.png) |
| Populated profile EN/PL | 1role/3features API precondition; localized counts and long values/badge/dates fit at4widths after10sec; corrected final run2passed | [browser-profile-final.log](browser-profile-final.log); [profile-pl-320.png](profile-pl-320.png) |
| Signup EN/PL | Weak400policy guidance, no false minimum8 or expired message; compliant retry202, captured verification200 and login200 | [public-pl-results.json](public-pl-results.json); [signup-pl-weak.png](signup-pl-weak.png) |
| Invitation EN/PL | Actual captured token:weak400policy guidance; same-token retry201/login200; invalidtoken localized400 | [public-pl-results.json](public-pl-results.json); [invite-pl-weak.png](invite-pl-weak.png) |
| Reset-confirm EN/PL | Actual captured token:weak400policy guidance; same-token retry200; invalidtoken localized400 | [public-pl-results.json](public-pl-results.json); [resetPassword-pl-invalid.png](resetPassword-pl-invalid.png) |
| View-only staff | Owned role has detailread200; reset/resetlink/revoke/dialog hidden; all3directwrites403; whole record unchanged | [staff-direct-negatives.json](staff-direct-negatives.json); [staff-view.png](staff-view.png) |
| Manager controls | Exact grants reset/resetlink positive; module*/global* reset/resetlink/revoke positive, dialog/Escape; final permission/stale/wildcards3passed | [browser-permissions-final.log](browser-permissions-final.log); [manager-global-wildcard.png](manager-global-wildcard.png) |
| Tenant/session ownership | Owned different tenant detail/reset404; wrong-owner session revoke404 | [tenantB-results.json](tenantB-results.json) |
| Self password change API | Weak400/whole record unchanged; compliant200; oldsession401/freshsession200 | [session-selfchange-results.json](session-selfchange-results.json) |
| Two actors stale write | ActorB200; ActorA409 twice; whole B record preserved after10seconds | [stale-write-results.json](stale-write-results.json); [stale-write-conflict.png](stale-write-conflict.png) |
| Create/loading/error | Admin createweak400/editable retry201; controlled delayed GET/loading and500/error boundaries | [browser-controls.log](browser-controls.log); [detail-error.png](detail-error.png) |
| Source consumers/locales | Generic PortalCard prefix byte-identical to final merged base1766b080b2; statrow profile-only; min-width props3profilecall sites; changedkeys in5locales | [source-consumer-proof.txt](source-consumer-proof.txt) |
| Evidence and teardown | 45PNGs verifiedCRC/inflation/dimensions/nonuniformpixels/SHA256; representative images visually reviewed; ownprocesses/DBgone,portclosed,privatefilesremoved,sourceclean | [teardown-proof.json](teardown-proof.json) |

### Limits and harness corrections

- Automated complex runtime evidence only: no manual human QA, personal technical acceptance or QA approval/signoff. Source read-only; no reviewed-branch commits, branch push or merge.
- Runner: local, om-prepare-test-env managed disposable production app/PostgreSQL; authenticated cold readiness and warm reuse passed. Build/install/generate/rebuild only as runtime provisioning prerequisites; hosted CI supplies the broad eight-gate sequence.
- Own fixtures used for permission, isolation, portal and stale-write checks. Native tests self-create/clean fixtures. UI changes exercised in browser; selfchange/isolation/direct refusals partly API, explicitly marked above.
- No real SMTP or credentials: managed test transport captured signup/invitation/reset links. Private runtime environment, fixture identities, token captures and traces removed; tracked capture/sample restored exactly to HEAD.
- Fresh harness corrections retained transparently: staff login form encoding; organization manage-view slug; module-scoped native rerun; mixed-case fixture email normalized to persisted lowercase; HTTP staff roles array corrected and refreshed, authorized reads200 verified before final negative/positive reruns; missing wrongowner displayName corrected. Initial core log has2fixture-locator failures, superseded by final profile2PASS. Initial controls log has2role-fixture failures, superseded by final permission/stale/wildcards3PASS.
- Additional init-database guard/bootstrap replay was optional (repeat if needed) and was not repeated. Previous-head init evidence is trusted context, not a current-head PASS claim. Current-head actual auth setup and generated-derived HTTP authentication were independently replayed.
- Unchanged generic PortalCard consumers in other modules are outside modified-component coverage; no obsolete nonempty-other-card gap is claimed. Money/stock/decimal/undo rules are inapplicable: no corresponding changed runtime surface.
- Responsive layout assertions cover the portal profile. Other staff-page styling and sticky full-page screenshot stitching are not a blanket responsive-layout approval.

45 fresh PNGs verified; SHA256/dimensions in [screenshot-manifest.json](screenshot-manifest.json). Representative localized policy/invalid-token, empty/populated narrow profile, permission and conflict images were visually inspected. Own producing claim is released after initial evidence publication while bounded CI watch continues; pre-existing pkarw assignment and driver ci-monitoring are preserved. No QA approval.

PR: #8582 (link: https://github.com/open-mercato/open-mercato/pull/8582)
