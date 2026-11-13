import { ExactJsonNumber, canonicalValue, keyedDigest, keyedRowDigestAndSize, rowIdentity, type VerificationRow } from '../canonical'
import { fingerprintRows } from '../row-fingerprints'
import { RowHmacWorker } from '../row-hmac-worker'

const key = Buffer.alloc(32, 17)
const row = (index: number, payload = 'value'): VerificationRow => ({
  entity: 'public.records', tenantId: 'tenant', organizationId: null, identity: [String(index), 'part'],
  columns: [{ name: 'amount', type: 'numeric', value: new ExactJsonNumber('9007199254740993.00001') }, { name: 'payload', type: 'text', value: payload }],
  ...(index % 2 ? { metadata: { updated_at: '2026-01-01T00:00:00.123456Z' } } : {}),
})

test.each([['row count', 1201, 'small'], ['encoded bytes', 97, '日本語🙂'.repeat(6000)]])('bounded worker stream preserves every old fingerprint and metadata across %s boundaries', async (_name, count, payload) => {
  const beforeKey = Buffer.from(key)
  let produced = 0, consumed = 0, maximumAhead = 0, returned = false
  const sizes: Array<{ rows: number; bytes: number }> = []
  const original = RowHmacWorker.prototype.digestBatch
  const submit = jest.spyOn(RowHmacWorker.prototype, 'digestBatch').mockImplementation(function (this: RowHmacWorker, frames) {
    sizes.push({ rows: frames.length, bytes: frames.reduce((sum, frame) => sum + frame.byteLength, 0) })
    return original.call(this, frames)
  })
  const source = (async function* () {
    try { for (let index = 0; index < count; index++) { produced++; maximumAhead = Math.max(maximumAhead, produced - consumed); yield row(index, payload) } }
    finally { returned = true }
  })()
  try {
    for await (const measured of fingerprintRows(source, key)) {
      const expected = row(consumed, payload), old = keyedRowDigestAndSize(key, expected)
      expect(measured).toMatchObject({ identity: rowIdentity(expected), digest: old.digest, bytes: old.bytes, fields: 2, metadataDigest: keyedDigest(key, 'metadata-v1', canonicalValue(expected.metadata ?? {})) })
      consumed++
    }
    expect(consumed).toBe(count); expect(returned).toBe(true); expect(key).toEqual(beforeKey)
    expect(maximumAhead).toBeLessThanOrEqual(1001)
    expect(sizes.length).toBeGreaterThan(1)
    expect(sizes.every(size => size.rows <= 500 && size.bytes <= 2 * 1024 * 1024)).toBe(true)
  } finally { submit.mockRestore() }
})

test('consumer failure joins a pending bounded worker batch and returns the source', async () => {
  let returned = false
  const source = (async function* () { try { for (let index = 0; index < 1600; index++) yield row(index) } finally { returned = true } })()
  await expect((async () => { for await (const _row of fingerprintRows(source, key)) throw new Error('original mismatch') })()).rejects.toThrow('original mismatch')
  expect(returned).toBe(true)
})

test('producer snapshots reused row metadata before reading the next row', async () => {
  const metadata = { updated_at: '' }
  const source = (async function* () {
    for (let index = 0; index < 1100; index++) {
      metadata.updated_at = String(index)
      yield { ...row(index), metadata }
    }
  })()
  let index = 0
  for await (const measured of fingerprintRows(source, key)) {
    expect(measured.metadataDigest).toBe(keyedDigest(key, 'metadata-v1', canonicalValue({ updated_at: String(index++) })))
  }
  expect(index).toBe(1100)
})

test('aborting a producer with an owned worker stops without output and joins source cleanup', async () => {
  const controller = new AbortController(); let returned = false, output = 0
  const source = (async function* () {
    try { for (let index = 0; index < 1200; index++) { if (index === 510) controller.abort(); yield row(index) } }
    finally { returned = true }
  })()
  const began = Date.now()
  await expect((async () => { for await (const _row of fingerprintRows(source, key, controller.signal)) output++ })()).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
  expect(output).toBe(0); expect(returned).toBe(true); expect(Date.now() - began).toBeLessThan(15000)
})

test('worker failure actively aborts a blocked producer and joins it before returning', async () => {
  let cancelled = false, returned = false, output = 0
  const submit = jest.spyOn(RowHmacWorker.prototype, 'digestBatch').mockImplementationOnce(async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
    throw new Error('[internal] ROTATION_DIGEST_WORKER_FAILED')
  })
  const source = (signal: AbortSignal) => (async function* () {
    try {
      for (let index = 0; index < 600; index++) {
        if (index === 510) await new Promise<void>((_resolve, reject) => {
          const abort = () => { cancelled = true; reject(new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE')) }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
        yield row(index)
      }
    } finally { returned = true }
  })()
  const began = Date.now()
  try {
    await expect((async () => { for await (const _row of fingerprintRows(source, key)) output++ })()).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
    expect(cancelled).toBe(true); expect(returned).toBe(true); expect(output).toBe(0)
    expect(Date.now() - began).toBeLessThan(15000)
  } finally { submit.mockRestore() }
})

test('the initial blocked source has no worker that can fail without an observed batch', async () => {
  const workerThreads = jest.requireActual<typeof import('node:worker_threads')>('node:worker_threads')
  const OriginalWorker = workerThreads.Worker
  const created = jest.spyOn(workerThreads, 'Worker').mockImplementation((filename, options) => new OriginalWorker(filename, options))
  let release!: () => void, firstRead!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const reading = new Promise<void>(resolve => { firstRead = resolve })
  const submit = jest.spyOn(RowHmacWorker.prototype, 'digestBatch')
  const close = jest.spyOn(RowHmacWorker.prototype, 'close')
  const source = (async function* () { firstRead(); await blocked; yield row(0) })()
  const output = (async () => { const rows = []; for await (const value of fingerprintRows(source, key)) rows.push(value); return rows })()
  try {
    await reading
    expect(created).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
    release()
    expect(await output).toHaveLength(1)
    expect(created).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
  } finally { release(); await output.catch(() => undefined); submit.mockRestore(); close.mockRestore(); created.mockRestore() }
})

test('an idle worker exit after a successful digest actively cancels blocked producer SQL', async () => {
  const original = RowHmacWorker.prototype.digestBatch
  let cancelled = false, returned = false, output = 0
  const submit = jest.spyOn(RowHmacWorker.prototype, 'digestBatch').mockImplementationOnce(async function (this: RowHmacWorker, frames) {
    const digests = await original.call(this, frames)
    setTimeout(() => { void (this as unknown as { worker: import('node:worker_threads').Worker }).worker.terminate() }, 20)
    return digests
  })
  const source = (signal: AbortSignal) => (async function* () {
    try {
      for (let index = 0; index < 600; index++) {
        if (index === 510) await new Promise<void>((_resolve, reject) => {
          const abort = () => { cancelled = true; reject(new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE')) }
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
        })
        yield row(index)
      }
    } finally { returned = true }
  })()
  const began = Date.now()
  try {
    await expect((async () => { for await (const _row of fingerprintRows(source, key)) output++ })()).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
    expect(cancelled).toBe(true); expect(returned).toBe(true); expect(output).toBe(0)
    expect(Date.now() - began).toBeLessThan(15000)
  } finally { submit.mockRestore() }
})
