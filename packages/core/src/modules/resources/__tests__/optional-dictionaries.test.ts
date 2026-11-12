import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { ResourcesResource, ResourcesResourceTag, ResourcesResourceType } from '../data/entities'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/entities/lib/field-definitions', () => ({
  ensureCustomFieldDefinitions: jest.fn(async () => undefined),
}))

import { metadata } from '../index'
import setup from '../setup'
import '../commands/resources'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'

const DICTIONARY_ENTITIES = new Set<unknown>([Dictionary, DictionaryEntry])

function missingMetadata(entity: unknown): Error | null {
  if (!DICTIONARY_ENTITIES.has(entity)) return null
  return new Error(`Metadata for entity ${(entity as { name: string }).name} not found`)
}

type FakeEm = {
  touchedDictionaries: number
  created: unknown[]
  em: EntityManager
}

function queriedDictionaries(): boolean {
  return findOneWithDecryptionMock.mock.calls.some(([, entity]) => DICTIONARY_ENTITIES.has(entity))
}

function createFakeEm(dictionariesRegistered: boolean): FakeEm {
  const state: FakeEm = { touchedDictionaries: 0, created: [], em: {} as EntityManager }
  const guard = (entity: unknown) => {
    if (!DICTIONARY_ENTITIES.has(entity)) return
    state.touchedDictionaries += 1
    const error = dictionariesRegistered ? null : missingMetadata(entity)
    if (error) throw error
  }
  const em = {
    findOne: jest.fn(async (entity: unknown) => {
      guard(entity)
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      guard(entity)
      return []
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      guard(entity)
      state.created.push(entity)
      return { ...data }
    }),
    getReference: jest.fn((_entity: unknown, id: unknown) => ({ id })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(() => em),
  }
  state.em = em as unknown as EntityManager
  return state
}

function registerRegistry(withDictionaries: boolean) {
  const registry: EntityIds = { resources: { resources_resource: 'resources:resources_resource' } }
  if (withDictionaries) registry.dictionaries = { dictionary: 'dictionaries:dictionary' }
  registerEntityIds(registry)
}

function setupContext(em: EntityManager): Parameters<NonNullable<typeof setup.seedDefaults>>[0] {
  return { em, tenantId: TENANT_ID, organizationId: ORG_ID } as Parameters<NonNullable<typeof setup.seedDefaults>>[0]
}

function commandContext(em: EntityManager): CommandRuntimeContext {
  return {
    container: { resolve: (key: string) => (key === 'em' ? em : undefined) },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
}

describe('resources without the dictionaries and planner modules', () => {
  const originalEntityIds = getEntityIds(false)

  afterAll(() => {
    registerEntityIds(originalEntityIds)
  })

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('does not require planner to be enabled', () => {
    expect(metadata.requires ?? []).not.toContain('planner')
  })

  it('seeds defaults without touching dictionaries when the module is disabled', async () => {
    registerRegistry(false)
    const fake = createFakeEm(false)
    await expect(setup.seedDefaults!(setupContext(fake.em))).resolves.toBeUndefined()
    expect(fake.touchedDictionaries).toBe(0)
  })

  it('still seeds resource types but no dictionaries in seedExamples when the module is disabled', async () => {
    registerRegistry(false)
    const fake = createFakeEm(false)
    await expect(setup.seedExamples!(setupContext(fake.em))).resolves.toBeUndefined()
    expect(fake.touchedDictionaries).toBe(0)
    expect(fake.created).toContain(ResourcesResourceType)
    expect(fake.created).toContain(ResourcesResource)
    expect(fake.created).toContain(ResourcesResourceTag)
  })

  it('keeps seeding dictionaries when the module is enabled', async () => {
    registerRegistry(true)
    const fake = createFakeEm(true)
    await setup.seedDefaults!(setupContext(fake.em))
    expect(fake.created).toContain(Dictionary)
    expect(fake.created).toContain(DictionaryEntry)
    const createdBeforeExamples = fake.created.length
    await setup.seedExamples!(setupContext(fake.em))
    const dictionariesCreatedByExamples = fake.created.slice(createdBeforeExamples).filter((entity) => entity === Dictionary)
    expect(dictionariesCreatedByExamples).toHaveLength(2)
  })

  it('rejects a capacity unit on create with the existing 400 when dictionaries is disabled', async () => {
    registerRegistry(false)
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      const error = missingMetadata(entity)
      if (error) throw error
      return null
    })
    const handler = commandRegistry.get('resources.resources.create')!
    const fake = createFakeEm(false)
    const result = handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, name: 'Chair', capacityUnitValue: 'kg' },
      commandContext(fake.em),
    )
    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({
      status: 400,
      body: { error: 'Capacity unit dictionary is not configured.' },
    })
    expect(queriedDictionaries()).toBe(false)
  })

  it('still resolves capacity units against the dictionary when the module is enabled', async () => {
    registerRegistry(true)
    findOneWithDecryptionMock.mockResolvedValue(null)
    const handler = commandRegistry.get('resources.resources.create')!
    const fake = createFakeEm(true)
    const result = handler.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, name: 'Chair', capacityUnitValue: 'kg' },
      commandContext(fake.em),
    )
    await expect(result).rejects.toMatchObject({
      status: 400,
      body: { error: 'Capacity unit dictionary is not configured.' },
    })
    expect(queriedDictionaries()).toBe(true)
  })

  it('rejects a capacity unit on update with the existing 400 when dictionaries is disabled', async () => {
    registerRegistry(false)
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      const error = missingMetadata(entity)
      if (error) throw error
      if (entity === ResourcesResource) {
        return { id: RESOURCE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, resourceTypeId: null }
      }
      return null
    })
    const handler = commandRegistry.get('resources.resources.update')!
    const fake = createFakeEm(false)
    const result = handler.execute({ id: RESOURCE_ID, capacityUnitValue: 'kg' }, commandContext(fake.em))
    await expect(result).rejects.toMatchObject({
      status: 400,
      body: { error: 'Capacity unit dictionary is not configured.' },
    })
    expect(queriedDictionaries()).toBe(false)
  })
})
