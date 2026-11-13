import { canonicalValue, encodeRowDigestFrame, keyedDigest, rowDigestDomainPrefix, rowIdentity, type VerificationRow } from './canonical'
import { RowHmacWorker } from './row-hmac-worker'

type RowControl = {
  identity: string
  fields: number
  bytes: number
  metadataDigest: string
  intent?: { before: string; after: string; mac: string; actualMac: string }
}
export type FingerprintedRow = RowControl & { digest: string }
type PendingRow = { control: RowControl; frame: ArrayBuffer }
const BATCH_BYTES = 2 * 1024 * 1024

/** One in-flight batch, one producer batch, and at most one <=1MiB current row. */
export async function* fingerprintRows(source: AsyncIterable<VerificationRow> | ((signal: AbortSignal) => AsyncIterable<VerificationRow>), runKey: Buffer, signal?: AbortSignal): AsyncGenerator<FingerprintedRow> {
  const cancellation = new AbortController()
  const cancelProducer = () => cancellation.abort()
  const producerSignal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal
  let worker: RowHmacWorker | undefined
  let iterator: AsyncIterator<VerificationRow> | undefined
  let current: PendingRow | undefined
  let producer: PendingRow[] = []
  let submitted: PendingRow[] = []
  let inFlight: Promise<FingerprintedRow[]> | undefined
  let ended = false
  const emptyMetadataDigest = keyedDigest(runKey, 'metadata-v1', canonicalValue({}))
  const interrupted = () => { if (signal?.aborted) throw new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE') }
  const wipe = (rows: PendingRow[]) => { for (const row of rows) { if (row.frame.byteLength) new Uint8Array(row.frame).fill(0) } }
  const build = async (): Promise<PendingRow[]> => {
    producer = []
    let bytes = 0
    while (producer.length < 500 && !ended) {
      interrupted()
      if (!current) {
        const next = await iterator!.next()
        interrupted()
        if (next.done) { ended = true; break }
        const encoded = encodeRowDigestFrame(next.value)
        try {
          const identity = rowIdentity(next.value)
          const intent = next.value.metadataIntent
          current = { frame: encoded.frame, control: {
            identity, fields: next.value.columns.length, bytes: encoded.bytes,
            metadataDigest: next.value.metadata === undefined ? emptyMetadataDigest : keyedDigest(runKey, 'metadata-v1', canonicalValue(next.value.metadata ?? {})),
            ...(intent ? { intent: {
              before: keyedDigest(runKey, 'metadata-v1', canonicalValue(intent.before)),
              after: keyedDigest(runKey, 'metadata-v1', canonicalValue(intent.after)), mac: intent.mac,
              actualMac: keyedDigest(runKey, 'metadata-intent-v1', canonicalValue([identity, intent.before, intent.after])),
            } } : {}),
          } }
        } catch (error) {
          new Uint8Array(encoded.frame).fill(0)
          throw error
        }
      }
      if (producer.length && bytes + current.control.bytes > BATCH_BYTES) break
      bytes += current.control.bytes
      producer.push(current)
      current = undefined
    }
    return producer
  }
  const submit = (batch: PendingRow[]): Promise<FingerprintedRow[]> => {
    const controls = batch.map(row => row.control)
    submitted = batch
    const task = worker!.digestBatch(batch.map(row => row.frame)).then(digests => {
      if (digests.length !== controls.length) throw new Error('[internal] ROTATION_HMAC_WORKER_FAILED')
      return controls.map((control, index) => ({ ...control, digest: digests[index]! }))
    }).finally(() => { wipe(batch); if (submitted === batch) submitted = [] })
    producer = []
    // Rejection must remain observable even while the producer awaits SQL.
    void task.catch(() => cancellation.abort())
    return task
  }
  try {
    interrupted()
    iterator = (typeof source === 'function' ? source(producerSignal) : source)[Symbol.asyncIterator]()
    for (;;) {
      const batch = await build()
      if (!batch.length) break
      const previous = inFlight ? await inFlight : undefined
      interrupted()
      if (!worker) {
        worker = new RowHmacWorker(runKey, rowDigestDomainPrefix(), signal)
        worker.failureSignal.addEventListener('abort', cancelProducer, { once: true })
        if (worker.failureSignal.aborted) cancelProducer()
      }
      inFlight = submit(batch)
      if (previous) for (const row of previous) { interrupted(); yield row }
    }
    if (inFlight) for (const row of await inFlight) { interrupted(); yield row }
  } finally {
    cancellation.abort()
    worker?.failureSignal.removeEventListener('abort', cancelProducer)
    wipe(producer)
    if (current) wipe([current])
    // A consumer mismatch can stop while the next bounded batch is hashing.
    // Join it before requesting the worker's normal zeroize/exit handshake.
    if (inFlight) await inFlight.catch(() => undefined)
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => iterator?.return?.()),
      Promise.resolve().then(() => worker?.close()),
    ])
    wipe(submitted)
    const failure = outcomes.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE')
  }
}
