/** @jest-environment node */

import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'

jest.mock('@open-mercato/shared/modules/events', () => ({
  getDeclaredEvents: jest.fn(),
}))

import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import handleDispatch from '../subscribers/auto-incident-dispatch'
import {
  IncidentEscalationPolicy,
  IncidentSeverity,
  IncidentTrigger,
  IncidentType,
} from '../data/entities'
import type { IncidentCreateInput } from '../data/validators'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCIDENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SEVERITY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SEVERITY_CRITICAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const TYPE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const TYPE_SECURITY_ID = '11111111-1111-4111-8111-111111111111'
const POLICY_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = 'catalog.product.updated'

type TriggerShape = {
  id: string
  organizationId: string
  tenantId: string
  eventId: string
  isEnabled: boolean
  severityKey: string | null
  typeKey: string | null
  escalationPolicyId: string | null
  conditions: Array<{ path: string; equals: string | number | boolean }> | null
}

type MockState = {
  triggers?: TriggerShape[]
}

type CommandExecuteOptions = {
  input: unknown
  ctx: unknown
}

type MockCommandBus = {
  execute: jest.Mock<Promise<{ result: unknown }>, [string, CommandExecuteOptions]>
}

function declaredEvents(events: Array<{ id: string; label: string; excludeFromTriggers?: boolean }> = []) {
  ;(getDeclaredEvents as jest.Mock).mockReturnValue(events)
}

function buildTrigger(overrides: Partial<TriggerShape> = {}): TriggerShape {
  return {
    id: 'trigger-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    eventId: EVENT_ID,
    isEnabled: true,
    severityKey: 'sev2',
    typeKey: 'operational',
    escalationPolicyId: null,
    conditions: null,
    ...overrides,
  }
}

function buildMockEm(state: MockState = {}) {
  const handlerEm = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== IncidentTrigger) return []
      return (state.triggers ?? [buildTrigger()]).filter((trigger) =>
        trigger.organizationId === where.organizationId &&
        trigger.tenantId === where.tenantId &&
        trigger.eventId === where.eventId,
      )
    }),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === IncidentSeverity) {
        if (where.key === 'sev1') return { id: SEVERITY_CRITICAL_ID, key: 'sev1' }
        if (where.key === 'sev2') return { id: SEVERITY_ID, key: 'sev2' }
        if (where.isDefault === true) return { id: SEVERITY_ID, key: 'sev2' }
        return { id: SEVERITY_ID, key: 'sev2' }
      }
      if (entity === IncidentType) {
        if (where.key === 'security') return { id: TYPE_SECURITY_ID, key: 'security' }
        if (where.key === 'operational') return { id: TYPE_ID, key: 'operational' }
        if (where.isDefault === true) return { id: TYPE_ID, key: 'operational' }
        return { id: TYPE_ID, key: 'operational' }
      }
      if (entity === IncidentEscalationPolicy) {
        if (where.id === POLICY_ID) return { id: POLICY_ID, key: 'policy' }
        return null
      }
      return null
    }),
    fork: jest.fn(function fork() {
      return this
    }),
  }
  const rootEm = {
    fork: jest.fn(() => handlerEm),
  }
  return { rootEm: rootEm as unknown as EntityManager, handlerEm }
}

function buildCommandBus(): MockCommandBus {
  return {
    execute: jest.fn(async (commandId: string) => {
      if (commandId === 'incidents.incident.create') return { result: { incidentId: INCIDENT_ID } }
      return { result: { incidentId: INCIDENT_ID } }
    }),
  }
}

function buildCtx(em: EntityManager, commandBus: MockCommandBus) {
  const resolve = jest.fn(<T,>(name: string): T => {
    if (name === 'em') return em as T
    if (name === 'commandBus') return commandBus as T
    throw new Error(`[internal] unexpected resolve(${name})`)
  })
  return { resolve }
}

function scopedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    id: 'record-1',
    ...overrides,
  }
}

function getCreateInput(commandBus: MockCommandBus): IncidentCreateInput {
  const call = commandBus.execute.mock.calls.find(([commandId]) => commandId === 'incidents.incident.create')
  if (!call) throw new Error('[internal] create command was not called')
  return call[1].input as IncidentCreateInput
}

describe('incidents wildcard auto-incident dispatch subscriber', () => {
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    declaredEvents([{ id: EVENT_ID, label: 'Product Updated' }])
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    jest.clearAllMocks()
  })

  it.each([
    { name: 'ctx.eventId', ctxEvent: { eventId: 'catalog.product.created' }, payloadEvent: {}, expected: 'catalog.product.created' },
    { name: 'ctx.eventName', ctxEvent: { eventName: 'catalog.product.deleted' }, payloadEvent: {}, expected: 'catalog.product.deleted' },
    { name: 'payload.eventId', ctxEvent: {}, payloadEvent: { eventId: 'catalog.product.restored' }, expected: 'catalog.product.restored' },
    { name: 'payload.type', ctxEvent: {}, payloadEvent: { type: 'catalog.product.archived' }, expected: 'catalog.product.archived' },
  ])('resolves event id from $name', async ({ ctxEvent, payloadEvent, expected }) => {
    declaredEvents([{ id: expected, label: 'Resolved Event' }])
    const { rootEm, handlerEm } = buildMockEm({ triggers: [buildTrigger({ eventId: expected })] })
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload({ ...payloadEvent, id: 'product-1' }), { ...ctxEvent, ...ctx })

    expect(handlerEm.find).toHaveBeenCalledWith(IncidentTrigger, expect.objectContaining({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      eventId: expected,
      isEnabled: true,
      deletedAt: null,
    }), undefined)
    expect(getCreateInput(commandBus).sourceEventRef).toBe(`${expected}:product-1`)
  })

  it('swallows redelivery duplicates via the source_event_ref unique index and never rethrows', async () => {
    const { rootEm } = buildMockEm()
    const commandBus = {
      execute: jest.fn(async () => {
        const duplicate = new Error('duplicate key value violates unique constraint "incidents_org_tenant_source_event_ref_unique"') as Error & { code?: string; constraint?: string }
        duplicate.code = '23505'
        duplicate.constraint = 'incidents_org_tenant_source_event_ref_unique'
        throw duplicate
      }),
    }
    const ctx = buildCtx(rootEm, commandBus as unknown as MockCommandBus)

    await expect(handleDispatch(scopedPayload({ eventId: EVENT_ID, id: 'product-1' }), ctx)).resolves.toBeUndefined()

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[incidents:auto-incident-dispatch] incident already created by another delivery',
      expect.objectContaining({ sourceEventRef: `${EVENT_ID}:product-1` }),
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('isolates non-duplicate command failures per trigger without rejecting the subscriber', async () => {
    const { rootEm } = buildMockEm()
    const commandBus = {
      execute: jest.fn(async () => {
        throw new Error('command runtime exploded')
      }),
    }
    const ctx = buildCtx(rootEm, commandBus as unknown as MockCommandBus)

    await expect(handleDispatch(scopedPayload({ eventId: EVENT_ID, id: 'product-1' }), ctx)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      '[incidents:auto-incident-dispatch] trigger dispatch failed',
      expect.objectContaining({ eventId: EVENT_ID }),
    )
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[incidents:auto-incident-dispatch]'),
      expect.anything(),
    )
  })

  it('skips internal prefixes and excludeFromTriggers events before resolving dependencies', async () => {
    const resolve = jest.fn()

    for (const eventName of ['incidents.incident.created', 'application.started', 'query_index.upserted', 'webhooks.delivery.created']) {
      await handleDispatch(scopedPayload(), { eventName, resolve })
    }

    declaredEvents([{ id: 'sales.document.calculate.before', label: 'Before Calculate', excludeFromTriggers: true }])
    await handleDispatch(scopedPayload(), { eventName: 'sales.document.calculate.before', resolve })

    expect(resolve).not.toHaveBeenCalled()
  })

  it('skips payloads without tenant and organization scope', async () => {
    const resolve = jest.fn()

    await handleDispatch({ tenantId: TENANT_ID, id: 'record-1' }, { eventName: EVENT_ID, resolve })
    await handleDispatch({ organizationId: ORG_ID, id: 'record-1' }, { eventName: EVENT_ID, resolve })

    expect(resolve).not.toHaveBeenCalled()
  })

  it('requires all trigger conditions and treats unresolvable paths as false', async () => {
    const { rootEm } = buildMockEm({
      triggers: [
        buildTrigger({
          id: 'trigger-pass',
          conditions: [
            { path: 'status.state', equals: 'failed' },
            { path: 'attempt', equals: 2 },
          ],
        }),
        buildTrigger({
          id: 'trigger-fail',
          conditions: [{ path: 'status.missing.value', equals: true }],
        }),
      ],
    })
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload({
      status: { state: 'failed' },
      attempt: 2,
    }), { eventName: EVENT_ID, ...ctx })

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    expect(getCreateInput(commandBus).severityId).toBe(SEVERITY_ID)
  })

  it('builds sourceEventRef from the first stable payload id field', async () => {
    const { rootEm } = buildMockEm()
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload({
      id: null,
      recordId: 'record-2',
      entityId: 'entity-3',
    }), { eventName: EVENT_ID, ...ctx })

    const input = getCreateInput(commandBus)
    expect(input.sourceEventRef).toBe(`${EVENT_ID}:record-2`)
    expect(input.title).toBe('Product Updated: record-2')
  })

  it('hashes sorted scalar payload fields deterministically and excludes updatedAt-like keys', async () => {
    const first = buildMockEm()
    const firstCommandBus = buildCommandBus()
    const firstCtx = buildCtx(first.rootEm, firstCommandBus)
    const second = buildMockEm()
    const secondCommandBus = buildCommandBus()
    const secondCtx = buildCtx(second.rootEm, secondCommandBus)
    const expectedHash = createHash('sha256')
      .update(JSON.stringify({ amount: 10, entityName: 'Order 10' }))
      .digest('hex')

    await handleDispatch(scopedPayload({
      id: null,
      amount: 10,
      entityName: 'Order 10',
      updatedAt: '2026-07-02T10:00:00.000Z',
    }), { eventName: EVENT_ID, ...firstCtx })
    await handleDispatch(scopedPayload({
      id: null,
      entityName: 'Order 10',
      amount: 10,
      updatedAt: '2026-07-02T11:00:00.000Z',
    }), { eventName: EVENT_ID, ...secondCtx })

    expect(getCreateInput(firstCommandBus).sourceEventRef).toBe(`${EVENT_ID}:${expectedHash}`)
    expect(getCreateInput(secondCommandBus).sourceEventRef).toBe(`${EVENT_ID}:${expectedHash}`)
  })

  it('creates without dedupe and logs a warning when scalar projection is empty', async () => {
    const { rootEm } = buildMockEm()
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload({
      id: null,
      updatedAt: '2026-07-02T10:00:00.000Z',
    }), { eventName: EVENT_ID, ...ctx })

    expect(getCreateInput(commandBus).sourceEventRef).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[incidents:auto-incident-dispatch] source event has no stable dedupe key',
      expect.objectContaining({ eventId: EVENT_ID, triggerId: 'trigger-1' }),
    )
  })

  it('applies trigger severity, type, and explicit escalation policy', async () => {
    const { rootEm } = buildMockEm({
      triggers: [buildTrigger({
        severityKey: 'sev1',
        typeKey: 'security',
        escalationPolicyId: POLICY_ID,
      })],
    })
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload(), { eventName: EVENT_ID, ...ctx })

    const createInput = getCreateInput(commandBus)
    expect(createInput.severityId).toBe(SEVERITY_CRITICAL_ID)
    expect(createInput.incidentTypeId).toBe(TYPE_SECURITY_ID)
    expect(createInput.escalationPolicyId).toBe(POLICY_ID)
    expect(commandBus.execute).not.toHaveBeenCalledWith(
      'incidents.incident.update',
      expect.anything(),
    )
  })

  it('ignores disabled triggers defensively', async () => {
    const { rootEm } = buildMockEm({ triggers: [buildTrigger({ isEnabled: false })] })
    const commandBus = buildCommandBus()
    const ctx = buildCtx(rootEm, commandBus)

    await handleDispatch(scopedPayload(), { eventName: EVENT_ID, ...ctx })

    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
