# Checkpoint 4 — CrudForm section composition and writes

Validation runner: local. Browser runner: managed ephemeral application with isolated PostgreSQL and Chromium.

Verified steps 3.2, 3.3, 3.4, and 3.2-review-fix from `6d7ec417bb` through `9df7e6ab6d`. The checkpoint head `51e36458c5` includes the base sync to `c0dab1c596`.

| Check | Result |
| --- | --- |
| `yarn install --immutable`, `yarn build:packages`, `yarn generate`, `yarn typecheck` | Pass |
| `yarn check:client-boundaries`, `yarn template:sync`, `git diff --check` | Pass |
| `yarn workspace @open-mercato/ui test --runInBand` | 3,155 passed across 344 suites |
| `yarn workspace @open-mercato/shared test --runInBand` | 3,603 passed and 35 skipped |
| Focused CLI generator and Core resolver tests | 22 and 10 passed in Step 3.4 |
| Focused bootstrap tests for registration failure | 5 passed in the readiness fix |

The configured form gates rendering on the server and current scoped browser facts. Tests exercised organization switching with a late response, loading failure, hidden-field and custom-field ownership, payload collisions, and overlapping parent and child requests. The configured path has isolated group preferences. Baseline forms retain their existing ordering, API calls, and request-header behavior.

`PW_CAPTURE_SCREENSHOTS=1 TMPDIR=/tmp gtimeout 900 yarn test:integration:ephemeral TC-EXAMPLE-001` passed both existing Todo browser scenarios. It verified optional field preservation and clearing, label rehydration and replacement, and successful saves. See the [two in-app screenshots](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7039635598). The tests exercised the existing Todo path. The configured showcase browser cases are scheduled for Phase 6.
