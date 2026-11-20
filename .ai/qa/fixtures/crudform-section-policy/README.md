# CrudForm section policy fixture

This test-only module stays outside the app's enabled modules. Copy `src/modules/form_policy_fixture` into a disposable standalone app and enable `{ id: 'form_policy_fixture', from: '@app' }` in that app's module list before generation. The package tests use the same source for server manifest construction and the browser's lazy runtime descriptors.

- `/backend/form-policy-fixture/showcase` composes a display-only addition, a hide with recorded coverage, and a replacement that retains the required name. The route renders the fixture without persistence.
- `/backend/form-policy-fixture/c3` configures a hidden required leaf with no coverage. Bootstrap retains the configured host in the ledger and refuses the policy.
- The package tests vary the same declarations to cover duplicate leaves, duplicate custom fields, incorrect capabilities, and exact definition-set matching for both `ids` and `all`.

This fixture uses static identities and an in-memory preserved value in the manifest tests. Section write targets describe those tests. Phase 6 owns a persisted disposable app, API-created test records, and the C3 Playwright case.
