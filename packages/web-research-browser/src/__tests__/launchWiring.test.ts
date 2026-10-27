import { connect as netConnect } from 'node:net'
import { createState, dispatch, teardown, type SidecarState } from '../dispatch'
import * as egressProxyModule from '../egressProxy'
import {
  LAUNCH_ARGS,
  RESOLVER_LOCKDOWN_ARGS,
  type BrowserHandle,
  type BrowserType,
  type ContextHandle,
  type LaunchOptions,
  type RouteHandle,
} from '../playwright'

const FILTER_ENV = 'OM_WEB_RESEARCH_BROWSER_FILTER_SUBRESOURCES'
const PUBLIC_PAGE = 'https://93.184.216.34/'

type FakeBrowserType = BrowserType & { launches: LaunchOptions[] }

function fakeBrowser(): BrowserHandle {
  const page = {
    goto: async () => undefined,
    content: async () => '<html></html>',
    url: () => PUBLIC_PAGE,
    close: async () => undefined,
  }
  const context: ContextHandle = {
    newPage: async () => page,
    close: async () => undefined,
    route: async (_pattern: string, _handler: (route: RouteHandle) => Promise<void> | void) => undefined,
  }
  return { newContext: async () => context, close: async () => undefined }
}

function fakeBrowserType(launch?: (options: LaunchOptions) => Promise<BrowserHandle>): FakeBrowserType {
  const type: FakeBrowserType = {
    launches: [],
    async launch(options = {}) {
      type.launches.push(options)
      if (launch) return launch(options)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return fakeBrowser()
    },
  }
  return type
}

function render(state: SidecarState, leaseId: string) {
  return dispatch(state, { id: `render-${leaseId}`, method: 'render', params: { url: PUBLIC_PAGE, leaseId } })
}

function proxyAccepts(url: string): Promise<boolean> {
  const { port } = new URL(url)
  return new Promise((resolve) => {
    const probe = netConnect({ host: '127.0.0.1', port: Number(port) })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
}

describe('browser launch wiring (#7218)', () => {
  const savedFilter = process.env[FILTER_ENV]
  const states: SidecarState[] = []

  const stateWith = (overrides: Partial<SidecarState>): SidecarState => {
    const state = createState({ warn: () => undefined, ...overrides })
    states.push(state)
    return state
  }

  beforeEach(() => {
    delete process.env[FILTER_ENV]
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    for (const state of states.splice(0)) await teardown(state)
  })

  afterAll(() => {
    if (savedFilter === undefined) delete process.env[FILTER_ENV]
    else process.env[FILTER_ENV] = savedFilter
  })

  it('launches Chromium through a live egress proxy with loopback not bypassed and UDP restricted', async () => {
    const browserType = fakeBrowserType()
    const state = stateWith({ loadBrowserType: async () => browserType })

    expect((await render(state, 'lease-1')).ok).toBe(true)

    expect(browserType.launches).toHaveLength(1)
    const options = browserType.launches[0]
    expect(options?.proxy).toEqual({ server: state.egressProxy?.url, bypass: '<-loopback>' })
    expect(options?.proxy?.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await proxyAccepts(String(options?.proxy?.server))).toBe(true)
    expect(options?.args).toEqual(
      expect.arrayContaining([
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-quic',
        ...RESOLVER_LOCKDOWN_ARGS,
      ]),
    )
    expect(LAUNCH_ARGS).not.toEqual(expect.arrayContaining(RESOLVER_LOCKDOWN_ARGS))
  })

  it('launches again on the next render after a failed launch', async () => {
    let attempts = 0
    const browserType = fakeBrowserType(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Target page crashed')
      return fakeBrowser()
    })
    const state = stateWith({ loadBrowserType: async () => browserType })

    expect((await render(state, 'lease-1')).ok).toBe(false)
    expect((await render(state, 'lease-2')).ok).toBe(true)

    expect(browserType.launches).toHaveLength(2)
    expect(await proxyAccepts(String(state.egressProxy?.url))).toBe(true)
  })

  it('closes the proxy it tore down, not one a concurrent render started meanwhile', async () => {
    let releaseClose: () => void = () => undefined
    const closing = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    let launches = 0
    const browserType = fakeBrowserType(async () => {
      launches += 1
      const browser = fakeBrowser()
      if (launches === 1) return { ...browser, close: () => closing }
      return browser
    })
    const state = stateWith({ loadBrowserType: async () => browserType })
    await render(state, 'lease-1')
    const firstProxy = String(state.egressProxy?.url)

    const tearingDown = teardown(state)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await render(state, 'lease-2')).ok).toBe(true)
    const secondProxy = String(state.egressProxy?.url)
    releaseClose()
    await tearingDown

    expect(secondProxy).not.toBe(firstProxy)
    expect(await proxyAccepts(firstProxy)).toBe(false)
    expect(await proxyAccepts(secondProxy)).toBe(true)
  })

  it('does not launch when the egress proxy cannot start', async () => {
    jest.spyOn(egressProxyModule, 'startEgressProxy').mockRejectedValueOnce(new Error('EADDRNOTAVAIL'))
    const browserType = fakeBrowserType()
    const state = stateWith({ loadBrowserType: async () => browserType })

    const reply = await render(state, 'lease-1')

    expect(reply.ok).toBe(false)
    expect(browserType.launches).toHaveLength(0)
    expect(state.browser).toBeNull()
  })

  it('closes the egress proxy when the launch fails', async () => {
    const browserType = fakeBrowserType(async () => {
      throw new Error('Target page crashed')
    })
    const state = stateWith({ loadBrowserType: async () => browserType })

    const reply = await render(state, 'lease-1')

    expect(reply.ok).toBe(false)
    const server = browserType.launches[0]?.proxy?.server
    expect(server).toBeDefined()
    expect(await proxyAccepts(String(server))).toBe(false)
    expect(state.egressProxy ?? null).toBeNull()
  })

  it('closes the egress proxy on teardown', async () => {
    const state = stateWith({ loadBrowserType: async () => fakeBrowserType() })
    await render(state, 'lease-1')
    const server = String(state.egressProxy?.url)
    expect(await proxyAccepts(server)).toBe(true)

    await teardown(state)

    expect(await proxyAccepts(server)).toBe(false)
    expect(state.egressProxy).toBeNull()
  })

  it('launches once when two leases open concurrently', async () => {
    const browserType = fakeBrowserType()
    const state = stateWith({ loadBrowserType: async () => browserType })

    const replies = await Promise.all([render(state, 'lease-a'), render(state, 'lease-b')])

    expect(replies.map((reply) => reply.ok)).toEqual([true, true])
    expect(browserType.launches).toHaveLength(1)
  })

  it.each(['0', '1'])('warns that the filter env var set to %s is ignored', async (value) => {
    process.env[FILTER_ENV] = value
    const warnings: string[] = []
    const state = stateWith({ loadBrowserType: async () => fakeBrowserType(), warn: (line) => warnings.push(line) })

    await render(state, 'lease-1')
    await render(state, 'lease-2')

    const notices = warnings.filter((line) => line.includes(FILTER_ENV))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('always on')
  })

  it('does not warn about the filter env var when it is unset', async () => {
    const warnings: string[] = []
    const state = stateWith({ loadBrowserType: async () => fakeBrowserType(), warn: (line) => warnings.push(line) })

    await render(state, 'lease-1')

    expect(warnings.filter((line) => line.includes(FILTER_ENV))).toEqual([])
  })
})
