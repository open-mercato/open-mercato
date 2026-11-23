# Ledger posted-event delivery

Address the remaining event-delivery review on #9860. The journal posting and reversal commands must enqueue their posted event after committing. A command running inside its caller’s transaction leaves publication to that caller. The Posting Rules Engine will implement reconciliation as specified in #5663.

## Progress

- [ ] Enable persistent delivery, document the emitter contract, and exercise posting and reversal under both transaction owners and a queue failure.
- [ ] Record the temporary decimal-string Money representation and the migration tracked in #10431 in the PR description.
