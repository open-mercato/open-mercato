import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { UNAVAILABILITY_REASON_DICTIONARIES } from '../lib/unavailabilityReasons'

const createRequestContainerMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

import setup from '../setup'
import cliCommands from '../cli'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

const DICTIONARY_ENTITIES = new Set<unknown>([Dictionary, DictionaryEntry])

type FakeEm = {
  dictionaryCalls: number
  createdDictionaryKeys: string[]
  em: EntityManager
}

function createFakeEm(dictionariesRegistered: boolean): FakeEm {
  const state: FakeEm = { dictionaryCalls: 0, createdDictionaryKeys: [], em: {} as EntityManager }
  const guard = (entity: unknown) => {
    if (!DICTIONARY_ENTITIES.has(entity)) return
    state.dictionaryCalls += 1
    if (!dictionariesRegistered) {
      throw new Error(`Metadata for entity ${(entity as { name: string }).name} not found`)
    }
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
      if (entity === Dictionary) state.createdDictionaryKeys.push(String(data.key))
      return { ...data }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  state.em = em as unknown as EntityManager
  return state
}

function registerRegistry(withDictionaries: boolean) {
  const registry: EntityIds = { planner: { planner_availability_rule: 'planner:planner_availability_rule' } }
  if (withDictionaries) registry.dictionaries = { dictionary: 'dictionaries:dictionary' }
  registerEntityIds(registry)
}

function buildContext(em: EntityManager): InitSetupContext {
  return {
    em,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    container: {} as AwilixContainer,
  }
}

let previousEntityIds: EntityIds

beforeAll(() => {
  previousEntityIds = getEntityIds(false)
})

afterAll(() => {
  registerEntityIds(previousEntityIds)
})

function findCommand(name: string) {
  const command = cliCommands.find((entry) => entry.command === name)
  if (!command) throw new Error(`[internal] missing planner CLI command ${name}`)
  return command
}

describe('planner with the dictionaries module disabled', () => {
  beforeEach(() => {
    createRequestContainerMock.mockReset()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('seedDefaults skips the unavailability reason dictionaries instead of failing', async () => {
    registerRegistry(false)
    const fake = createFakeEm(false)

    await expect(setup.seedDefaults!(buildContext(fake.em))).resolves.toBeUndefined()

    expect(fake.dictionaryCalls).toBe(0)
  })

  it('seed-unavailability-reasons exits with a notice without opening a container', async () => {
    registerRegistry(false)

    await expect(findCommand('seed-unavailability-reasons').run(['--tenant', TENANT_ID, '--org', ORG_ID])).resolves.toBeUndefined()

    expect(createRequestContainerMock).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dictionaries module is disabled'))
  })
})

describe('planner with the dictionaries module enabled', () => {
  it('seedDefaults still seeds the three unavailability reason dictionaries', async () => {
    registerRegistry(true)
    const fake = createFakeEm(true)

    await setup.seedDefaults!(buildContext(fake.em))

    expect(fake.createdDictionaryKeys).toEqual(
      Object.values(UNAVAILABILITY_REASON_DICTIONARIES).map((config) => config.key),
    )
    expect(fake.createdDictionaryKeys).toHaveLength(3)
  })
})
