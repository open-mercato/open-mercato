---
title: "Enqueue then stamp"
modules: ["events"]
areas: ["testing"]
topics: ["events","workers"]
---

# Enqueue then stamp

**Context**: The warranty SLA sweep used a database timestamp to suppress duplicate at-risk and breach notifications, but wrote that timestamp before enqueueing the persistent event.

**Rule**: When a worker uses a durable stamp to deduplicate a persistent signal, enqueue the signal before committing the stamp unless both writes share one atomic transaction. A process can exit between any two separately durable operations; stamp-first ordering turns that crash window into permanent loss, while enqueue-first ordering degrades to retry-safe at-least-once delivery. Cover the event failure path by asserting the stamp remains untouched.

**Applies to**: scheduled sweeps, outbox-like notification producers, and any worker that records delivery intent separately from its durable queue or event write.
