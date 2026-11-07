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
| Native integration/API/UI suite | Latest CI:6 PASS /2 failed | Eight scenarios selected atc6ff; date representation and manual input interaction corrections await rerun; owned local runtime allocation pending |
| Playwright discovery; global DS health | TIMED OUT120s | Host contention; not passes |

No database migration has been applied locally. The generated migration only adds sales_settings.default_quote_validity_days integer NOT NULL DEFAULT14; rollback removes that column. No shared UI, customer, document, staff, audit, governance or lesson-index source changed. The draft must remain in progress until the final gate and live proof finish.

## CI loading-state follow-up
CI on9dda08898a failed its prepare/Build app step with TS2741: the new settings section omitted the required LoadingMessage.label prop. This is an in-scope compile failure, not an infrastructure exception. The loading state now supplies a translated label in all five sales locales. A component regression uses the real shared LoadingMessage during a pending settings request: FAIL before the fix, PASS after. Exact focused invocation: `yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath packages/core/src/modules/sales/components/__tests__/QuoteValiditySettings.test.tsx`. Fresh CI atfea517d9c0 passed prepare, including build/generate/rebuild/app build. The remaining local configured gate is pending; parent resource allocation has not been granted.

## CI date-fixture follow-up
CI41857254484 passed prepare/lint/DS checks but its test job stopped before unit tests at `yarn check:time-bombs:fail`: two absolute future literals in the new pure-helper test were flagged HIGH. The helper tests now derive past/current/future inputs from one runtime anchor frozen for each test, retaining the fallback, rounding and cap assertions. The file-scoped scanner reproduced two HIGH findings before the change and reports zero after. Author and independent reviewer each ran `yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath packages/core/src/modules/sales/lib/__tests__/quoteValidity.test.ts`: one suite/26 tests passed; independent narrow review approves. No allowlist or scanner policy changed. Full local validation and the eight live cases remain pending.

## Core contract follow-up
The earlier CI core-timezone job reported four failing suites (six tests): the new synchronous optimistic-lock call lacked a record-lock decision, exact registration lists missed the new command, quote send forked its mutation context before guard approval, and the structural HTTP-mapping guard could not trace the route's existing local error helper.

The settings command now awaits the existing DI-aware `enforceCommandOptimisticLockWithGuards` seam: the OSS version floor runs first, then an optional registered record-lock guard can reject before changing or flushing the settings row. No allowlist exemption is added. Quote send reads an omitted default through the scoped request manager and creates its mutation fork only after registry approval. Guards still see the configured duration. Both route catch clauses explicitly invoke the interceptor mapper while the shared local error response helper preserves the original status/body behavior. Exact registration lists include the added command.

The author and independent reviewer each passed the focused seven-suite command below:73 tests (12.254s and58.086s respectively). Independent source review approves the bounded contract follow-up. It retains all four contract assertions and adds coverage for optional lock rejection before write, 422/423 interceptor response bodies, and configured omitted-duration sends rejected before a fork or email.
```sh
yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath \
  packages/core/src/__tests__/optimistic-lock-command-coverage.test.ts \
  packages/core/src/__tests__/command-interceptor-http-coverage.test.ts \
  packages/core/src/modules/sales/commands/__tests__/registration.test.ts \
  packages/core/src/__tests__/custom-write-mutation-guard-routes.test.ts \
  packages/core/src/modules/sales/commands/__tests__/settings.quote-validity.test.ts \
  packages/core/src/modules/sales/api/settings/quote-validity/__tests__/route.test.ts \
  packages/core/src/modules/sales/api/__tests__/quotes.acceptance.test.ts
```
Only the existing custom-write contract test needed expansion; the other core coverage guards are unchanged. Full local validation and live scenarios remain pending.

## Native CI integration follow-up
At2c644, CI selected all eight feature scenarios. The four API cases passed: settings persistence/validation/stale versions, organization isolation/concurrent first writes/rejected selector, omitted send fallback, and explicit send override. The four UI cases timed out twice; the job totals were317 passed,4 failed,5 skipped. This is a failed integration gate.

Browser artifacts show the settings value30 in the Quote validity region as a textbox: the shared locale-aware numeric field renders a text input. The configuration scenario now scopes its textbox to that unique region. The send scenarios open the existing hover-aware Actions menu through its supported Enter-key interaction, assert expanded state, then select Send to customer. Existing field values, API persistence, reloading, cancel-without-write, manual duration, and Ctrl+Enter assertions remain intact. No product code, shared UI, timeout, retries, configuration or disabled-test flags changed. Independent read-only review confirms the real snapshots/shared-component behavior and approves these navigation-only corrections. No local tests or runtime checks were launched. A native rerun is required before any UI pass is claimed; the local full gate and live verification are still pending allocation.

## Future-date fixture correction
The55fb native rerun passed seven of eight feature cases, including configuration save/reload, configured-default/cancel, and manual duration with Ctrl+Enter. The remaining future-date case received30 instead of5; its real browser GET returned validUntil:null. The test had attempted to set that date through the generic quote update route, whose actual documentUpdateSchema excludes it. Quote creation supports validUntil.

Fixtures now create the recipient and optional date through POST /api/sales/quotes, with transport retries disabled and status/id checks. Each dialog case asserts the stored validUntil equals its intended date/null before opening. The5-day expectation and cancel-without-write assertion remain unchanged. This corrects setup through an existing supported API; no product code or public update contract changed. Successful settings45 and default-dialog30 screenshots were visually inspected. Independent read-only review confirmed both create/update contracts and approves the fixture correction; no local test/runtime run was performed. The full eight-case pass remains pending a fresh native run.

## Date representation and manual keyboard follow-up
The c6ff native run41881319426 passed six of eight feature cases. All other CI jobs passed. The future-date fixture now stores the intended date, but its precondition compared ISO text to the equivalent PostgreSQL timestamp representation. The fixture reader now canonicalizes non-null dates before equality checks; it still verifies the intended instant before opening and after cancel. No API response format changed.

The manual case failed both attempts after Playwright fill returned successfully: the trace snapshot immediately before Ctrl+Enter still showed30, and the request also carried30. There was only one defaults request, and no evidence of a submit closure ignoring a visible7. The scenario now replaces the selected input using actual keyboard events and asserts7 before submitting. Request duration7 and persisted7-day validity assertions remain intact. This exercises manual editing without relying on a fill operation that did not change this number input in the failed run. No product source, waits, retries, configuration or test exclusions changed. Native execution remains required before claiming either correction passed. Sanitized failed-run evidence is retained in the task evidence directory; raw traces remain private.
