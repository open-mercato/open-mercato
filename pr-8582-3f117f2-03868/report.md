## 📸 Exact-head runtime QA — PASS

**QA head:** `3f117f2d911eca91243c41739685b1f2c16e2637`

All six fixes and the requested live production CLI gap passed. This is automated complex runtime evidence, **not manual human QA, technical acceptance or QA approval**. No source changes or commits on the reviewed branch, no merge and no QA signoff labels.

Environment: `om-prepare-test-env` managed disposable production app/PostgreSQL; local runner; Playwright 1.61.1 Chromium. Cold authenticated readiness and warm reuse passed. Local build/generate/rebuild ran only as provisioning prerequisites; exact published CI supplied the broad gate.

| Check | Observed | Evidence |
|---|---|---|
| Exact-head CI | 31 successful / 4 skipped checks; CI43887848984 includes all 15 shards and merged coverage; guard/mutation green; head stable | [ci-checks-final.json](ci-checks-final.json) |
| Live production auth setup | Weak primary with no alias and each of four bypass aliases: exit 2, unchanged user/tenant/organization counts. Compliant primary: exit 0, login 200 | [cli-results.json](cli-results.json) |
| Derived/demo CLI credentials | Non-production explicit weak bypass: exit 0, login 200. Weak explicit derived overrides rejected in both modes without writes. Compliant derived overrides authenticate. Both generated derived passwords satisfy min-length 32 and authenticate | [cli-results.json](cli-results.json) |
| Production init additional DB | Five missing/placeholder/weak/bypass cases: exit 1 before any tables. Compliant bootstrap: exit 0; all three min-length-32 credentials match persisted hashes. Additional DB removed | [init-results.json](init-results.json) |
| Native credential regression | 11/11 passed, including ten immediate reset/login/fresh-profile-200/old-profile-401 cycles; customer_accounts module; managed CLI | [native-password.log](native-password.log) |
| Native profile regression | 1/1 passed at 320/390/768/1440px; portal module; managed CLI | [native-profile.log](native-profile.log) |
| EN/PL admin weakreset and retry | Localized 400; editable retry; double-click refusal; whole record unchanged; Escape/reopen; Ctrl+Enter 200; settled ten seconds | [browser-core.log](browser-core.log); [reset-pl-weak.png](reset-pl-weak.png) |
| Empty profile EN/PL | Zero roles/features; long email/name, badge and real dates fit at all four widths after ten seconds; post-settle assertions | [browser-empty-final.log](browser-empty-final.log); [profile-pl-empty-320.png](profile-pl-empty-320.png) |
| Populated profile EN/PL | Fresh API precondition: one role/three features. Localized headings, long email/name, badge and real dates fit at all four widths after ten seconds | [browser-profile-permissions-final.log](browser-profile-permissions-final.log); [profile-pl-320.png](profile-pl-320.png) |
| Signup EN/PL | Weak 400 shows policy guidance rather than false minimum-eight message; editable compliant retry 202; captured verification 200 and login 200 | [public-pl-results.json](public-pl-results.json); [signup-pl-weak.png](signup-pl-weak.png) |
| Invitation EN/PL | Real captured token: weak 400 policy guidance; same-token compliant retry 201 and login 200; invalid-token control localized 400 | [public-pl-results.json](public-pl-results.json); [invite-pl-weak.png](invite-pl-weak.png) |
| Reset-confirm EN/PL | Real captured token: weak 400 policy guidance; same-token compliant retry 200; invalid-token control localized 400 | [public-pl-results.json](public-pl-results.json); [resetPassword-pl-weak.png](resetPassword-pl-weak.png) |
| View-only staff | Detail read 200; reset/reset-link/revoke/dialog hidden with active sessions; all three direct mutations 403; whole record unchanged | [staff-direct-negatives.json](staff-direct-negatives.json); [staff-view.png](staff-view.png) |
| Manager controls | Exact, module-wildcard and global-wildcard grants retain reset/reset-link/revoke; wildcard actors open and Escape the dialog | [browser-profile-permissions-final.log](browser-profile-permissions-final.log); [manager-global-wildcard.png](manager-global-wildcard.png) |
| Isolation and selfchange | Owned tenant-B detail/reset 404; wrong-owner revoke 404; weak self-change 400, valid change 200; old session 401, fresh session 200 | [session-selfchange-results.json](session-selfchange-results.json) |
| Twoactor stale write | Actor B saves with 200; actor A gets 409 twice; whole B record preserved after ten seconds | [stale-write-results.json](stale-write-results.json); [stale-write-conflict.png](stale-write-conflict.png) |
| Create/loading/error boundaries | Admin create: weak 400, compliant retry 201. Controlled delayed GET/loading and controlled 500/error render clearly | [browser-public-boundaries.log](browser-public-boundaries.log); [detail-error.png](detail-error.png) |
| Source scope and locales | Generic PortalCard is byte-identical to base8e819a2c; changed PortalStatRow has only the profile consumer; three min-w-0 props are profile-only; values present in all five locales | [source-consumer-proof.txt](source-consumer-proof.txt) |
| Cleanup | Owned runtime processes/containers gone; additional DB removed; private environment/fixtures/traces removed; source clean; port closed | [teardown-proof.json](teardown-proof.json) |


### Scope, limits and QA setup corrections

- Evidence-only automated complex runtime QA; no manual human QA, technical acceptance or qa-approved signoff.
- Init bootstrap in the additional DB was verified through actual CLI exit/persisted hashes, not HTTP authentication against that second DB. Actual auth setup primary and derived credentials authenticated against the managed production app.
- No real SMTP used; invitation/reset/verification tokens were captured by the managed test transport and removed with private runtime files.
- Public/selfchange/isolation direct refusals partly use API; browser flows explicitly listed were exercised.
- Generic PortalCard consumers in staff/workflow/warranty use the unchanged implementation; they are outside changed-component coverage, not waived modified code.
- Initial CLI count comparison overlapped fixture creation; serialized rerun replaced it. One transport failure was rerun using closed connections.
- Initial populated profile attempts did not satisfy fixture preconditions (one role/zero effective features); an initial fresh fixture also selected an invitation role with no grants. Final fresh fixture used the intended role before first login; API precondition of one role/three features and final EN/PL browser assertions passed.
- Money, stock, decimal amounts and balance reversal rules are inapplicable: the reviewed diff has no corresponding mutation or rendering changes.

### Evidence integrity and teardown

45 PNGs passed chunk CRC, pixel-stream inflation, positive dimensions and nonuniform pixel-data checks; SHA256/dimensions are in `screenshot-manifest.json`. Representative EN/PL policy, profile, invalid-token, permission and conflict images were visually inspected. The final repeated-stale screenshot was reverified.

Owned CLI/app/launcher processes are gone, app port closed, disposable session containers removed, additional init DB dropped, and all fixture records removed with their disposable database. Private environment/fixture/token files and browser traces were deleted. Runtime email capture was restored and `git status --porcelain` is empty. Own claim release is recorded separately after evidence publication; the pre-existing pkarw assignment is preserved.

PR: #8582 (link: https://github.com/open-mercato/open-mercato/pull/8582)
