jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: { launch: jest.fn() },
}))

import {
  createPdfRenderer,
  PdfRenderOutputTooLargeError,
  PdfRenderOverloadedError,
  PdfRenderTimeoutError,
  type PdfBrowser,
  type PdfBrowserLauncher,
  type PdfAssetRequest,
  type PdfPage,
} from '../lib/pdfRenderer'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function makePage(pdf: () => Promise<ReadableStream<Uint8Array>>): PdfPage {
  return {
    setJavaScriptEnabled: jest.fn(async () => undefined),
    setRequestInterception: jest.fn(async () => undefined),
    on: jest.fn(),
    setContent: jest.fn(async () => undefined),
    createPDFStream: jest.fn(pdf),
    close: jest.fn(async () => undefined),
  }
}

function makeBrowser(pageFactory: () => PdfPage): PdfBrowser {
  return {
    connected: true,
    newPage: jest.fn(async () => pageFactory()),
    close: jest.fn(async () => undefined),
    on: jest.fn(),
    process: jest.fn(() => ({ kill: jest.fn() })),
  }
}

const renderInput = {
  html: '<p>Safe</p>',
  executablePath: '/usr/bin/chromium',
  isAllowedRequest: () => false,
}

describe('process-local PDF renderer', () => {
  it('reuses one sandboxed browser and creates an isolated page per export', async () => {
    const page = makePage(async () => streamOf(new Uint8Array([1, 2, 3])))
    const browser = makeBrowser(() => page)
    const launch = jest.fn(async () => browser) as PdfBrowserLauncher
    const renderer = createPdfRenderer(launch)

    await expect(renderer.render(renderInput)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await expect(renderer.render(renderInput)).resolves.toEqual(new Uint8Array([1, 2, 3]))

    expect(launch).toHaveBeenCalledTimes(1)
    expect(browser.newPage).toHaveBeenCalledTimes(2)
    expect(page.createPDFStream).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      args: [],
      headless: true,
    }))
    expect(JSON.stringify(launch.mock.calls[0]?.[0])).not.toMatch(/no-sandbox|disable-setuid-sandbox/)
    await renderer.dispose()
  })

  it('rejects work beyond the bounded concurrency and queue capacity', async () => {
    const pending = deferred<ReadableStream<Uint8Array>>()
    const entered = deferred<void>()
    const page = makePage(async () => {
      entered.resolve()
      return pending.promise
    })
    const renderer = createPdfRenderer(
      async () => makeBrowser(() => page),
      { maxConcurrency: 1, maxQueue: 0, renderTimeoutMs: 1_000 },
    )

    const first = renderer.render(renderInput)
    await entered.promise
    await expect(renderer.render(renderInput)).rejects.toBeInstanceOf(PdfRenderOverloadedError)
    pending.resolve(streamOf(new Uint8Array([1])))
    await expect(first).resolves.toEqual(new Uint8Array([1]))
    await renderer.dispose()
  })

  it('times out queued acquisition instead of retaining an unbounded waiter', async () => {
    const pending = deferred<ReadableStream<Uint8Array>>()
    const entered = deferred<void>()
    const renderer = createPdfRenderer(
      async () => makeBrowser(() => makePage(async () => {
        entered.resolve()
        return pending.promise
      })),
      {
        maxConcurrency: 1,
        maxQueue: 1,
        acquireTimeoutMs: 10,
        renderTimeoutMs: 1_000,
      },
    )

    const first = renderer.render(renderInput)
    await entered.promise
    await expect(renderer.render(renderInput)).rejects.toBeInstanceOf(PdfRenderOverloadedError)
    pending.resolve(streamOf(new Uint8Array([1])))
    await first
    await renderer.dispose()
  })

  it('retains render capacity until page teardown settles', async () => {
    const closePending = deferred<void>()
    const closeStarted = deferred<void>()
    const page = makePage(async () => streamOf(new Uint8Array([1])))
    page.close = jest.fn(async () => {
      closeStarted.resolve()
      return closePending.promise
    })
    const renderer = createPdfRenderer(
      async () => makeBrowser(() => page),
      { maxConcurrency: 1, maxQueue: 0, pageCloseTimeoutMs: 1_000 },
    )
    const first = renderer.render(renderInput)
    await closeStarted.promise

    await expect(renderer.render(renderInput)).rejects.toBeInstanceOf(PdfRenderOverloadedError)
    closePending.resolve()
    await expect(first).resolves.toEqual(new Uint8Array([1]))
    await renderer.dispose()
  })

  it('invalidates a browser after a render deadline and relaunches next time', async () => {
    const firstBrowser = makeBrowser(() => makePage(async () => new Promise<ReadableStream<Uint8Array>>(() => undefined)))
    const secondBrowser = makeBrowser(() => makePage(async () => streamOf(new Uint8Array([2]))))
    const launch = jest.fn()
      .mockResolvedValueOnce(firstBrowser)
      .mockResolvedValueOnce(secondBrowser) as PdfBrowserLauncher
    const renderer = createPdfRenderer(launch, { renderTimeoutMs: 10 })

    await expect(renderer.render(renderInput)).rejects.toBeInstanceOf(PdfRenderTimeoutError)
    await expect(renderer.render(renderInput)).resolves.toEqual(new Uint8Array([2]))
    expect(launch).toHaveBeenCalledTimes(2)
    expect(firstBrowser.close).toHaveBeenCalled()
    await renderer.dispose()
  })

  it('cancels an oversized PDF stream and invalidates Chromium before materialization', async () => {
    const cancelled = jest.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
      },
      cancel: cancelled,
    })
    const browser = makeBrowser(() => makePage(async () => stream))
    const renderer = createPdfRenderer(
      async () => browser,
      { maxOutputBytes: 5 },
    )

    await expect(renderer.render(renderInput)).rejects.toBeInstanceOf(PdfRenderOutputTooLargeError)
    expect(cancelled).toHaveBeenCalledWith('PDF output exceeded its byte limit')
    expect(browser.close).toHaveBeenCalled()
    await renderer.dispose()
  })

  it('swallows continue and abort rejection during page teardown races', async () => {
    let requestListener: ((request: PdfAssetRequest) => void) | undefined
    const allowed = {
      url: () => 'data:image/png;base64,allowed',
      resourceType: () => 'image',
      isNavigationRequest: () => false,
      continue: jest.fn(async () => { throw new Error('page already closed') }),
      abort: jest.fn(async () => undefined),
    }
    const blocked = {
      url: () => 'https://attacker.example/image.png',
      resourceType: () => 'image',
      isNavigationRequest: () => false,
      continue: jest.fn(async () => undefined),
      abort: jest.fn(async () => { throw new Error('session closed') }),
    }
    const page = makePage(async () => streamOf(new Uint8Array([1])))
    page.on = jest.fn((_event, listener) => { requestListener = listener })
    page.setContent = jest.fn(async () => {
      requestListener?.(allowed)
      requestListener?.(blocked)
      await Promise.resolve()
    })
    const renderer = createPdfRenderer(async () => makeBrowser(() => page))

    await expect(renderer.render({
      ...renderInput,
      isAllowedRequest: (request) => request === allowed,
    })).resolves.toEqual(new Uint8Array([1]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(allowed.continue).toHaveBeenCalled()
    expect(blocked.abort).toHaveBeenCalled()
    await renderer.dispose()
  })
})
