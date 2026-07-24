# Workflow Design

Load for definitions, steps, tasks, triggers, and compensation.

1. Define one start, reachable terminal paths, valid step transitions, input/context/output schema, and explicit failure/cancel behavior.
2. Use user tasks for human decisions, wait/signal/timer for pauses, and async activities for durable long work.
3. Add event triggers with filters/context mapping/debounce/max concurrency; exclude self/internal event storms.
4. Give user tasks assignee/role/features, due date/SLA, authorized completion, and no secrets in payload.
5. Define compensation in reverse dependency order and make both forward/compensating actions idempotent.
6. Preserve immutable event history for every state transition.

Test all branches, invalid transition/signal, duplicate trigger, deadline/cancel, and compensation failure.
