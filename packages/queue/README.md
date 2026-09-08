# @open-mercato/queue 📬

Flexible job queue runtime for local and distributed execution.

`@open-mercato/queue` provides a unified queue API with strategy support (local or BullMQ), worker contracts, and scalable background processing.

## Why this package ✨

- ⚙️ One API, multiple queue backends
- 🚀 Built for async workloads and retries
- 🧩 Worker-first design with explicit concurrency
- 🔒 Great fit for idempotent business jobs
- 🔁 Coalescing that collapses bursts without losing the last trigger

## Coalescing 🔁

A job that recomputes something from current state — an aggregate, a projection, a realtime
broadcast — does not need to run once per trigger. It needs to run once per *burst*, on the latest
state. Give the enqueue a key and repeated triggers collapse into the job already outstanding for it:

```typescript
await queue.enqueue({ stageId }, { coalesce: { key: `stage-standings:${stageId}` } })
```

Ten triggers in a minute then produce at most two runs instead of ten — and none of them is lost.
Triggers arriving while a job for the key is merely *waiting* need no run of their own, because that
job has not read anything yet. Triggers arriving while it is *running* are parked, and exactly one
follow-up run starts when it finishes, carrying the latest payload.

Declare the key once on the queue and no call site can forget it:

```typescript
const queue = createModuleQueue<StandingsJob>('standings', {
  coalesceBy: (payload) => `stage-standings:${payload.stageId}`,
})
```

Both strategies implement this — the async one through BullMQ, the local one on its file-backed
store — so development behaves like production.

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
