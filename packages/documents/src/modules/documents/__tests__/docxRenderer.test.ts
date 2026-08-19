import {
  createDocxRenderer,
  DOCX_WORKER_RESOURCE_LIMITS,
  DocxRenderFailedError,
  DocxRenderOutputTooLargeError,
  DocxRenderOverloadedError,
  DocxRenderTimeoutError,
  type DocxWorker,
} from '../lib/docxRenderer'
import JSZip from 'jszip'

class FakeWorker implements DocxWorker {
  private readonly listeners = {
    message: [] as Array<(message: unknown) => void>,
    error: [] as Array<(error: Error) => void>,
    exit: [] as Array<(code: number) => void>,
  }

  readonly terminate = jest.fn(async () => 1)

  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  on(
    event: 'message' | 'error' | 'exit',
    listener: ((message: unknown) => void) | ((error: Error) => void) | ((code: number) => void),
  ): this {
    if (event === 'message') this.listeners.message.push(listener as (message: unknown) => void)
    if (event === 'error') this.listeners.error.push(listener as (error: Error) => void)
    if (event === 'exit') this.listeners.exit.push(listener as (code: number) => void)
    return this
  }

  emitMessage(message: unknown): void {
    for (const listener of this.listeners.message) listener(message)
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.error) listener(error)
  }

  emitExit(code: number): void {
    for (const listener of this.listeners.exit) listener(code)
  }
}

async function waitForWorker(workers: FakeWorker[]): Promise<FakeWorker> {
  for (let attempt = 0; attempt < 20 && workers.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const worker = workers[0]
  if (!worker) throw new Error('worker was not created')
  return worker
}

describe('process-local DOCX renderer', () => {
  it('runs conversion in a worker with an explicit memory envelope', () => {
    expect(DOCX_WORKER_RESOURCE_LIMITS).toEqual({
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4,
    })
  })

  it('assembles only the worker-declared bounded chunks', async () => {
    const workers: FakeWorker[] = []
    const renderer = createDocxRenderer({}, {
      modulePath: '/mock/jszip',
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const result = renderer.render('<p>Safe</p>')
    const worker = await waitForWorker(workers)
    worker.emitMessage({ type: 'start', totalBytes: 3 })
    worker.emitMessage({ type: 'chunk', chunk: new Uint8Array([1, 2]) })
    worker.emitMessage({ type: 'chunk', chunk: new Uint8Array([3]) })
    worker.emitMessage({ type: 'done' })

    await expect(result).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('bounds active workers and rejects excess requests', async () => {
    const workers: FakeWorker[] = []
    const renderer = createDocxRenderer({
      maxConcurrency: 1,
      maxQueue: 0,
      renderTimeoutMs: 1_000,
    }, {
      modulePath: '/mock/jszip',
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const first = renderer.render('<p>First</p>')
    const worker = await waitForWorker(workers)

    await expect(renderer.render('<p>Second</p>'))
      .rejects.toBeInstanceOf(DocxRenderOverloadedError)
    worker.emitMessage({ type: 'start', totalBytes: 1 })
    worker.emitMessage({ type: 'chunk', chunk: new Uint8Array([1]) })
    worker.emitMessage({ type: 'done' })
    await expect(first).resolves.toEqual(new Uint8Array([1]))
  })

  it('terminates a CPU-bound worker at the response deadline', async () => {
    const workers: FakeWorker[] = []
    const renderer = createDocxRenderer({ maxConcurrency: 1, maxQueue: 0, renderTimeoutMs: 10 }, {
      modulePath: '/mock/jszip',
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const result = renderer.render('<p>Never finishes</p>')
    const worker = await waitForWorker(workers)

    await expect(result).rejects.toBeInstanceOf(DocxRenderTimeoutError)
    expect(worker.terminate).toHaveBeenCalledTimes(1)

    const next = renderer.render('<p>After timeout</p>')
    for (let attempt = 0; attempt < 20 && workers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const nextWorker = workers[1]
    if (!nextWorker) throw new Error('replacement worker was not created')
    nextWorker.emitMessage({ type: 'start', totalBytes: 1 })
    nextWorker.emitMessage({ type: 'chunk', chunk: new Uint8Array([2]) })
    nextWorker.emitMessage({ type: 'done' })
    await expect(next).resolves.toEqual(new Uint8Array([2]))
  })

  it('aborts worker-reported overflow without allocating output in the app realm', async () => {
    const workers: FakeWorker[] = []
    const allocateOutput = jest.fn((length: number) => new Uint8Array(length))
    const renderer = createDocxRenderer({ maxOutputBytes: 4 }, {
      modulePath: '/mock/jszip',
      allocateOutput,
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const result = renderer.render('<p>Huge result</p>')
    const worker = await waitForWorker(workers)
    worker.emitMessage({ type: 'overflow' })

    await expect(result).rejects.toBeInstanceOf(DocxRenderOutputTooLargeError)
    expect(allocateOutput).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'exit'] as const)('fails closed when the worker emits %s', async (event) => {
    const workers: FakeWorker[] = []
    const renderer = createDocxRenderer({}, {
      modulePath: '/mock/jszip',
      workerFactory: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    const result = renderer.render('<p>Failure</p>')
    const worker = await waitForWorker(workers)
    if (event === 'error') worker.emitError(new Error('worker failed'))
    else worker.emitExit(9)

    await expect(result).rejects.toBeInstanceOf(DocxRenderFailedError)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('builds an OpenXML archive in a real worker without image metadata dependencies', async () => {
    const renderer = createDocxRenderer({ renderTimeoutMs: 5_000 })

    const result = await renderer.render('<h1>Worker smoke test</h1><p><strong>Safe body</strong></p>')

    expect(Buffer.from(result).subarray(0, 2).toString('ascii')).toBe('PK')
    const archive = await JSZip.loadAsync(result)
    const documentXml = await archive.file('word/document.xml')?.async('string')
    expect(documentXml).toContain('Worker smoke test')
    expect(documentXml).toContain('Safe body')
    expect(documentXml).toContain('<w:b/>')
  })

  it('resolves the traced dependency at worker runtime when a bundler replaces its path', async () => {
    const renderer = createDocxRenderer({ renderTimeoutMs: 5_000 }, { modulePath: null })

    const result = await renderer.render('<p>Bundled worker smoke test</p>')

    expect(Buffer.from(result).subarray(0, 2).toString('ascii')).toBe('PK')
  })
})
