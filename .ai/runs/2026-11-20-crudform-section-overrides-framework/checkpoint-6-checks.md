# Checkpoint 6 — Generated authoring and scoped storage

Runner: local. Verified Steps 5.1–5.6 (`231f803e33` through `40389cd644`) with `main` synced into the feature branch at `81dc72582e`.

| Check | Result |
| --- | --- |
| `yarn install --immutable`, `yarn build:packages`, `yarn generate`, `yarn typecheck` | Passed |
| `yarn check:client-boundaries`, `yarn template:sync`, `git diff --check` | Passed, including the boundary advisory report |
| Shared package tests | 3,618 passed and 35 skipped |
| UI package tests | 3,179 passed |
| CLI package tests | 2,693 passed |
| Standalone compatibility and instruction budget tests | 15 passed on the synced base |
| Published authoring snippet, docs build, and source links | Passed |

Generated and hand-written inputs produced identical policy fingerprints and field projections from the same test fixture. The focused coverage also verified semantic revision increments, mandatory refinement handling, both façade field rule passes, scoped credentials, table version locking, undo, worker retry, and masked policies. The generic external adapter tests used the local fake.

`PW_CAPTURE_SCREENSHOTS=1 TMPDIR=/tmp gtimeout 900 yarn test:integration:ephemeral TC-EXAMPLE-011` passed all three tests on `81dc72582e`. It verified the existing Todo create/edit fields, refusal of stale API updates and deletes, and a visible browser conflict during a stale edit. The [attached screenshots](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7043660572) show the post-test Todo list. These are the existing Todo form controls. The configured showcase and persisted failure fixture are in Phase 6.
