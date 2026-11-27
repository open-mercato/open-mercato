# Execution plan — finish CRUD factory security and query correctness (PR #10157)

**Origin:** adopted from PR #10157 at `e644a80f18`.
**Branch:** `fix/crud-factory-security-bundle` · **Base:** `main`

## Goal

Repair the relation-picker regression and get the bundle through CI so the assigned QA reviewers can retest it.

## Scope and evidence

- [Manual QA](https://github.com/open-mercato/open-mercato/pull/10157#issuecomment-7070579237) found UUID labels and broken name search for products and portal users. It also identified outdated assertions in two CRM scenarios and the deleted-record scenario.
- [Previous CI](https://github.com/open-mercato/open-mercato/actions/runs/44774321692) failed the three integration scenarios and the telemetry child probe timed out in the unit job. Run the fresh suite on the merged head to distinguish new defects from transient failures.
- Resolve conflicts with current `main` while retaining scoped and decrypted customer command reads, translation checks, sort/filter rules, and cache isolation.

## Non-goals

Keep the existing human QA gate, named compatibility approvals, and merge decision with the assigned reviewers and maintainers.

## Assumptions

A portal user should show the display name declared by its module. The code fixes use the approved takeover of the previous in-progress marker. The assigned QA reviewers retain ownership of sign-off.

## Progress

### Phase 1: Adoption and base reconciliation

- [x] 1.1 Adopt the implemented CRUD factory security bundle — e644a80f18
- [x] 1.2 Resolve current main conflicts and preserve both branches' behavior — ba3c234bd

### Phase 2: QA and CI repair

- [x] 2.1 Restore relation labels and search and update integration coverage for scoped writes and soft deletion — 0bd65a0181
- [x] 2.2 Verify the full gate, review the final diff, and record exact-head CI evidence — 3ebcec6ea3

- [x] 2.3 Fix the hosted ComboboxInput autofocus regression and refresh main — 616eadaecf

- [x] 2.4 Register the cross-package ACL guard and fix the payment-menu focus race — b0ca30f483

## Verification

- The targeted ephemeral Playwright run passed 9 of 9 tests. It confirmed the corrected picker labels and search, the three reworked integration assertions, and the existing access controls.
- Review follow-ups preserve custom label aliases, refresh the hybrid query column map before using it, and give the merged lot-date test a scoped inventory grant. The grouped security exception fits the existing standalone compatibility budget.
- The local validation gate passed in order on Node 24.22.3, including all 51 unit-test tasks and the production app build. The exact-head GitHub Actions result is tracked on PR #10157.

- Hosted CI exposed a second suggestions request after autofocus. The timer-controlled regression fails before the fix and verifies that ArrowDown still loads suggestions after the fix. All 86 focused UI tests and the component design-system lint passed.

- The next main refresh kept both repeated AND predicates and grouped all-of filters. The focused shared filter and CRUD suites passed 328 checks.

- The next hosted run passed 14 integration shards. The last shard exposed a row-menu hover timer closing a keyboard-opened menu. The regression fails before the fix. The CI guard now registers the cross-package ACL audit. The UI suites and both repo-wide guard commands passed.
