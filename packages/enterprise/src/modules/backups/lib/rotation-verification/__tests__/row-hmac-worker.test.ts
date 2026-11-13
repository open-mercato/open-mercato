/** @jest-environment node */
import { createHmac } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build, stop } from 'esbuild'
import type { Worker, WorkerOptions } from 'node:worker_threads'
import { RowHmacWorker } from '../row-hmac-worker'

const threads = require('node:worker_threads') as typeof import('node:worker_threads')
const ActualWorker = threads.Worker
const prefix = Buffer.from('6400000006726f772d7631', 'hex')
const key = Buffer.alloc(32, 7)
const created: Worker[] = []
let replacement: string | undefined
let spy: jest.SpyInstance
let options: WorkerOptions | undefined
beforeEach(() => {
  replacement = undefined; options = undefined
  spy = jest.spyOn(threads, 'Worker').mockImplementation((source, supplied) => {
    options = supplied
    const worker = new ActualWorker(replacement ?? source, supplied)
    created.push(worker); return worker
  })
})
afterEach(async () => {
  await Promise.all(created.splice(0).map(worker => worker.terminate()))
  spy.mockRestore()
})
function frame(value: string | Uint8Array): ArrayBuffer { return new Uint8Array(typeof value === 'string' ? Buffer.from(value) : value).buffer }
function digest(value: ArrayBuffer) { return createHmac('sha256', key).update(prefix).update(Buffer.from(value)).digest('hex') }

test('actual worker preserves exact builtin HMAC bytes, batch order and parent key/prefix pools', async () => {
  const pooled = Buffer.allocUnsafe(64); pooled.fill(7)
  const runKey = pooled.subarray(0, 32), before = Buffer.from(pooled), beforePrefix = Buffer.from(prefix)
  const worker = new RowHmacWorker(runKey, prefix)
  const received: unknown[] = []; created[0].on('message', value => received.push(value))
  const first = frame('日本語😀\u0000'), repeated = frame('repeated')
  const frames = [first, frame(new Uint8Array([0, 255, 128])), frame('x'.repeat(1024 * 1024)), repeated, repeated]
  const expected = frames.map(value => createHmac('sha256', runKey).update(prefix).update(Buffer.from(value)).digest('hex'))
  expect(await worker.digestBatch(frames)).toEqual(expected)
  expect(frames.every(value => value.byteLength === 0)).toBe(true)
  expect(pooled).toEqual(before); expect(prefix).toEqual(beforePrefix)
  expect(options).toMatchObject({ execArgv: [], env: {}, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 } })
  expect(await worker.digestBatch([])).toEqual([])
  const closing = worker.close(); expect(worker.close()).toBe(closing); await closing
  expect(received).toContainEqual({ type: 'closed', zeroized: true })
  expect(created[0].threadId).toBe(-1)
})

test('input caps refuse before transfer and leave a healthy worker usable', async () => {
  const worker = new RowHmacWorker(key, prefix)
  const tooWide = new ArrayBuffer(1024 * 1024 + 1)
  await expect(worker.digestBatch([tooWide])).rejects.toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  expect(tooWide.byteLength).toBe(1024 * 1024 + 1)
  await expect(worker.digestBatch([new ArrayBuffer(1024 * 1024), new ArrayBuffer(1024 * 1024), new ArrayBuffer(1)])).rejects.toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  await expect(worker.digestBatch(Array.from({ length: 501 }, () => new ArrayBuffer(0)))).rejects.toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  await expect(worker.digestBatch([new SharedArrayBuffer(8) as unknown as ArrayBuffer])).rejects.toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  const valid = frame('valid'); const expected = digest(valid)
  expect(await worker.digestBatch([valid])).toEqual([expected]); await worker.close()
})

test('rejects incorrect key/domain without starting a worker', () => {
  expect(() => new RowHmacWorker(Buffer.alloc(31), prefix)).toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  expect(() => new RowHmacWorker(key, Buffer.from('another domain'))).toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  expect(() => new RowHmacWorker(new Uint8Array(new SharedArrayBuffer(32)), prefix)).toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  expect(created).toHaveLength(0)
})

test('synchronous worker construction failure zeroes untransferred copies and sanitizes the error', () => {
  let copiedKey: Uint8Array | undefined, copiedPrefix: Uint8Array | undefined
  const originalKey = Buffer.from(key), originalPrefix = Buffer.from(prefix)
  spy.mockImplementationOnce((_source, supplied: WorkerOptions) => {
    copiedKey = supplied.workerData.key; copiedPrefix = supplied.workerData.prefix
    throw new Error('untrusted constructor details')
  })
  expect(() => new RowHmacWorker(key, prefix)).toThrow('[internal] ROTATION_DIGEST_WORKER_FAILED')
  expect([...copiedKey!]).toEqual(Array(32).fill(0))
  expect([...copiedPrefix!]).toEqual(Array(11).fill(0))
  expect(key).toEqual(originalKey); expect(prefix).toEqual(originalPrefix)
  expect(created).toHaveLength(0)
})

test('one concurrent submission rejects rather than accumulating a hidden queue', async () => {
  const worker = new RowHmacWorker(key, prefix), first = frame('one'), second = frame('two')
  const expected = digest(first), pending = worker.digestBatch([first])
  await expect(worker.digestBatch([second])).rejects.toThrow('ROTATION_DIGEST_WORKER_BUSY')
  expect(second.byteLength).toBe(3); expect(await pending).toEqual([expected]); await worker.close()
})

test('captures the checked batch and copies key bytes before asynchronous startup', async () => {
  const callerKey = Buffer.from(key), callerPrefix = Buffer.from(prefix)
  const worker = new RowHmacWorker(callerKey, callerPrefix), original = frame('original')
  const expected = digest(original), frames = [original]
  const pending = worker.digestBatch(frames)
  callerKey.fill(0); callerPrefix.fill(0)
  const later = new ArrayBuffer(1024 * 1024 + 1); frames.push(later)
  expect(await pending).toEqual([expected])
  expect(later.byteLength).toBe(1024 * 1024 + 1)
  await worker.close()
})

test('resizable buffers cannot grow past the pre-startup cap or hide their internal resizability', async () => {
  const worker = new RowHmacWorker(key, prefix)
  const growing = new ArrayBuffer(1, { maxByteLength: 1024 * 1024 + 1 })
  // A caller-owned property cannot conceal the buffer's native slot.
  Object.defineProperty(growing, 'resizable', { value: false })
  const pending = worker.digestBatch([growing])
  growing.resize(1024 * 1024 + 1)
  await expect(pending).rejects.toThrow('ROTATION_DIGEST_WORKER_INPUT_INVALID')
  expect(growing.byteLength).toBe(1024 * 1024 + 1)
  const valid = frame('still healthy'), expected = digest(valid)
  expect(await worker.digestBatch([valid])).toEqual([expected]); await worker.close()
})

test('worker independently rejects a transferred resizable buffer', async () => {
  const worker = new RowHmacWorker(key, prefix); await worker.digestBatch([])
  const growing = new ArrayBuffer(1, { maxByteLength: 1024 * 1024 + 1 })
  created[0].postMessage({ type: 'batch', id: 1, frames: [growing] }, [growing])
  await expect(worker.digestBatch([frame('pending')])).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  await expect(worker.close()).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  expect(created[0].threadId).toBe(-1)
})

test('abort rejects outstanding work and joins the actual thread within the cancellation bound', async () => {
  const controller = new AbortController(), worker = new RowHmacWorker(key, prefix, controller.signal)
  const began = Date.now(), pending = worker.digestBatch([frame('pending')])
  controller.abort()
  await expect(pending).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
  await expect(worker.close()).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
  expect(created[0].threadId).toBe(-1); expect(Date.now() - began).toBeLessThan(15000)
  expect(() => new RowHmacWorker(key, prefix, controller.signal)).toThrow('ROTATION_VERIFICATION_INCOMPLETE')
})

test('premature actual exit zero before ready rejects instead of hanging or falling back', async () => {
  replacement = 'process.exit(0)'
  const worker = new RowHmacWorker(key, prefix)
  await expect(worker.digestBatch([frame('pending')])).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  await expect(worker.close()).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  expect(created[0].threadId).toBe(-1)
})

test('worker independently rejects an oversized frame when the public input gate is bypassed', async () => {
  const worker = new RowHmacWorker(key, prefix)
  await worker.digestBatch([])
  const oversized = new ArrayBuffer(1024 * 1024 + 1)
  created[0].postMessage({ type: 'batch', id: 1, frames: [oversized] }, [oversized])
  await expect(worker.digestBatch([frame('pending')])).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  await expect(worker.close()).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  expect(created[0].threadId).toBe(-1)
})

test.each([
  { type: 'result', id: 999, digests: ['0'.repeat(64)] },
  { type: 'result', id: 1, digests: [] },
  { type: 'result', id: 1, digests: ['not-a-digest'] },
])('malformed/incorrect ordered worker response fails closed: %j', async reply => {
  const worker = new RowHmacWorker(key, prefix); await worker.digestBatch([])
  const pending = worker.digestBatch([frame('pending')]); await Promise.resolve()
  created[0].emit('message', reply)
  await expect(pending).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  await expect(worker.close()).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  expect(created[0].threadId).toBe(-1)
})

test('a pooled plaintext backing buffer is not detached or copied as a successful batch', async () => {
  const pooled = Buffer.allocUnsafe(128); pooled.fill(23)
  const before = Buffer.from(pooled), worker = new RowHmacWorker(key, prefix)
  await expect(worker.digestBatch([pooled.buffer as ArrayBuffer])).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  await expect(worker.close()).rejects.toThrow('ROTATION_DIGEST_WORKER_FAILED')
  expect(pooled).toEqual(before); expect(pooled.byteLength).toBe(128)
})

test('parent heap flags do not override the actual worker resource limits or reach execArgv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rotation-worker-flags-'))
  try {
    const path = join(directory, 'worker.cjs')
    try { await build({ entryPoints: [resolve(__dirname, '../row-hmac-worker.ts')], outfile: path, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' }) } finally { stop() }
    const script = `const threads=require('node:worker_threads');const Actual=threads.Worker;let limits,execArgv;threads.Worker=class extends Actual{constructor(source,options){super(source,options);limits=this.resourceLimits;execArgv=options.execArgv}};const{RowHmacWorker}=require(${JSON.stringify(path)});(async()=>{const worker=new RowHmacWorker(Buffer.alloc(32,7),Buffer.from('6400000006726f772d7631','hex'));await worker.digestBatch([new Uint8Array([1]).buffer]);await worker.close();console.log(JSON.stringify({limits,execArgv}))})().catch(()=>process.exitCode=1)`
    const result = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--max-semi-space-size=4', '-e', script], { env: {}, timeout: 10000 })
    expect(JSON.parse(result.stdout)).toMatchObject({ limits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 }, execArgv: [] })
    expect(result.stderr).toBe('')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
