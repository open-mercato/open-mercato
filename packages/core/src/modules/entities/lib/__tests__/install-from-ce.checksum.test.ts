import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'

const getModules = jest.fn()
const ensureCustomFieldDefinitions = jest.fn(async () => ({ created: 0, updated: 1, unchanged: 0 }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ getModules: () => getModules() }))
jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({ getEntityIds: () => ({}) }))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Tenant: class Tenant {} }))
jest.mock('../register', () => ({ upsertCustomEntity: jest.fn(async () => 'unchanged') }))
jest.mock('../../api/definitions.cache', () => ({ invalidateDefinitionsCache: jest.fn(async () => {}) }))
jest.mock('../field-definitions', () => ({
  ensureCustomFieldDefinitions: (...args: unknown[]) => ensureCustomFieldDefinitions(...(args as [])),
}))

import { installCustomEntitiesFromModules } from '../install-from-ce'

const entityId = 'a:one'

function declareField(field: CustomFieldDefinition) {
  getModules.mockReturnValue([
    {
      id: 'a',
      customEntities: [{ id: entityId, label: 'One', global: true }],
      customFieldSets: [{ entity: entityId, fields: [field] }],
    },
  ])
}

function createCache() {
  const store = new Map<string, string>()
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
}

const em = {} as never

describe('installCustomEntitiesFromModules checksum (#5920)', () => {
  beforeEach(() => {
    ensureCustomFieldDefinitions.mockClear()
  })

  it('skips a reinstall when the declaration is unchanged', async () => {
    const cache = createCache()
    declareField({ key: 'ssn', kind: 'text' })

    const first = await installCustomEntitiesFromModules(em, cache as never)
    expect(first.synchronized).toBe(1)
    expect(ensureCustomFieldDefinitions).toHaveBeenCalledTimes(1)

    const second = await installCustomEntitiesFromModules(em, cache as never)
    expect(second.skipped).toBe(1)
    expect(ensureCustomFieldDefinitions).toHaveBeenCalledTimes(1)
  })

  it('reinstalls when a declaration turns encryption on', async () => {
    const cache = createCache()
    declareField({ key: 'ssn', kind: 'text' })
    await installCustomEntitiesFromModules(em, cache as never)
    expect(ensureCustomFieldDefinitions).toHaveBeenCalledTimes(1)

    // Without `encrypted` in the checksum payload the cached checksum still matches,
    // so the declared change never reaches the definitions writer.
    declareField({ key: 'ssn', kind: 'text', encrypted: true })
    const result = await installCustomEntitiesFromModules(em, cache as never)

    expect(result.skipped).toBe(0)
    expect(result.synchronized).toBe(1)
    expect(ensureCustomFieldDefinitions).toHaveBeenCalledTimes(2)
    const [, sets] = ensureCustomFieldDefinitions.mock.calls[1] as unknown as [
      unknown,
      Array<{ fields: CustomFieldDefinition[] }>,
    ]
    expect(sets[0].fields[0].encrypted).toBe(true)
  })
})
