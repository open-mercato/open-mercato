import type { LookupFn } from '@open-mercato/web-research'
import { createState, dispatch } from '../dispatch'
import { installNavigationGuard, type BrowserHandle, type ContextHandle, type RouteHandle } from '../playwright'
import { SidecarError } from '../protocol'

type RouteHandler = (route: RouteHandle) => Promise<void> | void

type GuardedContext = ContextHandle & {
  handler(): RouteHandler | undefined
}

const FILTER_ENV = 'OM_WEB_RESEARCH_BROWSER_FILTER_SUBRESOURCES'
const PUBLIC_PAGE = 'https://93.184.216.34/'
const METADATA = 'http://169.254.169.254/latest/meta-data/'
const LOOPBACK = 'http://127.0.0.1:5432/'

function fakeContext(): GuardedContext {
  let routeHandler: RouteHandler | undefined
  return {
    newPage: async () => ({}),
    close: async () => undefined,
    route: async (_pattern: string, handler: RouteHandler) => {
      routeHandler = handler
    },
    handler: () => routeHandler,
  }
}

async function settle(handler: RouteHandler | undefined, url: string, isNavigation: boolean): Promise<string> {
  if (!handler) throw new Error('[internal] no route handler was installed')
  let outcome = 'pending'
  await handler({
    request: () => ({ url: () => url, isNavigationRequest: () => isNavigation }),
    abort: async () => {
      outcome = 'abort'
    },
    continue: async () => {
      outcome = 'continue'
    },
  })
  return outcome
}

type RenderFixture = {
  browser: BrowserHandle
  context: GuardedContext
  contextOptions: Array<Record<string, unknown> | undefined>
  subresourceOutcomes: string[]
  contentReads: () => number
}

function renderFixture(finalUrl: string = PUBLIC_PAGE): RenderFixture {
  const contextOptions: Array<Record<string, unknown> | undefined> = []
  const context = fakeContext()
  const subresourceOutcomes: string[] = []
  let reads = 0
  const page = {
    goto: async () => {
      subresourceOutcomes.push(await settle(context.handler(), METADATA, false))
    },
    content: async () => {
      reads += 1
      return '<html><body>page</body></html>'
    },
    url: () => finalUrl,
    close: async () => undefined,
  }
  context.newPage = async () => page
  const browser: BrowserHandle = {
    newContext: async (options) => {
      contextOptions.push(options)
      return context
    },
    close: async () => undefined,
  }
  return { browser, context, contextOptions, subresourceOutcomes, contentReads: () => reads }
}

describe('browser request guard (#7218)', () => {
  const savedFilter = process.env[FILTER_ENV]

  beforeEach(() => {
    delete process.env[FILTER_ENV]
  })

  afterAll(() => {
    if (savedFilter === undefined) delete process.env[FILTER_ENV]
    else process.env[FILTER_ENV] = savedFilter
  })

  it('still blocks a private navigation and allows a public one', async () => {
    const context = fakeContext()
    await installNavigationGuard(context)

    expect(await settle(context.handler(), METADATA, true)).toBe('abort')
    expect(await settle(context.handler(), PUBLIC_PAGE, true)).toBe('continue')
  })

  it('blocks private subresources with default options', async () => {
    const context = fakeContext()
    await installNavigationGuard(context)

    expect(await settle(context.handler(), METADATA, false)).toBe('abort')
    expect(await settle(context.handler(), LOOPBACK, false)).toBe('abort')
    expect(await settle(context.handler(), 'https://93.184.216.34/app.js', false)).toBe('continue')
  })

  it('ignores the deprecated filterSubresources: false option', async () => {
    const context = fakeContext()
    await installNavigationGuard(context, { filterSubresources: false })

    expect(await settle(context.handler(), METADATA, false)).toBe('abort')
  })

  it('blocks a private subresource of a rendered page in the default sidecar configuration', async () => {
    const fixture = renderFixture()
    const state = createState({ browser: fixture.browser, warn: () => undefined })

    const reply = await dispatch(state, {
      id: 'render-1',
      method: 'render',
      params: { url: PUBLIC_PAGE, leaseId: 'lease-1' },
    })

    expect(reply.ok).toBe(true)
    expect(fixture.subresourceOutcomes).toEqual(['abort'])
    expect(fixture.contextOptions[0]).toMatchObject({ serviceWorkers: 'block' })
  })

  it.each(['0', '1'])('ignores the filter env var set to %s and still filters subresources', async (value) => {
    process.env[FILTER_ENV] = value
    const fixture = renderFixture()
    const state = createState({ browser: fixture.browser, warn: () => undefined })

    const reply = await dispatch(state, {
      id: 'render-env',
      method: 'render',
      params: { url: PUBLIC_PAGE, leaseId: 'lease-env' },
    })

    expect(reply.ok).toBe(true)
    expect(fixture.subresourceOutcomes).toEqual(['abort'])
  })

  it('refuses a render whose page ended on a non-public URL and returns no html', async () => {
    const fixture = renderFixture('http://127.0.0.1:8080/admin')
    const state = createState({ browser: fixture.browser, warn: () => undefined })

    const reply = await dispatch(state, {
      id: 'render-final',
      method: 'render',
      params: { url: PUBLIC_PAGE, leaseId: 'lease-final' },
    })

    expect(reply.ok).toBe(false)
    if (reply.ok) return
    expect(reply.error.kind).toBe('navigation')
    expect(JSON.stringify(reply)).not.toContain('<html')
    expect(fixture.contentReads()).toBe(0)
  })

  it('aborts a request whose URL cannot be parsed instead of letting it through', async () => {
    const context = fakeContext()
    await installNavigationGuard(context)

    expect(await settle(context.handler(), 'http://[::1', false)).toBe('abort')
    expect(await settle(context.handler(), 'http://[::1', true)).toBe('abort')
  })

  it('fails closed when request interception cannot be installed', async () => {
    const context: ContextHandle = { newPage: async () => ({}), close: async () => undefined }

    const error = await installNavigationGuard(context, { warn: () => undefined }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SidecarError)
    expect((error as SidecarError).kind).toBe('init')
  })

  it('caches a blocked subresource verdict even if the name later resolves publicly', async () => {
    const answers = ['10.0.0.7', '93.184.216.34']
    const lookup: LookupFn = jest.fn(async () => [{ address: answers.shift() ?? '93.184.216.34', family: 4 }])
    const context = fakeContext()
    await installNavigationGuard(context, { lookup })

    expect(await settle(context.handler(), 'https://flip.test/a.js', false)).toBe('abort')
    expect(await settle(context.handler(), 'https://flip.test/b.js', false)).toBe('abort')
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('re-vets navigations instead of caching them', async () => {
    const answers = ['93.184.216.34', '10.0.0.7']
    const lookup: LookupFn = jest.fn(async () => [{ address: answers.shift() ?? '10.0.0.7', family: 4 }])
    const context = fakeContext()
    await installNavigationGuard(context, { lookup })

    expect(await settle(context.handler(), 'https://flip.test/', true)).toBe('continue')
    expect(await settle(context.handler(), 'https://flip.test/', true)).toBe('abort')
    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
