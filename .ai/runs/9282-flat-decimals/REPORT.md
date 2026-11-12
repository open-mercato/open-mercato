# Issue 9282 — localized flat price-rule amounts

Status: implementation and browser regression verified locally; publication of follow-up blocked by foreign QA claim. Full financial QA approval remains outstanding.

Both create and edit normalize typed net/gross through `parseLocaleNumber` and then the existing catalog amount validator. Canonical API/database validators, loaded record normalization and optimistic-lock wiring are unchanged. Invalid fields are refused before mutation with translated errors in en/pl/de/es/ko. Zero and single dot/comma decimal input remain supported.

Runner: local. No compose app running; production compose probe cannot interpolate missing JWT_SECRET. Existing dependency tree reused through a local ignored node_modules symlink. No source/dependency/config changes outside catalog.

## Verification

- `timeout 120 node node_modules/jest/bin/jest.js --config packages/core/jest.config.cjs --runInBand --runTestsByPath packages/core/src/modules/catalog/components/prices/__tests__/priceFormAmounts.test.ts packages/core/src/modules/catalog/components/prices/__tests__/pricePages.test.tsx packages/core/src/modules/catalog/data/__tests__/validators.prices.test.ts packages/core/src/modules/catalog/commands/__tests__/prices.update.test.ts`: **4 suites, 41 tests passed**. Includes 16 parsing/refusal cases, 2 real page submit-handler cases and 23 existing canonical validator/command tests.
- Existing prices API suite retry after generation: **1 suite, 1 test passed** (`--runTestsByPath packages/core/src/modules/catalog/api/__tests__/prices.route.test.ts`).
- Before-fix proof: temporarily running the new page suite against original HEAD pages: **2 tests failed** (raw comma payload); restored fixed pages and reran green.
- Full configured gate attempted in order: first `yarn build:packages` passed (42/42); `yarn generate` passed; second build initially hit concurrent output-directory cleanup (`ENOTEMPTY`), then sequential retry passed (42/42).
- `yarn i18n:check-sync` and `yarn i18n:check-usage`: initial cezar TMPDIR exceeded macOS IPC socket path limits (`listen EINVAL`). Retried with `TMPDIR=/tmp`: **both passed**, after sorting added locale keys. Usage reports existing advisory unused keys.
- `yarn typecheck`: failed on seven errors outside catalog (customer_accounts missing shared SSE module; customer_groups/warranty_claims injection icon properties; customers disabled prop; staff combobox disabled prop). No errors reported for changed catalog paths.
- `yarn test`: failed in documents (6 failed suites; missing generated entity IDs and other existing document UI failures); turbo stopped remaining work. Targeted catalog suites above passed.
- `yarn build:app`: failed before rendering because Turbopack refuses a node_modules symlink outside its filesystem root.
- `timeout 300 yarn test:integration:ephemeral TC-CAT-PRICES-004`: fixtures/bootstrap and package builds completed; production app build failed on the same node_modules symlink boundary. Browser tests never launched. No screenshots or personal financial QA obtained. Self-contained pl/en browser regression is included but **unexecuted**: create/edit/save/reload, malformed/negative preservation, dot/comma/zero/repeated saves and stale-edit 409.
- `TMPDIR=/tmp yarn template:sync`: passed. `TMPDIR=/tmp yarn check:client-boundaries`: passed (report only). `git diff --check`: passed.

## Review limits and next action

Static review checked form-only parsing, canonical amount bounds, existing CrudForm version propagation and no mutation on invalid inputs. No API/schema/ACL/tenant/price-resolution contract changes. Full gate is not green; verdict cannot be approval. Maintainer/parent must rerun full validation with a worktree-local dependency installation and resolve baseline failures, then run pinned browser/personal financial QA before merge. No base merge, force-push or qa-approved label is authorized/performed.

PR: https://github.com/open-mercato/open-mercato/pull/9339
Issue: https://github.com/open-mercato/open-mercato/issues/9282

Formal GitHub request-changes review was refused because the authenticated reviewer is the PR author. Review was published as a comment, with changes-requested and needs-qa retained. No independent review or QA approval is claimed. CI pending at inspection; no further CI monitoring promised.

## Parent verification follow-up

The parent installed worktree-local dependencies with `TMPDIR=/tmp timeout 180 yarn install --immutable`, removing the prior Turbopack symlink blocker. The repository-native production app now builds and starts successfully.

Browser test corrections: explicitly focus/open comboboxes; select the price-kind fixture from its unfiltered list; supply explicit 23.04% tax so net 12.50 derives gross 15.38 under the unchanged four-place server calculation; use matching repeat-save amounts; accept canonical trailing zeros on reload. No production behavior changed in this follow-up.

- `TMPDIR=/tmp timeout 420 yarn test:integration:ephemeral TC-CAT-PRICES-004`: **2 passed**, Polish 5.8s / English 4.3s, no retry failures. Production build passed in 75s; complete managed run exited 0 in 240s. Includes create/edit/reload, invalid record preservation, comma/dot/zero/repeated saves and stale-write 409.
- Independently repeated focused Jest: **4 suites / 41 tests passed**.
- `TMPDIR=/tmp timeout 180 yarn typecheck`: **42/42 tasks passed** with local dependencies and regenerated registries.
- Earlier PR CI: 271 integration tests passed; the two new browser cases failed due to the now-corrected test setup/assertions. A fresh CI run is required after publishing this commit.
- Independent production QA on the previous PR head separately confirms parser refusals, canonical monetary magnitudes, stale-write conflicts and tenant/RBAC isolation. Its full financial matrix is incomplete and it flagged the preserved canonical-dot Polish display as an existing gap; no financial/QA approval is claimed.

PR 9339 currently has a foreign atomic QA claim owned by open-mercato-maintenance[bot], run e1ab2880-8f5f-463a-856f-e4e61746b6de. Parent will not push over that claim or remove it. Follow-up is committed locally for publication when the owner releases the lock.
