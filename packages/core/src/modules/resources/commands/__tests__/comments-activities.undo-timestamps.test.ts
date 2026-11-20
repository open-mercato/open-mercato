/** @jest-environment node */

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { ResourcesResource, ResourcesResourceActivity, ResourcesResourceComment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn().mockResolvedValue({ scheduledAt: '2026-01-02T03:04:05.000Z' }),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHILD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CREATED_AT = '2026-01-02T03:04:05.123Z'
const REPLAY_AT = '2026-10-20T12:00:00.000Z'
const resource = { id: RESOURCE_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

function buildHarness() {
  let record: Record<string, unknown> | null = {
    id: CHILD_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    resource,
    body: 'Original child',
    activityType: 'maintenance',
    subject: 'Original activity',
    occurredAt: new Date(CREATED_AT),
    createdAt: new Date(CREATED_AT),
    updatedAt: new Date(CREATED_AT),
    authorUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
  }
  const em = {
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(() => { record = null }),
    findOne: jest.fn(async (entity: unknown) => entity === ResourcesResource ? resource : record),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      record = { createdAt: new Date(), updatedAt: new Date(), ...data }
      return record
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (name: string) => name === 'em' ? { ...em, fork: () => em } : {},
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
  return { em, ctx, removeRecord: () => { record = null } }
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

beforeAll(async () => {
  commandRegistry.clear()
  await import('../comments')
  await import('../activities')
})

describe.each([
  { kind: 'comments', entity: ResourcesResourceComment, result: { commentId: CHILD_ID, authorUserId: null } },
  { kind: 'activities', entity: ResourcesResourceActivity, result: { activityId: CHILD_ID, authorUserId: null } },
])('resources resource-$kind creation timestamps (#7666)', ({ kind, entity, result }) => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(REPLAY_AT))
    jest.clearAllMocks()
  })

  afterEach(() => jest.useRealTimers())

  it.each(['payload', 'snapshotAfter'])('preserves createdAt through create undo/redo using %s', async (source) => {
    const { em, ctx } = buildHarness()
    const handler = commandRegistry.get(`resources.resource-${kind}.create`)!
    const log = await handler.buildLog!({ result, ctx, snapshots: {} } as never)
    const logEntry = roundTrip({
      resourceId: CHILD_ID,
      ...(source === 'payload' ? { commandPayload: log!.payload } : { snapshotAfter: log!.snapshotAfter }),
    })

    await handler.undo!({ logEntry, ctx } as never)
    await handler.redo!({ logEntry, ctx } as never)

    expect(em.create).toHaveBeenCalledWith(entity, expect.objectContaining({
      id: CHILD_ID,
      createdAt: new Date(CREATED_AT),
    }))
    const restored = em.create.mock.results[0].value
    expect(restored.updatedAt).toEqual(new Date(REPLAY_AT))
    if (kind === 'activities') {
      expect(restored.occurredAt).toEqual(new Date(CREATED_AT))
      expect(setCustomFieldsIfAny).toHaveBeenCalledWith(expect.objectContaining({
        values: { scheduledAt: CREATED_AT.replace('.123Z', '.000Z') },
      }))
    }
  })

  it.each(['update', 'delete'])('preserves createdAt when %s undo recreates the child', async (action) => {
    const { em, ctx, removeRecord } = buildHarness()
    const handler = commandRegistry.get(`resources.resource-${kind}.${action}`)!
    const input = action === 'delete' ? { query: { id: CHILD_ID } } : { id: CHILD_ID }
    const snapshots = await handler.prepare!(input, ctx)
    const log = await handler.buildLog!({ snapshots, ctx } as never)
    removeRecord()

    await handler.undo!({ logEntry: roundTrip({ commandPayload: log!.payload }), ctx } as never)

    expect(em.create).toHaveBeenCalledWith(entity, expect.objectContaining({
      id: CHILD_ID,
      createdAt: new Date(CREATED_AT),
      updatedAt: new Date(REPLAY_AT),
    }))
  })

  it.each(['create', 'update', 'delete'])('supports historical %s snapshots without createdAt', async (action) => {
    const { em, ctx, removeRecord } = buildHarness()
    const handler = commandRegistry.get(`resources.resource-${kind}.${action}`)!
    const create = action === 'create'
    const snapshots = create ? {} : await handler.prepare!(action === 'delete' ? { query: { id: CHILD_ID } } : { id: CHILD_ID }, ctx)
    const log = await handler.buildLog!({ result, snapshots, ctx } as never)
    const logEntry = JSON.parse(JSON.stringify({ resourceId: CHILD_ID, commandPayload: log!.payload }, (key, value: unknown) => key === 'createdAt' ? undefined : value)) as unknown
    removeRecord()

    if (create) await handler.redo!({ logEntry, ctx } as never)
    else await handler.undo!({ logEntry, ctx } as never)

    expect(em.create.mock.results[0].value.createdAt).toEqual(new Date(REPLAY_AT))
  })
})
