---
title: "Durable enqueue under row locks must not await inline subscribers"
modules: ["customers", "events", "shared"]
areas: ["module-data", "architecture", "testing"]
topics: ["events", "concurrency", "row-locking", "queues"]
---

# Durable enqueue under row locks must not await inline subscribers

**Context**: The deferred Deal-merge worker must enqueue moved-record events before releasing row locks to preserve publication order.

**Problem**: The ordinary persistent event-bus call awaited process-local subscribers before enqueue. A subscriber that opened its own transaction and updated the same row waited for the worker's lock while the worker waited for the subscriber, producing a deadlock.

**Rule**: When durable enqueue must occur inside a row-lock window, make that phase queue-only and defer all process-local subscribers, taps and broadcasts until after commit. Replay only ephemeral delivery after commit, without another enqueue or persistent subscriber dispatch. Cover the boundary with the real event bus and assert that the subscriber starts only after commit.

**Applies to**: Workers that intentionally enqueue persistent events while holding database locks to serialize publication with competing writers.
