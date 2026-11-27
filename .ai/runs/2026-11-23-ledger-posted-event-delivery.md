# Ledger posted-event delivery

Address the remaining event-delivery review on #9860. The journal posting and reversal commands must enqueue their posted event after committing. A command running inside its caller’s transaction leaves publication to that caller. The Posting Rules Engine will implement reconciliation as specified in #5663.

## Progress

- [x] Enable persistent delivery, document the emitter contract, and exercise posting and reversal under both transaction owners and a queue failure. Commit `fbc3ee15d3` passed all 132 Ledger unit tests.
- [x] Record the temporary decimal-string Money representation and the migration tracked in #10431 in the PR description. Verified through the GitHub API.
- [x] Report failed queue publication with the committed entry and organization scope while preserving a successful command result. Reuse the resolved CRUD translator. Commit `b0acb4ea25` passed all 132 Ledger and 115 shared CRUD unit tests.
- [x] Measure real PostgreSQL statements on list, detail, scoped-filter and write routes. All four selected integration cases passed on the disposable production app. The PR description records the counts.
- [x] Display each posted line’s recorded currency ID, exact rate and original amount on journal detail. TC-GL-008 verifies both sides of a mixed-currency posting and reversal as a ledger-only viewer. TC-GL-005 and TC-GL-008 passed on a disposable production app with PostgreSQL, and all 133 Ledger unit tests passed.
- [x] Return the existing duplicate-number conflict when two account creates race at the scoped unique index. On the previous head TC-GL-006 reproduced 201 and 500 twice. With the fix, both requests passed their prechecks, returned 201 and 409 and left one account. All seven TC-GL-006 PostgreSQL cases and all 136 ledger unit tests passed.
