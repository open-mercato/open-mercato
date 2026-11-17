/** @jest-environment jsdom */

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'
import type { EntityManager } from '@mikro-orm/postgresql'
import { act, renderHook, waitFor } from '@testing-library/react'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { OrganizationScopeService } from '@open-mercato/shared/lib/auth/principal-service'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { register as registerDirectoryDi } from '../../di'
import { DefaultOrganizationScopeService } from '../organizationScopeService'

type GlobalEventTap = (
  eventName: string,
  payload: Record<string, unknown>,
  options?: { tenantId?: string | null; organizationId?: string | null },
) => void | Promise<void>

const mockResolveRequestContext = jest.fn()
let mockGlobalEventTap: GlobalEventTap | undefined

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: (...args: unknown[]) => mockResolveRequestContext(...args),
}))

jest.mock('../../../../../../events/src/bus', () => ({
  registerGlobalEventTap: (handler: GlobalEventTap) => {
    mockGlobalEventTap = handler
  },
  registerCrossProcessEventListener: jest.fn(),
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'directory-sse-integration',
}))

import { GET } from '../../../../../../events/src/modules/events/api/stream/route'
import { useEventBridge } from '../../../../../../ui/src/backend/injection/eventBridge'

createModuleEvents({
  moduleId: 'directory_sse_integration',
  events: [
    {
      id: 'directory_sse_integration.browser',
      label: 'Directory SSE integration browser event',
      clientBroadcast: true,
    },
  ] as const,
})

class TestHeaders {
  private readonly values = new Map<string, string>()

  constructor(init?: HeadersInit | TestHeaders) {
    if (!init) return
    if (init instanceof TestHeaders) {
      init.values.forEach((value, key) => this.values.set(key, value))
      return
    }
    if (Array.isArray(init)) {
      for (const [key, value] of init) this.values.set(key.toLowerCase(), String(value))
      return
    }
    if (typeof (init as Headers).forEach === 'function') {
      ;(init as Headers).forEach((value, key) => this.values.set(key.toLowerCase(), value))
      return
    }
    for (const [key, value] of Object.entries(init)) {
      this.values.set(key.toLowerCase(), String(value))
    }
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null
  }
}

class TestRequest {
  readonly url: string
  readonly method: string
  readonly headers: TestHeaders
  readonly signal: AbortSignal

  constructor(input: string | URL | TestRequest, init: RequestInit = {}) {
    const previous = input instanceof TestRequest ? input : null
    this.url = previous?.url ?? String(input)
    this.method = init.method ?? previous?.method ?? 'GET'
    this.headers = new TestHeaders(init.headers ?? previous?.headers)
    this.signal = init.signal ?? previous?.signal ?? new AbortController().signal
  }
}

class TestResponse {
  readonly body: unknown
  readonly status: number
  readonly ok: boolean
  readonly headers: TestHeaders

  constructor(body: unknown = null, init: ResponseInit = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    this.headers = new TestHeaders(init.headers)
  }
}

type StreamResponse = {
  body: ReadableStream<Uint8Array> | null
  status: number
}

class ServerBackedEventSource {
  static instances: ServerBackedEventSource[] = []

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readonly url: string
  readonly options: EventSourceInit | undefined
  readonly opened: Promise<void>
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closed = false
  private pendingText = ''

  constructor(url: string | URL, options?: EventSourceInit) {
    this.url = String(url)
    this.options = options
    ServerBackedEventSource.instances.push(this)
    this.opened = Promise.resolve().then(() => this.open())
  }

  close = jest.fn(() => {
    this.closed = true
    const reader = this.reader
    this.reader = null
    if (reader) void reader.cancel()
  })

  private async open(): Promise<void> {
    const request = new Request(`http://localhost${this.url}`, {
      headers: { cookie: document.cookie },
    })
    const response = await GET(request) as unknown as StreamResponse
    if (this.closed) {
      await response.body?.cancel()
      return
    }
    if (response.status !== 200 || !response.body) {
      this.onerror?.(new Event('error'))
      return
    }
    this.reader = response.body.getReader()
    const first = await this.reader.read()
    if (this.closed) return
    if (first.value) this.dispatchFrames(first.value)
    this.onopen?.(new Event('open'))
    void this.pump()
  }

  private async pump(): Promise<void> {
    while (!this.closed && this.reader) {
      const next = await this.reader.read()
      if (next.done || this.closed) return
      if (next.value) this.dispatchFrames(next.value)
    }
  }

  private dispatchFrames(chunk: Uint8Array): void {
    this.pendingText += new TextDecoder().decode(chunk)
    const frames = this.pendingText.split('\n\n')
    this.pendingText = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
      if (data) this.onmessage?.(new MessageEvent('message', { data }))
    }
  }
}

const ordinaryAuth = {
  sub: '00000000-0000-4000-8000-000000000001',
  tenantId: 'tenant-1',
  orgId: 'org-1',
  roles: ['staff'],
  isSuperAdmin: false,
} as AuthContext

function buildRealDirectoryHarness() {
  const organizations = [
    { id: 'org-1', descendantIds: [], tenant: 'tenant-1', deletedAt: null },
    { id: 'org-2', descendantIds: [], tenant: 'tenant-1', deletedAt: null },
  ]
  let allowedIds = ['org-1', 'org-2']
  const em = {
    find: jest.fn(async (_entity: unknown, filter: { id?: { $in?: string[] }; tenant?: string }) => {
      const requestedIds = filter.id?.$in ?? []
      return organizations.filter((organization) => (
        organization.tenant === filter.tenant && requestedIds.includes(organization.id)
      ))
    }),
  } as unknown as EntityManager
  const rbacService = {
    invalidateUserCache: jest.fn(async () => undefined),
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: false,
      features: [],
      organizations: [...allowedIds],
    })),
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
  container.register({
    em: asValue(em),
    rbacService: asValue(rbacService),
  })
  registerDirectoryDi(container)
  const organizationScopeService = container.resolve<OrganizationScopeService>('organizationScopeService')
  return {
    container,
    organizationScopeService,
    setAllowedIds(nextAllowedIds: string[]) {
      allowedIds = [...nextAllowedIds]
    },
  }
}

function makeRequest(selectedOrganizationId?: string | null): Request {
  const selectedCookie = selectedOrganizationId === undefined
    ? ''
    : `; om_selected_org=${encodeURIComponent(selectedOrganizationId ?? '')}`
  return new Request('http://localhost/api/events/stream', {
    headers: { cookie: `auth_token=staff-token${selectedCookie}` },
  })
}

describe('SSE organization scope through production Directory and UI seams', () => {
  const originalRequest = globalThis.Request
  const originalResponse = globalThis.Response
  const originalTextEncoder = globalThis.TextEncoder
  const originalTextDecoder = globalThis.TextDecoder
  const originalEventSource = window.EventSource
  const originalScopeCacheTtl = process.env.OM_ORG_SCOPE_CACHE_TTL_MS
  let harness: ReturnType<typeof buildRealDirectoryHarness>

  beforeAll(() => {
    globalThis.Request = TestRequest as unknown as typeof Request
    globalThis.Response = TestResponse as unknown as typeof Response
    globalThis.TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
    globalThis.TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
  })

  beforeEach(() => {
    process.env.OM_ORG_SCOPE_CACHE_TTL_MS = '0'
    delete process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS
    delete process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS
    document.cookie = 'om_selected_org=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    ServerBackedEventSource.instances = []
    harness = buildRealDirectoryHarness()
    mockResolveRequestContext.mockReset()
    mockResolveRequestContext.mockImplementation(async () => ({
      ctx: {
        auth: ordinaryAuth,
        container: harness.container,
      },
    }))
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS
    delete process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS
    window.EventSource = originalEventSource
  })

  afterAll(() => {
    globalThis.Request = originalRequest
    globalThis.Response = originalResponse
    globalThis.TextEncoder = originalTextEncoder
    globalThis.TextDecoder = originalTextDecoder
    if (originalScopeCacheTtl === undefined) delete process.env.OM_ORG_SCOPE_CACHE_TTL_MS
    else process.env.OM_ORG_SCOPE_CACHE_TTL_MS = originalScopeCacheTtl
  })

  it('uses the real CLASSIC registration, cookie parsing, home fallback, and rejection semantics', async () => {
    expect(harness.organizationScopeService).toBeInstanceOf(DefaultOrganizationScopeService)
    const homeScope = await harness.organizationScopeService.resolveForRequest({
      auth: ordinaryAuth,
      request: makeRequest(),
    })
    const nullSelectionScope = await harness.organizationScopeService.resolveForRequest({
      auth: ordinaryAuth,
      request: makeRequest(null),
    })
    const selectedScope = await harness.organizationScopeService.resolveForRequest({
      auth: ordinaryAuth,
      request: makeRequest(' org-2 '),
    })
    const rejectedScope = await harness.organizationScopeService.resolveForRequest({
      auth: ordinaryAuth,
      request: makeRequest('org-3'),
    })

    expect(homeScope).toMatchObject({
      tenantId: 'tenant-1',
      selectedId: 'org-1',
      allowedIds: ['org-1', 'org-2'],
    })
    expect(nullSelectionScope).toEqual(homeScope)
    expect(selectedScope).toMatchObject({
      tenantId: 'tenant-1',
      selectedId: 'org-2',
      allowedIds: ['org-1', 'org-2'],
    })
    expect(rejectedScope).toMatchObject({
      tenantId: 'tenant-1',
      allowedIds: ['org-1', 'org-2'],
      selectionRejected: true,
    })
    expect(rejectedScope.selectedId).not.toBe('org-3')

    harness.setAllowedIds(['org-1'])
    const revokedScope = await harness.organizationScopeService.resolveForRequest({
      auth: ordinaryAuth,
      request: makeRequest('org-2'),
    })
    expect(revokedScope).toMatchObject({
      tenantId: 'tenant-1',
      allowedIds: ['org-1'],
      selectionRejected: true,
    })
    expect(revokedScope.selectedId).not.toBe('org-2')
  })

  it('rejects a disallowed opening cookie and closes without resurrection when allowedIds revoke O2', async () => {
    const rejectedResponse = await GET(makeRequest('org-3'))
    expect(rejectedResponse.status).toBe(401)

    jest.useFakeTimers()
    process.env.OM_EVENTS_SSE_AUTH_REVALIDATION_INTERVAL_MS = '1000'
    process.env.OM_EVENTS_SSE_CONNECTION_MAX_AGE_MS = '10000'
    const response = await GET(makeRequest('org-2')) as unknown as StreamResponse
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    await reader.read()

    harness.setAllowedIds(['org-1'])
    await jest.advanceTimersByTimeAsync(1000)
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })

    await mockGlobalEventTap?.(
      'directory_sse_integration.browser',
      { tenantId: 'tenant-1', organizationId: 'org-2', marker: 'revoked' },
    )
    await jest.advanceTimersByTimeAsync(5000)

    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(mockResolveRequestContext).toHaveBeenCalledTimes(3)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('uses the real UI scope event to replace O1 with O2 and isolates delivery to the new stream', async () => {
    window.EventSource = ServerBackedEventSource as unknown as typeof EventSource
    document.cookie = 'om_selected_org=org-1; path=/'
    const received: Array<{ id: string; payload: Record<string, unknown> }> = []
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; payload: Record<string, unknown> }>).detail
      if (detail.id === 'directory_sse_integration.browser') received.push(detail)
    }
    window.addEventListener('om:event', listener)
    const { unmount } = renderHook(() => useEventBridge())

    await waitFor(() => expect(ServerBackedEventSource.instances).toHaveLength(1))
    const openingSource = ServerBackedEventSource.instances[0]
    await openingSource.opened
    await act(async () => {
      await mockGlobalEventTap?.(
        'directory_sse_integration.browser',
        { tenantId: 'tenant-1', organizationId: 'org-1', marker: 'before-switch' },
      )
    })
    await waitFor(() => expect(received.map((event) => event.payload.marker)).toContain('before-switch'))

    document.cookie = 'om_selected_org=org-2; path=/'
    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-2', tenantId: 'tenant-1' })
    })
    await waitFor(() => expect(ServerBackedEventSource.instances).toHaveLength(2))
    const replacementSource = ServerBackedEventSource.instances[1]
    await replacementSource.opened
    expect(openingSource.close).toHaveBeenCalledTimes(1)

    await act(async () => {
      await mockGlobalEventTap?.(
        'directory_sse_integration.browser',
        { tenantId: 'tenant-1', organizationId: 'org-1', marker: 'old-scope-after-switch' },
      )
      await mockGlobalEventTap?.(
        'directory_sse_integration.browser',
        { tenantId: 'tenant-1', organizationId: 'org-2', marker: 'new-scope-after-switch' },
      )
    })
    await waitFor(() => expect(received.map((event) => event.payload.marker)).toContain('new-scope-after-switch'))
    expect(received.map((event) => event.payload.marker)).not.toContain('old-scope-after-switch')

    unmount()
    window.removeEventListener('om:event', listener)
    expect(replacementSource.close).toHaveBeenCalledTimes(1)
  })
})
