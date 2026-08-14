import { randomUUID } from 'crypto'
import { PhoneCall } from '@open-mercato/core/modules/phone_calls/data/entities'

const emitPhoneCallsEventMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/phone_calls/events', () => ({
  emitPhoneCallsEvent: (...args: unknown[]) => emitPhoneCallsEventMock(...args),
}))

import { ingestPhoneCallCommand } from '@open-mercato/core/modules/phone_calls/commands/calls'
import { ingestPhoneCallSchema } from '@open-mercato/core/modules/phone_calls/data/validators'
import { clearPhoneCallProviders } from '@open-mercato/shared/modules/phone_calls/provider'

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const providerKey = 'demo'

type Row = Record<string, unknown> & { id: string }

function createFakeEm() {
  const calls: Row[] = []
  const participants: Row[] = []
  const em: Record<string, unknown> = {
    fork() {
      return em
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity !== PhoneCall) return null
      return (
        calls.find(
          (row) =>
            row.providerKey === where.providerKey &&
            row.externalCallId === where.externalCallId &&
            row.tenantId === where.tenantId &&
            row.organizationId === where.organizationId,
        ) ?? null
      )
    },
    create(entity: unknown, data: Record<string, unknown>) {
      return { id: randomUUID(), __entity: entity, ...data } as Row
    },
    persist(row: Row) {
      if (row.__entity === PhoneCall) {
        if (!calls.includes(row)) calls.push(row)
      } else if (!participants.includes(row)) {
        participants.push(row)
      }
    },
    async nativeDelete(_entity: unknown, where: Record<string, unknown>) {
      for (let i = participants.length - 1; i >= 0; i -= 1) {
        if (participants[i].phoneCallId === where.phoneCallId) participants.splice(i, 1)
      }
    },
    async flush() {},
    async begin() {},
    async commit() {},
    async rollback() {},
  }
  return { em, calls, participants }
}

function createCtx(em: Record<string, unknown>, dataEngine: Record<string, unknown> = { markOrmEntityChange() {} }) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        throw new Error(`[internal] unexpected dependency: ${name}`)
      },
    } as never,
    auth: { sub: userId, tenantId, orgId: organizationId } as never,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

function ingestInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId,
    tenantId,
    providerKey,
    integrationId: 'integration-1',
    externalCallId: 'call-abc',
    direction: 'inbound',
    status: 'completed',
    participants: [
      { role: 'caller', phoneNumber: '+48111', displayName: 'Alice' },
      { role: 'callee', phoneNumber: '+48222' },
    ],
    recording: { url: 'https://rec/1.mp3' },
    startedAt: '2026-07-06T10:00:00.000Z',
    durationSeconds: 42,
    providerFacts: { note: 'x' },
    rawPayload: { id: 'call-abc', foo: 'bar' },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearPhoneCallProviders()
})

describe('phone_calls.call.ingest', () => {
  it('creates on first ingest and updates on the second for the same DTO (single row)', async () => {
    const { em, calls } = createFakeEm()
    const ctx = createCtx(em)

    const first = await ingestPhoneCallCommand.execute(ingestInput(), ctx)
    expect(first.created).toBe(true)
    expect(calls).toHaveLength(1)

    const second = await ingestPhoneCallCommand.execute(ingestInput({ status: 'missed' }), ctx)
    expect(second.created).toBe(false)
    expect(second.phoneCallId).toBe(first.phoneCallId)
    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe('missed')

    expect(emitPhoneCallsEventMock).toHaveBeenNthCalledWith(
      1,
      'phone_calls.call.ingested',
      expect.objectContaining({ id: first.phoneCallId, organizationId, tenantId }),
    )
    expect(emitPhoneCallsEventMock).toHaveBeenNthCalledWith(
      2,
      'phone_calls.call.updated',
      expect.objectContaining({ id: first.phoneCallId, organizationId, tenantId }),
    )
  })

  it('maps normalized DTO fields onto entity columns', async () => {
    const { em, calls, participants } = createFakeEm()
    const ctx = createCtx(em)

    await ingestPhoneCallCommand.execute(ingestInput(), ctx)
    const row = calls[0]

    expect(row).toMatchObject({
      organizationId,
      tenantId,
      providerKey,
      integrationId: 'integration-1',
      externalCallId: 'call-abc',
      direction: 'inbound',
      status: 'completed',
      durationSeconds: 42,
      recordingUrl: 'https://rec/1.mp3',
      ingestStatus: 'complete',
      providerFacts: { note: 'x' },
      rawSnapshot: { id: 'call-abc', foo: 'bar' },
    })
    expect(row.startedAt).toBeInstanceOf(Date)
    expect(row.lastIngestedAt).toBeInstanceOf(Date)
    expect(participants).toHaveLength(2)
    expect(participants.map((participant) => participant.role)).toEqual(['caller', 'callee'])
  })

  it('replaces the whole participant set on re-ingest instead of duplicating', async () => {
    const { em, participants } = createFakeEm()
    const ctx = createCtx(em)

    await ingestPhoneCallCommand.execute(ingestInput(), ctx)
    expect(participants).toHaveLength(2)

    await ingestPhoneCallCommand.execute(
      ingestInput({ participants: [{ role: 'agent', displayName: 'Bob' }] }),
      ctx,
    )

    expect(participants).toHaveLength(1)
    expect(participants[0]).toMatchObject({ role: 'agent', displayName: 'Bob' })
  })

  it('queues the crud side effects, so the query index and the read caches see the write', async () => {
    const { em } = createFakeEm()
    const markOrmEntityChange = jest.fn()
    const ctx = createCtx(em, { markOrmEntityChange })

    const first = await ingestPhoneCallCommand.execute(ingestInput(), ctx)
    expect(markOrmEntityChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'created',
      identifiers: { id: first.phoneCallId, organizationId, tenantId },
      indexer: expect.objectContaining({ entityType: 'phone_calls:phone_call' }),
    }))

    await ingestPhoneCallCommand.execute(ingestInput({ status: 'missed' }), ctx)
    expect(markOrmEntityChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'updated' }))
  })

  it('logs the ingest for audit with a cache alias and without call PII', async () => {
    const { em } = createFakeEm()
    const ctx = createCtx(em)

    const result = await ingestPhoneCallCommand.execute(ingestInput(), ctx)
    const log = await ingestPhoneCallCommand.buildLog!({ input: ingestInput(), result, ctx, snapshots: {} })

    expect(log).toMatchObject({
      resourceKind: 'phone_calls.phone_call',
      resourceId: result.phoneCallId,
      tenantId,
      organizationId,
      context: { cacheAliases: ['PhoneCall'] },
    })
    // The list route builds its cache tag from the entity class name; a mismatch here means
    // an ingest leaves stale list pages cached.
    expect(JSON.stringify(log)).not.toContain('+48111')
    expect(log).not.toHaveProperty('snapshotAfter')
  })
})

describe('phone_calls validators', () => {
  it('accepts a valid ingest payload and rejects an invalid direction', () => {
    expect(() => ingestPhoneCallSchema.parse(ingestInput())).not.toThrow()
    expect(() => ingestPhoneCallSchema.parse(ingestInput({ direction: 'sideways' }))).toThrow()
  })
})
