# CrudForm section overrides framework handoff

Branch: feat/crudform-section-overrides-framework  
PR: https://github.com/open-mercato/open-mercato/pull/10067

## What just happened

The server phase is complete through local sinks, derived routes, and external outbox delivery. Four review steps covered ambient effects, scoped undo and hard delete, preservation of original CRUD hooks, and durable outbox recovery. Step 3.1 added the typed opt-in form attributes and validation/projector interfaces.

## Next concrete action

Finish 3.2. Use the server configured-host ledger to gate editing, verify the generated runtime contribution and alternative before mounting, and cover pending/failed/stale states plus the no-policy path. Steps 3.3 and 3.4 will add payload composition and bound writes.

## Showcase wiring notes

The derived Todo adapter needs the named original makeCrudRoute object, its real command schema and fixtures, explicit command delete mode, and the same original method features. Its original API interceptor and synchronous events still run, so the policy-enabled Todo shape must normalize the existing before-create subscriber output without introducing an inactive write.

Use the same outbox mirror adapter and deliver callback for create and update, with a single versioned delivery contract. The demo mirror includes delivery integration and contract IDs, durable failure reports, and the next failure reporting time. Generate and verify those columns when the actual entity lands.
