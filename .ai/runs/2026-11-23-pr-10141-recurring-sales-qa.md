# Execution plan for recurring Sales QA (adopted from PR #10141)

Adopted on 2026-11-23 from PR #10141 by @pkarw against `main`.

## Goal

Resolve the remaining reproducible QA findings in the Sales flows exercised by the recurring quotes and orders pull request.

## Scope

Verify the recurring dialog keyboard behavior on the current code. Correct the saved-line editor’s Polish decimal display and verify an unchanged save preserves quantity, price, and totals.

## Non-goals

Personal Sales QA approval is a reviewer action. Broader shared Select and Dialog behavior remains tracked in #9810.

## Evidence

| Conclusion | Evidence |
| --- | --- |
| Phase 1 covers the recurrence schedule on quotes and orders. | [Recurring sales spec](../specs/2026-10-21-sales-recurring-orders.md) |
| Initial focus and Escape behavior were repaired in the schedule dialog. | [Current source review and TC-SALES-052 result](https://github.com/open-mercato/open-mercato/pull/10141#issuecomment-7072399691) |
| Saved prices and quantities reopened with dot decimals in Polish. | [QA report, case 18](https://github.com/open-mercato/open-mercato/pull/10141#issuecomment-7055444480) and [#10297](https://github.com/open-mercato/open-mercato/issues/10297) |
| Personal Sales QA was requested on the final head. | [Maintainer request](https://github.com/open-mercato/open-mercato/pull/10141#issuecomment-7100273369) |

## Assumptions

The request to fix the failing QA includes case 18, the open Sales line editor finding from the QA run. Keep the fix in the Sales editor and reuse the shared decimal formatter.

## Risks

Prices can contain more digits than JavaScript numbers preserve. Verify that reopening and saving an unchanged line retains the existing exact-price write path.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR

- [x] 1.1 Implement recurring quotes and orders and address the recurrence dialog keyboard failures — 85b7944a93

### Phase 2: Final Sales QA repairs

- [ ] 2.1 Redisplay saved Sales line prices and quantities in the selected locale and cover round-trip precision
- [ ] 2.2 Verify the recurring Sales flows and review the final head
