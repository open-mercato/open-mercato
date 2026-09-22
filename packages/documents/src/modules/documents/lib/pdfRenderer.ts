import puppeteer from 'puppeteer-core'

export const PDF_RENDER_MAX_CONCURRENCY = 2
export const PDF_RENDER_MAX_QUEUE = 4
export const PDF_RENDER_ACQUIRE_TIMEOUT_MS = 2_000
export const PDF_RENDER_TIMEOUT_MS = 20_000
export const PDF_PAGE_CLOSE_TIMEOUT_MS = 1_000
export const PDF_MAX_OUTPUT_BYTES = 25 * 1024 * 1024

const PDF_OVERLOADED_MARKER = Symbol.for('open-mercato.documents.pdfRenderer.overloaded')
const PDF_TIMEOUT_MARKER = Symbol.for('open-mercato.documents.pdfRenderer.timeout')
const PDF_OUTPUT_TOO_LARGE_MARKER = Symbol.for('open-mercato.documents.pdfRenderer.outputTooLarge')

export class PdfRenderOverloadedError extends Error {
  readonly [PDF_OVERLOADED_MARKER] = true
  constructor() {
    super('PDF renderer is at capacity')
    this.name = 'PdfRenderOverloadedError'
  }
}

export class PdfRenderTimeoutError extends Error {
  readonly [PDF_TIMEOUT_MARKER] = true
  constructor() {
    super('PDF renderer timed out')
    this.name = 'PdfRenderTimeoutError'
  }
}

export class PdfRenderOutputTooLargeError extends Error {
  readonly [PDF_OUTPUT_TOO_LARGE_MARKER] = true
  constructor() {
    super('PDF renderer output exceeded its byte limit')
    this.name = 'PdfRenderOutputTooLargeError'
  }
}

function hasErrorMarker(error: unknown, marker: symbol): boolean {
  return Boolean(error && typeof error === 'object' && (error as Record<symbol, unknown>)[marker] === true)
}

export const isPdfRenderOverloadedError = (error: unknown): boolean => (
  error instanceof PdfRenderOverloadedError || hasErrorMarker(error, PDF_OVERLOADED_MARKER)
)
export const isPdfRenderTimeoutError = (error: unknown): boolean => (
  error instanceof PdfRenderTimeoutError || hasErrorMarker(error, PDF_TIMEOUT_MARKER)
)
export const isPdfRenderOutputTooLargeError = (error: unknown): boolean => (
  error instanceof PdfRenderOutputTooLargeError || hasErrorMarker(error, PDF_OUTPUT_TOO_LARGE_MARKER)
)

export type PdfAssetRequest = {
  url: () => string
  resourceType: () => string
  isNavigationRequest: () => boolean
  continue: () => Promise<unknown>
  abort: () => Promise<unknown>
}

export type PdfPage = {
  setJavaScriptEnabled: (enabled: boolean) => Promise<unknown>
  setRequestInterception: (enabled: boolean) => Promise<unknown>
  on: (event: 'request', listener: (request: PdfAssetRequest) => void) => unknown
  setContent: (html: string, options: { waitUntil: 'load' }) => Promise<unknown>
  createPDFStream: (options: { format: 'A4'; printBackground: true; preferCSSPageSize: true }) => Promise<ReadableStream<Uint8Array>>
  close: () => Promise<unknown>
}

export type PdfBrowser = {
  connected?: boolean
  newPage: () => Promise<PdfPage>
  close: () => Promise<unknown>
  on: (event: 'disconnected', listener: () => void) => unknown
  process?: () => { kill: (signal?: NodeJS.Signals) => unknown } | null
}

export type PdfBrowserLauncher = (options: {
  executablePath: string
  headless: true
  args: string[]
  timeout: number
  protocolTimeout: number
}) => Promise<PdfBrowser>

type PdfRendererOptions = {
  maxConcurrency?: number
  maxQueue?: number
  acquireTimeoutMs?: number
  renderTimeoutMs?: number
  pageCloseTimeoutMs?: number
  maxOutputBytes?: number
}

class BoundedSemaphore {
  private active = 0
  private readonly waiters: Array<{
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(
    private readonly capacity: number,
    private readonly maxQueue: number,
    private readonly acquireTimeoutMs: number,
  ) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.capacity) return this.grant()
    if (this.waiters.length >= this.maxQueue) throw new PdfRenderOverloadedError()

    return await new Promise<() => void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new PdfRenderOverloadedError())
        }, this.acquireTimeoutMs),
      }
      this.waiters.push(waiter)
    })
  }

  private grant(): () => void {
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const waiter = this.waiters.shift()
      if (!waiter) return
      clearTimeout(waiter.timer)
      waiter.resolve(this.grant())
    }
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout()
      reject(new PdfRenderTimeoutError())
    }, timeoutMs)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function readBoundedPdfStream(
  stream: ReadableStream<Uint8Array>,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      if (totalBytes + value.byteLength > maxOutputBytes) {
        await reader.cancel('PDF output exceeded its byte limit').catch(() => undefined)
        throw new PdfRenderOutputTooLargeError()
      }
      totalBytes += value.byteLength
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/**
 * A process-local, bounded Chromium supervisor. The browser is reused between
 * requests, discarded after a crash/timeout, and never launched with sandbox-
 * disabling flags. Capacity is deliberately small so PDF work cannot starve
 * the application server.
 */
export function createPdfRenderer(
  launch: PdfBrowserLauncher,
  options: PdfRendererOptions = {},
) {
  const renderTimeoutMs = options.renderTimeoutMs ?? PDF_RENDER_TIMEOUT_MS
  const pageCloseTimeoutMs = options.pageCloseTimeoutMs ?? PDF_PAGE_CLOSE_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? PDF_MAX_OUTPUT_BYTES
  const semaphore = new BoundedSemaphore(
    options.maxConcurrency ?? PDF_RENDER_MAX_CONCURRENCY,
    options.maxQueue ?? PDF_RENDER_MAX_QUEUE,
    options.acquireTimeoutMs ?? PDF_RENDER_ACQUIRE_TIMEOUT_MS,
  )
  let browserState: {
    executablePath: string
    promise: Promise<PdfBrowser>
    browser?: PdfBrowser
  } | null = null

  const terminateBrowser = async (browser: PdfBrowser): Promise<void> => {
    let closed = false
    const closePromise = browser.close().then(
      () => { closed = true },
      () => undefined,
    )
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const closeTimeout = new Promise<void>((resolve) => {
      closeTimer = setTimeout(resolve, 1_000)
    })
    await Promise.race([
      closePromise,
      closeTimeout,
    ])
    if (closeTimer) clearTimeout(closeTimer)
    if (!closed) browser.process?.()?.kill('SIGKILL')
  }

  const invalidateBrowser = (browser?: PdfBrowser): void => {
    const state = browserState
    if (!state) return
    if (browser && state.browser && state.browser !== browser) return
    if (browser && !state.browser) {
      void state.promise.then((resolved) => {
        if (resolved !== browser) return
        if (browserState?.promise === state.promise) browserState = null
        return terminateBrowser(resolved)
      }).catch(() => undefined)
      return
    }
    browserState = null
    void state.promise.then((resolved) => {
      if (!browser || browser === resolved) return terminateBrowser(resolved)
    }).catch(() => undefined)
  }

  const getBrowser = async (executablePath: string): Promise<PdfBrowser> => {
    if (browserState && browserState.executablePath !== executablePath) {
      invalidateBrowser()
    }
    if (!browserState) {
      const promise = launch({
        executablePath,
        headless: true,
        args: [],
        timeout: Math.min(renderTimeoutMs, 10_000),
        protocolTimeout: renderTimeoutMs,
      })
      browserState = { executablePath, promise }
      promise.then((browser) => {
        if (browserState?.promise === promise) browserState.browser = browser
        browser.on('disconnected', () => {
          if (browserState?.promise === promise) browserState = null
        })
      }).catch(() => {
        if (browserState?.promise === promise) browserState = null
      })
    }
    const browser = await browserState.promise
    if (browser.connected === false) {
      invalidateBrowser(browser)
      return getBrowser(executablePath)
    }
    return browser
  }

  const render = async (input: {
    html: string
    executablePath: string
    isAllowedRequest: (request: PdfAssetRequest) => boolean
  }): Promise<Uint8Array> => {
    const release = await semaphore.acquire()
    let browser: PdfBrowser | undefined
    let page: PdfPage | undefined
    try {
      const renderOperation = (async () => {
        browser = await getBrowser(input.executablePath)
        page = await browser.newPage()
        await page.setJavaScriptEnabled(false)
        await page.setRequestInterception(true)
        page.on('request', (request) => {
          // A page can disappear between interception and resolution (timeout,
          // overflow, browser crash). Never turn that normal teardown race into
          // an unhandled rejection in the app process.
          void Promise.resolve()
            .then(() => (input.isAllowedRequest(request) ? request.continue() : request.abort()))
            .catch(() => undefined)
        })
        await page.setContent(input.html, { waitUntil: 'load' })
        const pdfStream = await page.createPDFStream({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        })
        return readBoundedPdfStream(pdfStream, maxOutputBytes)
      })()
      try {
        return await withTimeout(renderOperation, renderTimeoutMs, () => invalidateBrowser(browser))
      } catch (error) {
        if (isPdfRenderOutputTooLargeError(error)) invalidateBrowser(browser)
        throw error
      }
    } finally {
      if (page) {
        let closeSettled = false
        let closeTimer: ReturnType<typeof setTimeout> | undefined
        const closePromise = page.close().then(
          () => { closeSettled = true },
          () => { closeSettled = true },
        )
        const closeTimeout = new Promise<void>((resolve) => {
          closeTimer = setTimeout(resolve, pageCloseTimeoutMs)
        })
        await Promise.race([closePromise, closeTimeout])
        if (closeTimer) clearTimeout(closeTimer)
        if (!closeSettled) invalidateBrowser(browser)
      }
      release()
    }
  }

  return {
    render,
    dispose: async () => {
      const state = browserState
      browserState = null
      if (state) await state.promise.then(terminateBrowser).catch(() => undefined)
    },
  }
}

const PDF_RENDERER_KEY = Symbol.for('open-mercato.documents.pdfRenderer')
const globalStore = globalThis as typeof globalThis & {
  [PDF_RENDERER_KEY]?: ReturnType<typeof createPdfRenderer>
}
const processPdfRenderer = globalStore[PDF_RENDERER_KEY]
  ?? (globalStore[PDF_RENDERER_KEY] = createPdfRenderer(
    (options) => puppeteer.launch(options) as unknown as Promise<PdfBrowser>,
  ))

export const renderPdfWithChromium = processPdfRenderer.render
