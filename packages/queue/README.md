# @open-mercato/queue 📬

Flexible job queue runtime for local and distributed execution.

`@open-mercato/queue` provides a unified queue API with strategy support (local or BullMQ), worker contracts, and scalable background processing.

## Why this package ✨

- ⚙️ One API, multiple queue backends
- 🚀 Built for async workloads and retries
- 🧩 Worker-first design with explicit concurrency
- 🔒 Great fit for idempotent business jobs
- 🔁 Job deduplication that coalesces bursts without losing the last trigger

## Deduplication 🔁

Jobs that recompute something from current state — aggregates, standings, cached projections,
realtime broadcasts — should run once per burst rather than once per trigger. Pass a
`deduplication.id` keyed on the entity being recomputed, and repeated enqueues collapse into the
job already outstanding for that key:

```typescript
await queue.enqueue({ stageId }, {
  deduplication: { id: `stage-standings:${stageId}`, keepLastIfActive: true },
})
```

Set `keepLastIfActive: true` for anything of that shape. Without it, deduplication lasts only until
the job *finishes*: a trigger arriving mid-run is dropped, and the running job completes on input
that predates it, leaving the result stale. With it, that trigger is parked and exactly one more run
follows the current one, carrying the latest payload. Both strategies implement it — the async one
through BullMQ, the local one on its file-backed store — so development behaves like production.

## Install

```bash
yarn add @open-mercato/queue
```

## Learn more

- GitHub (package): https://github.com/open-mercato/open-mercato/tree/main/packages/queue
- GitHub (project): https://github.com/open-mercato/open-mercato
- Docs: https://docs.openmercato.com

## License

MIT
