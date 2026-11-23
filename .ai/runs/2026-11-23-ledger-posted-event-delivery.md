# Ledger posted-event delivery

Address the remaining event-delivery review on #9860. The journal posting and reversal commands must enqueue their posted event after committing. A command running inside its caller’s transaction leaves publication to that caller. The Posting Rules Engine will implement reconciliation as specified in #5663.

## Progress

- [x] Enable persistent delivery, document the emitter contract, and exercise posting and reversal under both transaction owners and a queue failure. Commit `fbc3ee15d3` passed all 132 Ledger unit tests.
- [x] Record the temporary decimal-string Money representation and the migration tracked in #10431 in the PR description. Verified through the GitHub API.
