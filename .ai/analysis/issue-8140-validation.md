# #8140 validation and review evidence

Implementation PR: https://github.com/open-mercato/open-mercato/pull/8689
Design-only spec PR: https://github.com/open-mercato/open-mercato/pull/8688
Runner: local. Tests/builds/hooks use a short, private, task-specific macOS TMPDIR/TMP/TEMP; no dependencies were added.

## Regression proof
Running the configured-send test against the baseline send handler failed with expected30 / received14 for an omitted duration; explicit7 remained unchanged. With the implementation, the existing quote-send/accept and validUntil-suggestion suites passed31 tests.

Exact focused command (from repository root):
```sh
yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath \
  packages/core/src/modules/sales/lib/__tests__/quoteValidity.test.ts \
  packages/core/src/modules/sales/commands/__tests__/settings.quote-validity.test.ts \
  packages/core/src/modules/sales/commands/__tests__/settings.document-number-gate.test.ts \
  packages/core/src/modules/sales/api/settings/quote-validity/__tests__/route.test.ts \
  packages/core/src/modules/sales/components/documents/__tests__/useQuoteSendDefaults.test.tsx \
  packages/core/src/modules/sales/api/__tests__/quotes.acceptance.test.ts \
  'packages/core/src/modules/sales/backend/sales/documents/[id]/__tests__/resolveDefaultValidForDays.test.ts'
```
Author and independent reviewer each ran the7-suite version:81 passed. After review fixes and additional cases, the reviewer reran the3 changed route/command/send suites:44 passed. Those include explicit null/0/366 rejections without settings reads, writes or email, and rejected-selector GET/PUT with no read/guard/command.

## Independent review
Spec scope/readiness: GO. Source: provisionally approve, no outstanding major/blocker source findings. Broad validation and live QA remain separate pending gates. Two review findings were corrected: supply updatedAt when initializing settings through an ORM upsert; reject organizationScope.selectionRejected before falling back to auth.orgId. First writes use insert-on-conflict-ignore then reload under a pessimistic row lock; version check and update share the transaction.

## Preparation checks
| Command | Result | Limit |
|---|---|---|
| yarn build:packages | PASS42 tasks,62.0s | Before final source refinements |
| yarn generate | PASS104.9s | Before final refinements |
| yarn build:packages | PASS42 tasks,29.3s | Before final refinements |
| yarn i18n:check-sync | PASS10.2s | Also passed every native pre-commit hook |
| yarn db:generate | PASS | Generated only intended sales column; unrelated forms/wms output removed; own snapshot limited to intended column under AGENTS exception |
| node scripts/check-client-boundaries.mjs --json | PASS | Advisory baseline findings retained; no new client root conversion |
| git diff --check | PASS | Scoped source changes |
| Native Chromium doctor | PASS | Playwright1.61.1 / Chromium149.0.7827.55 |
| yarn i18n:check-usage | INTERRUPTED | Stopped on parent shared-host allocation; not a pass |
| yarn typecheck; yarn test; yarn build:app | NOT RUN | Await parent heavy allocation |
| Native integration/API/UI suite | NOT RUN | Eight self-contained scenarios authored; owned runtime allocation pending |
| Playwright discovery; global DS health | TIMED OUT120s | Host contention; not passes |

No database migration has been applied. The generated migration only adds sales_settings.default_quote_validity_days integer NOT NULL DEFAULT14; rollback removes that column. No shared UI, customer, document, staff, audit, governance or lesson-index source changed. The draft must remain in progress until the final gate and live proof finish.
