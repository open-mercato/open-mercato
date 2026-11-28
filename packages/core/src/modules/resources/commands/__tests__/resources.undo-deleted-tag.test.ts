/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesResourceTag, ResourcesResourceTagAssignment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DELETED_TAG_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SURVIVING_TAG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type FakeEm = ReturnType<typeof buildFakeEm>

function buildFakeEm(record: Record<string, unknown> | null, existingTagIds: string[]) {
  return {
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockImplementation(async (entity: unknown, where: { id?: { $in?: string[] } }) => {
      if (entity !== ResourcesResourceTag) return []
      const requested = where?.id?.$in ?? []
      return requested.filter((id) => existingTagIds.includes(id)).map((id) => ({ id }))
    }),
    findOne: jest.fn().mockResolvedValue(record),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: TEST_RESOURCE_ID, ...data })),
  }
}

function buildEnvelope(em: FakeEm) {
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  } as unknown as CommandRuntimeContext
  return { ctx }
}

function buildSnapshot(tags: string[]) {
  return {
    id: TEST_RESOURCE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Resource before',
    description: null,
    resourceTypeId: null,
    capacity: null,
    capacityUnitValue: null,
    capacityUnitName: null,
    capacityUnitColor: null,
    capacityUnitIcon: null,
    appearanceIcon: null,
    appearanceColor: null,
    isActive: true,
    availabilityRuleSetId: null,
    customFieldsetCode: null,
    tags,
    deletedAt: null,
  }
}

function buildLiveRecord() {
  return {
    id: TEST_RESOURCE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Resource after',
    deletedAt: null as Date | null,
  }
}

function asLogEntry(payload: Record<string, unknown>): CommandUndoLogEntry {
  return { payload } as unknown as CommandUndoLogEntry
}

function assignedTagIds(em: FakeEm): string[] {
  return em.create.mock.calls
    .filter(([entity]) => entity === ResourcesResourceTagAssignment)
    .map(([, data]) => (data as { tag: { id: string } }).tag.id)
}

function expectScopedTagLookup(em: FakeEm) {
  expect(em.find).toHaveBeenCalledWith(
    ResourcesResourceTag,
    expect.objectContaining({ organizationId: TEST_ORG_ID, tenantId: TEST_TENANT_ID }),
  )
}

describe('resources commands — replaying a snapshot whose tag was deleted', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resources')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
  })

  it('update undo restores the resource and keeps the tags that still exist', async () => {
    const record = buildLiveRecord()
    const em = buildFakeEm(record, [SURVIVING_TAG_ID])
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.update')
    const before = buildSnapshot([DELETED_TAG_ID, SURVIVING_TAG_ID])
    const logEntry = asLogEntry({ undo: { before, after: { ...before, name: 'Resource after', tags: [] } } })

    await expect(handler!.undo!({ logEntry, ctx })).resolves.toBeUndefined()

    expect(record.name).toBe('Resource before')
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expectScopedTagLookup(em)
    expect(em.nativeDelete).toHaveBeenCalledWith(ResourcesResourceTagAssignment, { resource: TEST_RESOURCE_ID })
    expect(assignedTagIds(em)).toEqual([SURVIVING_TAG_ID])
  })

  it('delete undo restores the resource when every snapshot tag was deleted', async () => {
    const record = { ...buildLiveRecord(), deletedAt: new Date('2026-10-20T10:00:00.000Z') }
    const em = buildFakeEm(record, [])
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.delete')
    const logEntry = asLogEntry({ undo: { before: buildSnapshot([DELETED_TAG_ID]) } })

    await expect(handler!.undo!({ logEntry, ctx })).resolves.toBeUndefined()

    expect(record.deletedAt).toBeNull()
    expect(record.name).toBe('Resource before')
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expectScopedTagLookup(em)
    expect(em.nativeDelete).toHaveBeenCalledWith(ResourcesResourceTagAssignment, { resource: TEST_RESOURCE_ID })
    expect(assignedTagIds(em)).toEqual([])
  })

  it('create redo restores the resource and keeps the tags that still exist', async () => {
    const record = { ...buildLiveRecord(), deletedAt: new Date('2026-10-20T10:00:00.000Z') }
    const em = buildFakeEm(record, [SURVIVING_TAG_ID])
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.create')
    const after = buildSnapshot([SURVIVING_TAG_ID, DELETED_TAG_ID])
    const logEntry = asLogEntry({ undo: { after } })

    await expect(handler!.redo!({ logEntry, ctx })).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })

    expect(record.deletedAt).toBeNull()
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expectScopedTagLookup(em)
    expect(assignedTagIds(em)).toEqual([SURVIVING_TAG_ID])
  })

  it('update execute still rejects a tag id that does not exist in scope', async () => {
    const record = buildLiveRecord()
    const em = buildFakeEm(record, [SURVIVING_TAG_ID])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.update')

    await expect(
      handler!.execute(
        { id: TEST_RESOURCE_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, tags: [SURVIVING_TAG_ID, DELETED_TAG_ID] },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400, body: { error: 'One or more tags not found for this scope' } })

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })
})
