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

- [ ] 2.1 Restore relation labels and search and update integration coverage for scoped writes and soft deletion
- [ ] 2.2 Verify the full gate, review the final diff, and record exact-head CI evidence
