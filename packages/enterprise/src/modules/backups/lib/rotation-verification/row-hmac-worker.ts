import { Worker } from 'node:worker_threads'
import { types } from 'node:util'

const MAX_ROW = 1024 * 1024
const MAX_BATCH = 2 * MAX_ROW
const MAX_ROWS = 500
const DEADLINE_MS = 10000
const PREFIX = Buffer.from('6400000006726f772d7631', 'hex')
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get
const failure = (code = 'ROTATION_DIGEST_WORKER_FAILED') => new Error(`[internal] ${code}`)

// Static trusted code, with no application imports, filesystem, SQL or logging.
const source = `
const {parentPort,workerData}=require('node:worker_threads')
const {createHmac}=require('node:crypto')
const {types}=require('node:util')
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get
let key,prefix,next=0,stopped=false
const bad=()=>{if(stopped)return;stopped=true;key?.fill(0);prefix?.fill(0);parentPort.postMessage({type:'failure'});parentPort.close();process.exitCode=1}
try{
 if(!(workerData.key instanceof Uint8Array)||workerData.key.byteOffset!==0||workerData.key.byteLength!==32||workerData.key.buffer.byteLength!==32)throw Error()
 if(!(workerData.prefix instanceof Uint8Array)||workerData.prefix.byteOffset!==0||workerData.prefix.byteLength!==11||workerData.prefix.buffer.byteLength!==11)throw Error()
 key=Buffer.from(workerData.key.buffer);prefix=Buffer.from(workerData.prefix.buffer)
 if(prefix.toString('hex')!=='6400000006726f772d7631')throw Error()
 parentPort.on('message',message=>{
  try{
   if(stopped)throw Error()
   if(message?.type==='close'&&Object.keys(message).length===1){stopped=true;key.fill(0);prefix.fill(0);parentPort.postMessage({type:'closed',zeroized:true});parentPort.close();return}
   if(message?.type!=='batch'||Object.keys(message).length!==3||message.id!==next||!Number.isSafeInteger(message.id)||!Array.isArray(message.frames)||message.frames.length>500)throw Error()
   let size=0
   for(const frame of message.frames){if(!types.isArrayBuffer(frame)||resizable?.call(frame)===true||frame.byteLength>1048576)throw Error();size+=frame.byteLength;if(size>2097152)throw Error()}
   const digests=[]
   for(const frame of message.frames)digests.push(createHmac('sha256',key).update(prefix).update(Buffer.from(frame)).digest('hex'))
   for(const frame of new Set(message.frames))Buffer.from(frame).fill(0)
   next++;parentPort.postMessage({type:'result',id:message.id,digests})
  }catch{bad()}
 })
 parentPort.postMessage({type:'ready'})
}catch{bad()}
`

/** One in-flight batch; callers may prepare one further bounded batch themselves. */
export class RowHmacWorker {
  private readonly failureController = new AbortController()
  get failureSignal(): AbortSignal { return this.failureController.signal }
  private readonly worker: Worker
  private readonly ready: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private readyReceived = false
  private readonly exited: Promise<void>
  private exitResolve!: () => void
  private didExit = false
  private terminal?: Error
  private busy = false
  private next = 0
  private closing = false
  private acknowledged = false
  private closePromise?: Promise<void>
  private stopPromise?: Promise<void>
  private pending?: { id: number; count: number; resolve(value: string[]): void; reject(error: Error): void }
  private readonly abort: () => void
  private startupTimer?: ReturnType<typeof setTimeout>

  constructor(runKey: Uint8Array, domainPrefix: Uint8Array, private readonly signal?: AbortSignal) {
    if (signal?.aborted) throw failure('ROTATION_VERIFICATION_INCOMPLETE')
    if (!types.isUint8Array(runKey) || !types.isArrayBuffer(runKey.buffer) || runKey.byteLength !== 32 || !types.isUint8Array(domainPrefix) || !types.isArrayBuffer(domainPrefix.buffer) || !Buffer.from(domainPrefix).equals(PREFIX)) throw failure('ROTATION_DIGEST_WORKER_INPUT_INVALID')
    const key = new Uint8Array(32); key.set(runKey)
    const prefix = new Uint8Array(PREFIX.length); prefix.set(domainPrefix)
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    // Startup may fail before the caller first awaits a batch or close.
    void this.ready.catch(() => undefined)
    this.exited = new Promise(resolve => { this.exitResolve = resolve })
    try {
      this.worker = new Worker(source, {
        eval: true, workerData: { key, prefix }, transferList: [key.buffer, prefix.buffer],
        execArgv: [], env: {}, stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 },
      })
    } catch {
      if (key.byteLength) key.fill(0)
      if (prefix.byteLength) prefix.fill(0)
      throw failure()
    }
    this.worker.stdout?.resume(); this.worker.stderr?.resume()
    this.worker.on('message', message => this.message(message))
    this.worker.on('error', () => this.fail(failure()))
    this.worker.on('exit', code => {
      this.didExit = true; this.exitResolve()
      if (!this.closing || !this.acknowledged || code !== 0 || this.pending || !this.readyReceived) this.fail(failure())
      this.detach()
    })
    this.abort = () => this.fail(failure('ROTATION_VERIFICATION_INCOMPLETE'))
    signal?.addEventListener('abort', this.abort, { once: true })
    this.startupTimer = setTimeout(() => this.fail(failure()), DEADLINE_MS)
    if (signal?.aborted) this.abort()
  }

  private detach() {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.signal?.removeEventListener('abort', this.abort)
  }

  private stop(): Promise<void> {
    this.stopPromise ??= this.didExit ? this.exited : this.worker.terminate().then(() => this.exited, () => this.exited)
    return this.stopPromise
  }

  private fail(error: Error) {
    this.terminal ??= error
    this.failureController.abort(this.terminal)
    this.readyReject(this.terminal)
    this.pending?.reject(this.terminal); this.pending = undefined
    this.detach()
    void this.stop()
  }

  private message(value: unknown) {
    if (!value || typeof value !== 'object') { this.fail(failure()); return }
    const message = value as Record<string, unknown>
    if (message.type === 'ready' && Object.keys(message).length === 1 && !this.readyReceived && !this.terminal) {
      this.readyReceived = true
      if (this.startupTimer) clearTimeout(this.startupTimer)
      this.readyResolve(); return
    }
    if (message.type === 'closed' && Object.keys(message).length === 2 && message.zeroized === true && this.closing && !this.pending && !this.terminal) { this.acknowledged = true; return }
    const pending = this.pending
    if (message.type !== 'result' || Object.keys(message).length !== 3 || !this.readyReceived || !pending || message.id !== pending.id || !Array.isArray(message.digests) || message.digests.length !== pending.count || message.digests.some(digest => typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))) { this.fail(failure()); return }
    this.pending = undefined; pending.resolve(message.digests)
  }

  async digestBatch(frames: readonly ArrayBuffer[]): Promise<string[]> {
    if (this.terminal) throw this.terminal
    if (this.closing) throw failure()
    if (this.busy) throw failure('ROTATION_DIGEST_WORKER_BUSY')
    if (!Array.isArray(frames) || frames.length > MAX_ROWS) throw failure('ROTATION_DIGEST_WORKER_INPUT_INVALID')
    const batch = [...frames]
    let size = 0
    for (const frame of batch) {
      if (!types.isArrayBuffer(frame) || resizable?.call(frame) === true || frame.byteLength > MAX_ROW) throw failure('ROTATION_DIGEST_WORKER_INPUT_INVALID')
      size += frame.byteLength
      if (size > MAX_BATCH) throw failure('ROTATION_DIGEST_WORKER_INPUT_INVALID')
    }
    this.busy = true
    const timer = setTimeout(() => this.fail(failure()), DEADLINE_MS)
    try {
      await this.ready
      if (this.terminal || this.closing) throw this.terminal ?? failure()
      if (!Number.isSafeInteger(this.next)) throw failure()
      const id = this.next++
      return await new Promise<string[]>((resolve, reject) => {
        this.pending = { id, count: batch.length, resolve, reject }
        try { this.worker.postMessage({ type: 'batch', id, frames: batch }, [...new Set(batch)]) }
        catch { this.fail(failure()) }
      })
    } finally { clearTimeout(timer); this.busy = false }
  }

  close(): Promise<void> {
    this.closePromise ??= this.finish()
    return this.closePromise
  }

  private async finish(): Promise<void> {
    if (this.terminal) { await this.stop(); throw this.terminal }
    if (this.busy) { this.fail(failure()); await this.stop(); throw this.terminal }
    this.closing = true
    const timer = setTimeout(() => this.fail(failure()), DEADLINE_MS)
    try {
      try { this.worker.postMessage({ type: 'close' }) } catch { this.fail(failure()) }
      await this.exited
      if (this.terminal || !this.acknowledged) throw this.terminal ?? failure()
    } finally { clearTimeout(timer); this.detach(); await this.stop() }
  }
}
