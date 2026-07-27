import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { Worker } from 'node:worker_threads'

export const DOCX_RENDER_MAX_CONCURRENCY = 2
export const DOCX_RENDER_MAX_QUEUE = 4
export const DOCX_RENDER_ACQUIRE_TIMEOUT_MS = 2_000
export const DOCX_RENDER_TIMEOUT_MS = 20_000
export const DOCX_MAX_OUTPUT_BYTES = 25 * 1024 * 1024
export const DOCX_WORKER_CHUNK_BYTES = 64 * 1024
export const DOCX_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
})
const DOCX_OVERLOADED_MARKER = Symbol.for('open-mercato.documents.docxRenderer.overloaded')
const DOCX_TIMEOUT_MARKER = Symbol.for('open-mercato.documents.docxRenderer.timeout')
const DOCX_OUTPUT_TOO_LARGE_MARKER = Symbol.for('open-mercato.documents.docxRenderer.outputTooLarge')
const DOCX_FAILED_MARKER = Symbol.for('open-mercato.documents.docxRenderer.failed')

export class DocxRenderOverloadedError extends Error {
  readonly [DOCX_OVERLOADED_MARKER] = true
  constructor() {
    super('DOCX renderer is at capacity')
    this.name = 'DocxRenderOverloadedError'
  }
}

export class DocxRenderTimeoutError extends Error {
  readonly [DOCX_TIMEOUT_MARKER] = true
  constructor() {
    super('DOCX renderer timed out')
    this.name = 'DocxRenderTimeoutError'
  }
}

export class DocxRenderOutputTooLargeError extends Error {
  readonly [DOCX_OUTPUT_TOO_LARGE_MARKER] = true
  constructor() {
    super('DOCX renderer output exceeded its byte limit')
    this.name = 'DocxRenderOutputTooLargeError'
  }
}

export class DocxRenderFailedError extends Error {
  readonly [DOCX_FAILED_MARKER] = true
  constructor(options: { cause?: unknown } = {}) {
    super('DOCX renderer failed', options)
    this.name = 'DocxRenderFailedError'
  }
}

function hasErrorMarker(error: unknown, marker: symbol): boolean {
  return Boolean(error && typeof error === 'object' && (error as Record<symbol, unknown>)[marker] === true)
}

export const isDocxRenderOverloadedError = (error: unknown): boolean => (
  error instanceof DocxRenderOverloadedError || hasErrorMarker(error, DOCX_OVERLOADED_MARKER)
)
export const isDocxRenderTimeoutError = (error: unknown): boolean => (
  error instanceof DocxRenderTimeoutError || hasErrorMarker(error, DOCX_TIMEOUT_MARKER)
)
export const isDocxRenderOutputTooLargeError = (error: unknown): boolean => (
  error instanceof DocxRenderOutputTooLargeError || hasErrorMarker(error, DOCX_OUTPUT_TOO_LARGE_MARKER)
)
export const isDocxRenderFailedError = (error: unknown): boolean => (
  error instanceof DocxRenderFailedError || hasErrorMarker(error, DOCX_FAILED_MARKER)
)

type DocxRendererOptions = {
  maxConcurrency?: number
  maxQueue?: number
  acquireTimeoutMs?: number
  renderTimeoutMs?: number
  maxOutputBytes?: number
}

export interface DocxWorker {
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

export type DocxWorkerFactoryInput = {
  html: string
  modulePath: string | null
  moduleSpecifier: string
  requireFrom: string
  maxOutputBytes: number
  chunkBytes: number
}

export type DocxWorkerFactory = (input: DocxWorkerFactoryInput) => DocxWorker

type DocxRendererDeps = {
  workerFactory?: DocxWorkerFactory
  modulePath?: string | null
  allocateOutput?: (byteLength: number) => Uint8Array
}

const DOCX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')

async function normalizeBinary(value) {
  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer())
  }
  throw new Error('[internal] html-to-docx returned an unsupported binary payload')
}

;(async () => {
  const imported = typeof workerData.modulePath === 'string'
    ? require(workerData.modulePath)
    : require('node:module').createRequire(workerData.requireFrom)(workerData.moduleSpecifier)
  const converter = typeof imported === 'function' ? imported : imported && imported.default
  if (typeof converter !== 'function') throw new Error('[internal] html-to-docx export is not callable')
  const bytes = await normalizeBinary(await converter(workerData.html))
  if (bytes.byteLength > workerData.maxOutputBytes) {
    parentPort.postMessage({ type: 'overflow' })
    parentPort.close()
    return
  }

  parentPort.postMessage({ type: 'start', totalBytes: bytes.byteLength })
  for (let offset = 0; offset < bytes.byteLength; offset += workerData.chunkBytes) {
    const length = Math.min(workerData.chunkBytes, bytes.byteLength - offset)
    const chunk = new Uint8Array(length)
    chunk.set(bytes.subarray(offset, offset + length))
    parentPort.postMessage({ type: 'chunk', chunk }, [chunk.buffer])
  }
  parentPort.postMessage({ type: 'done' })
  parentPort.close()
})().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    message: error && typeof error.message === 'string' ? error.message : 'DOCX conversion failed',
  })
  parentPort.close()
})
`

const requireFromHere = createRequire(import.meta.url)

function defaultWorkerFactory(input: DocxWorkerFactoryInput): DocxWorker {
  return new Worker(DOCX_WORKER_SOURCE, {
    eval: true,
    workerData: input,
    resourceLimits: DOCX_WORKER_RESOURCE_LIMITS,
    // `--input-type=module` is valid only for the parent's eval/stdin entry and
    // would reinterpret this deliberately CommonJS worker source. Preserve all
    // other execArgv entries, including Yarn PnP loaders.
    execArgv: process.execArgv.filter((arg) => !arg.startsWith('--input-type')),
  })
}

function resolveHtmlToDocxModuleReference(): Pick<DocxWorkerFactoryInput, 'modulePath' | 'moduleSpecifier' | 'requireFrom'> {
  // createRequire keeps node-modules and Yarn PnP resolution anchored to this
  // package. Turbopack rewrites a statically traced external `require.resolve`
  // to its numeric module id, which Node workers cannot require directly. Keep
  // the static lookup so output tracing includes the dependency, but fall back
  // to runtime resolution inside the unbundled worker when the value is not an
  // absolute Node path.
  const tracedPath: unknown = requireFromHere.resolve('html-to-docx')
  return {
    modulePath: typeof tracedPath === 'string' && isAbsolute(tracedPath) ? tracedPath : null,
    moduleSpecifier: 'html-to-docx',
    requireFrom: import.meta.url,
  }
}

export function createDocxRenderer(
  options: DocxRendererOptions = {},
  deps: DocxRendererDeps = {},
) {
  const maxConcurrency = options.maxConcurrency ?? DOCX_RENDER_MAX_CONCURRENCY
  const maxQueue = options.maxQueue ?? DOCX_RENDER_MAX_QUEUE
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DOCX_RENDER_ACQUIRE_TIMEOUT_MS
  const renderTimeoutMs = options.renderTimeoutMs ?? DOCX_RENDER_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? DOCX_MAX_OUTPUT_BYTES
  const workerFactory = deps.workerFactory ?? defaultWorkerFactory
  const allocateOutput = deps.allocateOutput ?? ((byteLength: number) => new Uint8Array(byteLength))
  let active = 0
  const waiters: Array<{
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  const grant = (): (() => void) => {
    active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      const waiter = waiters.shift()
      if (!waiter) return
      clearTimeout(waiter.timer)
      waiter.resolve(grant())
    }
  }

  const acquire = async (): Promise<() => void> => {
    if (active < maxConcurrency) return grant()
    if (waiters.length >= maxQueue) throw new DocxRenderOverloadedError()
    return await new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new DocxRenderOverloadedError())
        }, acquireTimeoutMs),
      }
      waiters.push(waiter)
    })
  }

  const runWorker = (html: string): Promise<Uint8Array> => new Promise((resolve, reject) => {
    let worker: DocxWorker
    try {
      const moduleReference = deps.modulePath === undefined
        ? resolveHtmlToDocxModuleReference()
        : { modulePath: deps.modulePath, moduleSpecifier: 'html-to-docx', requireFrom: import.meta.url }
      worker = workerFactory({
        html,
        ...moduleReference,
        maxOutputBytes,
        chunkBytes: DOCX_WORKER_CHUNK_BYTES,
      })
    } catch (error) {
      reject(new DocxRenderFailedError({ cause: error }))
      return
    }

    let settled = false
    let output: Uint8Array | null = null
    let expectedBytes: number | null = null
    let receivedBytes = 0
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate().catch(() => undefined).then(() => {
        reject(new DocxRenderTimeoutError())
      })
    }, renderTimeoutMs)

    const terminateAndReject = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => undefined).then(() => reject(error))
    }

    const terminateAndResolve = (value: Uint8Array) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => undefined).then(() => resolve(value))
    }

    worker.on('message', (message) => {
      if (settled || !message || typeof message !== 'object') return
      const record = message as Record<string, unknown>
      if (record.type === 'overflow') {
        terminateAndReject(new DocxRenderOutputTooLargeError())
        return
      }
      if (record.type === 'error') {
        const message = typeof record.message === 'string'
          ? record.message
          : 'DOCX worker reported an unknown conversion failure'
        terminateAndReject(new DocxRenderFailedError({ cause: new Error(message) }))
        return
      }
      if (record.type === 'start') {
        const totalBytes = record.totalBytes
        if (
          expectedBytes !== null
          || typeof totalBytes !== 'number'
          || !Number.isSafeInteger(totalBytes)
          || totalBytes < 0
          || totalBytes > maxOutputBytes
        ) {
          terminateAndReject(new DocxRenderOutputTooLargeError())
          return
        }
        try {
          output = allocateOutput(totalBytes)
          if (output.byteLength !== totalBytes) throw new Error('[internal] invalid DOCX output allocation')
          expectedBytes = totalBytes
        } catch (error) {
          terminateAndReject(new DocxRenderFailedError({ cause: error }))
        }
        return
      }
      if (record.type === 'chunk') {
        const chunk = record.chunk
        if (
          expectedBytes === null
          || !output
          || !(chunk instanceof Uint8Array)
          || receivedBytes + chunk.byteLength > expectedBytes
          || receivedBytes + chunk.byteLength > maxOutputBytes
        ) {
          terminateAndReject(new DocxRenderOutputTooLargeError())
          return
        }
        output.set(chunk, receivedBytes)
        receivedBytes += chunk.byteLength
        return
      }
      if (record.type === 'done') {
        if (expectedBytes === null || !output || receivedBytes !== expectedBytes) {
          terminateAndReject(new DocxRenderFailedError())
          return
        }
        terminateAndResolve(output)
      }
    })
    worker.on('error', (error) => terminateAndReject(new DocxRenderFailedError({ cause: error })))
    worker.on('exit', (code) => {
      if (!settled) terminateAndReject(new DocxRenderFailedError({ cause: new Error(`DOCX worker exited with code ${code}`) }))
    })
  })

  const render = async (html: string): Promise<Uint8Array> => {
    const release = await acquire()
    try {
      return await runWorker(html)
    } finally {
      release()
    }
  }

  return { render }
}

const DOCX_RENDERER_KEY = Symbol.for('open-mercato.documents.docxRenderer')
const globalStore = globalThis as typeof globalThis & {
  [DOCX_RENDERER_KEY]?: ReturnType<typeof createDocxRenderer>
}
const processDocxRenderer = globalStore[DOCX_RENDERER_KEY]
  ?? (globalStore[DOCX_RENDERER_KEY] = createDocxRenderer())

export const renderDocxWithCapacity = processDocxRenderer.render
