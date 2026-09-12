/** @jest-environment node */
/**
 * EP-07 — the sync lifecycle subscriber host on the time-tracking write pipeline.
 *
 * EP-02 gave the seven factory resources an `events:` config, which is the only thing
 * `deriveLifecycleEventIds` needs to resolve; without it `runSyncBeforeEvent` /
 * `runSyncAfterEvent` returned early and no sync subscriber could ever run. That is a
 * silent capability — nothing fails when it is absent — so it is pinned here by
 * driving the real `/api/staff/timesheets/time-entries` handlers.
 *
 * What is proved: a registered sync subscriber sees the create in the `before` phase,
 * can veto it with its own status before the command runs, and can rewrite the
 * command input through `modifiedPayload`. The delete path is proved too, because it
 * behaves differently from create and update and a subscriber author has no way to
 * discover that from the types.
 */

import { registerSyncSubscribers } from '@open-mercato/shared/lib/crud/sync-subscriber-store'
import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'

const mockCommandExecute = jest.fn()
const mockGetAuthFromRequest = jest.fn()

const em = {
  findOne: jest.fn(async () => null),
  find: jest.fn(async () => []),
  fork: () => em,
}

const container = {
  resolve: (token: string) => {
    if (token === 'commandBus') return { execute: mockCommandExecute }
    if (token === 'em') return em
    return undefined
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
  getAuthFromCookies: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

type SubscriberCall = {
  eventId: string
  entity: string
  operation: string
  timing: string
  resourceId: string | null | undefined
  payload: Record<string, unknown> | undefined
  tenantId: string
  organizationId: string | null
}

const calls: SubscriberCall[] = []
let respondWith: (payload: SyncCrudEventPayload) => SyncCrudEventResult | void = () => undefined
const order: string[] = []

function recordingSubscriber(event: string, id: string, priority?: number) {
  return {
    metadata: { event, sync: true as const, priority, id },
    handler: async (payload: SyncCrudEventPayload): Promise<SyncCrudEventResult | void> => {
      order.push(id)
      calls.push({
        eventId: payload.eventId,
        entity: payload.entity,
        operation: payload.operation,
        timing: payload.timing,
        resourceId: payload.resourceId,
        payload: payload.payload,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
      })
      return respondWith(payload)
    },
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    staffMemberId: MEMBER_ID,
    date: '2026-08-24',
    durationMinutes: 60,
    notes: 'Cart migration',
    ...overrides,
  }
}

function jsonRequest(method: string, body?: Record<string, unknown>, query = '') {
  return new Request(`https://example.test/api/staff/timesheets/time-entries${query}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('time-tracking sync lifecycle subscribers', () => {
  let POST: (request: Request) => Promise<Response>
  let PUT: (request: Request) => Promise<Response>
  let DELETE: (request: Request) => Promise<Response>

  beforeAll(async () => {
    const route = await import('../api/timesheets/time-entries/route')
    POST = route.POST as unknown as (request: Request) => Promise<Response>
    PUT = route.PUT as unknown as (request: Request) => Promise<Response>
    DELETE = route.DELETE as unknown as (request: Request) => Promise<Response>
  })

  beforeEach(() => {
    jest.clearAllMocks()
    calls.length = 0
    order.length = 0
    respondWith = () => undefined
    registerSyncSubscribers([])
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
    mockCommandExecute.mockResolvedValue({ result: { timeEntryId: ENTRY_ID }, logEntry: null })
    em.findOne.mockResolvedValue(null)
  })

  afterAll(() => {
    registerSyncSubscribers([])
  })

  it('dispatches the before phase of a create to a subscriber on the derived id', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.creating'),
    ])

    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      eventId: 'staff.timesheets.time_entry.creating',
      entity: 'staff.timesheets.time_entry',
      operation: 'create',
      timing: 'before',
      resourceId: null,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    // The payload is the MAPPED command input, not the raw request body: `mapInput`
    // has already run `parseScopedCommandInput`, so the scope fields are present and
    // the dates are coerced.
    expect(calls[0].payload).toMatchObject({
      staffMemberId: MEMBER_ID,
      durationMinutes: 60,
      notes: 'Cart migration',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('runs the after phase once the command committed, with the new record id', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.created', 'test.created'),
    ])

    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(201)
    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ timing: 'after', operation: 'create' })
  })

  it('blocks the write with the subscriber status and never runs the command', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.veto'),
    ])
    respondWith = () => ({ ok: false, status: 409, message: 'Accounting period is closed' })

    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'Accounting period is closed' })
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('defaults a veto to 422 and names the subscriber that raised it', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.default-veto'),
    ])
    respondWith = () => ({ ok: false })

    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ subscriberId: 'test.default-veto' })
  })

  it('persists a modifiedPayload into the command input on create', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.modify'),
    ])
    respondWith = () => ({ modifiedPayload: { timeProjectId: PROJECT_ID, isBillable: false } })

    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(201)
    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    const [commandId, execution] = mockCommandExecute.mock.calls[0]
    expect(commandId).toBe('staff.timesheets.time_entries.create')
    expect(execution.input).toMatchObject({
      staffMemberId: MEMBER_ID,
      timeProjectId: PROJECT_ID,
      isBillable: false,
    })
  })

  it('persists a modifiedPayload into the command input on update', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.updating', 'test.modify-update'),
    ])
    respondWith = () => ({ modifiedPayload: { notes: 'stamped by the subscriber' } })
    mockCommandExecute.mockResolvedValue({ result: { ok: true }, logEntry: null })

    const response = await PUT(jsonRequest('PUT', { id: ENTRY_ID, durationMinutes: 30 }))

    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({
      eventId: 'staff.timesheets.time_entry.updating',
      operation: 'update',
      timing: 'before',
      resourceId: ENTRY_ID,
    })
    const [, execution] = mockCommandExecute.mock.calls[0]
    expect(execution.input).toMatchObject({ id: ENTRY_ID, notes: 'stamped by the subscriber' })
  })

  it('runs subscribers in ascending priority order', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.late', 90),
      recordingSubscriber('staff.timesheets.time_entry.creating', 'test.early', 10),
      recordingSubscriber('staff.timesheets.*.creating', 'test.default-priority'),
    ])

    await POST(jsonRequest('POST', createBody()))

    expect(order).toEqual(['test.early', 'test.default-priority', 'test.late'])
  })

  it('matches a wildcard subscription across the time-tracking family', async () => {
    registerSyncSubscribers([recordingSubscriber('staff.timesheets.*.creating', 'test.wildcard')])

    await POST(jsonRequest('POST', createBody()))

    expect(calls).toHaveLength(1)
    expect(calls[0].eventId).toBe('staff.timesheets.time_entry.creating')
  })

  it('vetoes a delete, but carries no payload and honours no modifiedPayload', async () => {
    registerSyncSubscribers([
      recordingSubscriber('staff.timesheets.time_entry.deleting', 'test.delete'),
    ])
    respondWith = () => ({ modifiedPayload: { id: 'a-different-entry' } })
    mockCommandExecute.mockResolvedValue({ result: { ok: true }, logEntry: null })

    const allowed = await DELETE(jsonRequest('DELETE', undefined, `?id=${ENTRY_ID}`))

    expect(allowed.status).toBe(200)
    expect(calls[0]).toMatchObject({
      eventId: 'staff.timesheets.time_entry.deleting',
      operation: 'delete',
      timing: 'before',
      resourceId: ENTRY_ID,
    })
    // The delete branch builds its sync payload without mutation data at all, and
    // never merges a `modifiedPayload` back — so the command still deletes the id the
    // request named.
    expect(calls[0].payload).toBeUndefined()
    const [, execution] = mockCommandExecute.mock.calls[0]
    expect(execution.input).toMatchObject({ id: ENTRY_ID })

    calls.length = 0
    mockCommandExecute.mockClear()
    respondWith = () => ({ ok: false, status: 423, message: 'Entry is locked into a closed report' })

    const blocked = await DELETE(jsonRequest('DELETE', undefined, `?id=${ENTRY_ID}`))

    expect(blocked.status).toBe(423)
    await expect(blocked.json()).resolves.toMatchObject({ error: 'Entry is locked into a closed report' })
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })

  it('leaves the write untouched when nothing subscribes', async () => {
    const response = await POST(jsonRequest('POST', createBody()))

    expect(response.status).toBe(201)
    expect(calls).toHaveLength(0)
    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
  })
})
