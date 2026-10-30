/** @jest-environment node */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { MessageRecipient } from '../../data/entities'
import { buildChannelInboxPredicate } from '../../../communication_channels/lib/channel-inbox-predicate'
import { ensureChannelInboxRecipient } from '../channelInboxRecipient'

const canUseChannelThreadFallbackMock = jest.fn()

jest.mock('../routeHelpers', () => ({
  canUseChannelThreadFallback: (...args: unknown[]) => canUseChannelThreadFallbackMock(...args),
}))

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222' as string | null,
  userId: '33333333-3333-4333-8333-333333333333',
}
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'

type Harness = ReturnType<typeof makeHarness>

function makeHarness(options: { eligible: boolean; flushError?: Error; existingAfter?: unknown }) {
  const recorded: CompiledQuery[] = []
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (query: CompiledQuery) => {
    recorded.push(query)
    return { rows: options.eligible ? [{ id: MESSAGE_ID }] : [] }
  }

  const created: Array<Record<string, unknown>> = []
  const writeEm = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {
      if (options.flushError) throw options.flushError
    }),
  }
  const em = {
    getKysely: () => db,
    fork: jest.fn(() => writeEm),
    findOne: jest.fn(async () => options.existingAfter ?? null),
  }
  return { em, writeEm, recorded, created }
}

function makeContainer(options: { hub?: boolean } = {}) {
  return {
    resolve: (name: string) => {
      if (name === 'communicationChannelsBuildChannelInboxPredicate') {
        if (options.hub === false) throw new Error('not registered')
        return buildChannelInboxPredicate
      }
      return null
    },
  }
}

async function run(harness: Harness, scope = SCOPE, container = makeContainer()) {
  return ensureChannelInboxRecipient(container as never, harness.em as never, scope, MESSAGE_ID)
}

describe('ensureChannelInboxRecipient (#6106)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    canUseChannelThreadFallbackMock.mockResolvedValue(true)
  })

  it('creates the caller unread recipient row for an eligible channel-inbox message', async () => {
    const harness = makeHarness({ eligible: true, existingAfter: { id: 'recipient-1' } })

    const recipient = await run(harness)

    expect(harness.created).toEqual([
      { messageId: MESSAGE_ID, recipientUserId: SCOPE.userId, recipientType: 'to', status: 'unread' },
    ])
    expect(harness.writeEm.flush).toHaveBeenCalledTimes(1)
    expect(harness.em.findOne).toHaveBeenCalledWith(MessageRecipient, {
      messageId: MESSAGE_ID,
      recipientUserId: SCOPE.userId,
      deletedAt: null,
    })
    expect(recipient).toEqual({ id: 'recipient-1' })
  })

  it('checks eligibility with the very clause the list uses, scoped to the message', async () => {
    const harness = makeHarness({ eligible: true })

    await run(harness)

    const compiled = harness.recorded[0]!
    const text = compiled.sql.replace(/\s+/g, ' ')
    expect(text).toContain('"m"."id" = $')
    expect(text).toContain('"m"."tenant_id" = $')
    expect(text).toContain('"m"."deleted_at" is null')
    expect(text).toContain('"m"."is_draft" = $')
    expect(text).toContain('"m"."organization_id" = $')
    expect(text).toContain('"mcl"."direction" = $')
    expect(text).toContain('"ctm"."assigned_user_id" is null')
    expect(text).toMatch(/not exists \(select 1 as "one" from "message_recipients" as "rx"/)
    expect(compiled.parameters).toEqual(
      expect.arrayContaining([MESSAGE_ID, SCOPE.tenantId, SCOPE.organizationId, 'public', 'inbound', SCOPE.userId]),
    )
  })

  it('scopes an organization-less caller to organization-less messages', async () => {
    const harness = makeHarness({ eligible: true })

    await run(harness, { ...SCOPE, organizationId: null })

    expect(harness.recorded[0]!.sql.replace(/\s+/g, ' ')).toContain('"m"."organization_id" is null')
  })

  it('creates nothing when the message is not a channel-inbox message for the caller', async () => {
    const harness = makeHarness({ eligible: false })

    await expect(run(harness)).resolves.toBeNull()
    expect(harness.writeEm.create).not.toHaveBeenCalled()
    expect(harness.writeEm.flush).not.toHaveBeenCalled()
  })

  it('creates nothing without messages.view, and does not even query', async () => {
    canUseChannelThreadFallbackMock.mockResolvedValue(false)
    const harness = makeHarness({ eligible: true })

    await expect(run(harness)).resolves.toBeNull()
    expect(harness.recorded).toHaveLength(0)
    expect(harness.writeEm.create).not.toHaveBeenCalled()
  })

  it('creates nothing when the channels hub is not installed', async () => {
    const harness = makeHarness({ eligible: true })

    await expect(run(harness, SCOPE, makeContainer({ hub: false }))).resolves.toBeNull()
    expect(harness.recorded).toHaveLength(0)
    expect(harness.writeEm.create).not.toHaveBeenCalled()
  })

  it('reads the row back when a concurrent first open already created it', async () => {
    const harness = makeHarness({
      eligible: true,
      flushError: new Error('duplicate key value violates unique constraint'),
      existingAfter: { id: 'recipient-from-other-request' },
    })

    await expect(run(harness)).resolves.toEqual({ id: 'recipient-from-other-request' })
  })

  it('does nothing without a user or tenant', async () => {
    const harness = makeHarness({ eligible: true })

    await expect(run(harness, { ...SCOPE, userId: '' })).resolves.toBeNull()
    expect(harness.recorded).toHaveLength(0)
  })
})
