/**
 * The classification precedence chain, pinned where it now lives.
 *
 * `classifyRecordsEntity` was private to `api/records.ts` and covered only
 * indirectly, through the records route tests. It is now shared with the
 * workflows task-visibility resolver, so the precedence it encodes — ORM
 * registry beats module declaration beats a scoped `custom_entities` row, and
 * `restricted` is read from the row that applies to THIS caller — is pinned
 * directly. Nothing here asserts new behavior; it asserts the behavior the
 * extraction had to preserve.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'

const isOrmBackedSystemEntityId = jest.fn<(em: unknown, entityId: string) => boolean>(() => false)
const getModules = jest.fn<() => unknown[]>(() => [])

jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  isOrmBackedSystemEntityId: (em: unknown, entityId: string) => isOrmBackedSystemEntityId(em, entityId),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getModules: () => getModules(),
}))
jest.mock('../../data/entities', () => ({ CustomEntity: class CustomEntity {} }))

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_TENANT = '33333333-3333-3333-3333-333333333333'

const scope = { tenantId: TENANT, organizationId: ORG }

type Row = { entityId: string; tenantId: string | null; organizationId: string | null; accessRestricted?: boolean }

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
}

function makeEm(rows: Row[]) {
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    rows.find((row) => matches(row, where)) ?? null,
  )
  return { em: { findOne }, findOne }
}

async function loadModule() {
  jest.resetModules()
  return import('../entityClassification')
}

describe('classifyRecordsEntity precedence', () => {
  beforeEach(() => {
    isOrmBackedSystemEntityId.mockReset()
    isOrmBackedSystemEntityId.mockReturnValue(false)
    getModules.mockReset()
    getModules.mockReturnValue([])
  })

  test('an ORM-backed id is a system entity and is never looked up in the database', async () => {
    isOrmBackedSystemEntityId.mockReturnValue(true)
    const { classifyRecordsEntity } = await loadModule()
    const { em, findOne } = makeEm([])

    expect(await classifyRecordsEntity(em, 'customers:person', scope)).toEqual({
      kind: 'system',
      restricted: false,
    })
    expect(findOne).not.toHaveBeenCalled()
  })

  test('a module-declared entity wins over the database and carries its restriction flag', async () => {
    getModules.mockReturnValue([{ customEntities: [{ id: 'example:todo', accessRestricted: true }] }])
    const { classifyRecordsEntity } = await loadModule()
    const { em, findOne } = makeEm([{ entityId: 'example:todo', tenantId: TENANT, organizationId: ORG }])

    expect(await classifyRecordsEntity(em, 'example:todo', scope)).toEqual({
      kind: 'custom',
      restricted: true,
    })
    expect(findOne).not.toHaveBeenCalled()
  })

  test('an undeclared id resolves from the registration row in the caller scope', async () => {
    const { classifyRecordsEntity } = await loadModule()
    const { em } = makeEm([
      { entityId: 'user:vendors', tenantId: TENANT, organizationId: ORG, accessRestricted: true },
    ])

    expect(await classifyRecordsEntity(em, 'user:vendors', scope)).toEqual({
      kind: 'custom',
      restricted: true,
    })
  })

  test('resolves the most specific registration first — org+tenant beats tenant-global', async () => {
    const { classifyRecordsEntity } = await loadModule()
    const { em } = makeEm([
      { entityId: 'user:vendors', tenantId: TENANT, organizationId: null, accessRestricted: false },
      { entityId: 'user:vendors', tenantId: TENANT, organizationId: ORG, accessRestricted: true },
    ])

    expect(await classifyRecordsEntity(em, 'user:vendors', scope)).toEqual({
      kind: 'custom',
      restricted: true,
    })
  })

  test("another tenant's row cannot flip the restriction flag, only prove the id is custom", async () => {
    const { classifyRecordsEntity } = await loadModule()
    const { em } = makeEm([
      { entityId: 'user:vendors', tenantId: OTHER_TENANT, organizationId: null, accessRestricted: true },
    ])

    expect(await classifyRecordsEntity(em, 'user:vendors', scope)).toEqual({
      kind: 'custom',
      restricted: false,
    })
  })

  test('an id with no registration anywhere is unknown', async () => {
    const { classifyRecordsEntity } = await loadModule()
    const { em } = makeEm([])

    expect(await classifyRecordsEntity(em, 'nope:nothing', scope)).toEqual({
      kind: 'unknown',
      restricted: false,
    })
  })

  test('a failing database lookup classifies as unknown rather than throwing', async () => {
    const { classifyRecordsEntity } = await loadModule()
    const em = {
      findOne: jest.fn(async () => {
        throw new Error('connection lost')
      }),
    }

    expect(await classifyRecordsEntity(em, 'user:vendors', scope)).toEqual({
      kind: 'unknown',
      restricted: false,
    })
  })
})

describe('loadDeclaredCustomEntities', () => {
  beforeEach(() => {
    isOrmBackedSystemEntityId.mockReset()
    isOrmBackedSystemEntityId.mockReturnValue(false)
    getModules.mockReset()
    getModules.mockReturnValue([])
  })

  test('caches the registry so a second call does not rebuild it', async () => {
    getModules.mockReturnValue([{ customEntities: [{ id: 'example:todo' }] }])
    const { loadDeclaredCustomEntities, isDeclaredCustomEntity } = await loadModule()

    expect(isDeclaredCustomEntity('example:todo')).toBe(true)
    expect(loadDeclaredCustomEntities().has('example:todo')).toBe(true)
    expect(getModules).toHaveBeenCalledTimes(1)
  })

  test('a thrown registry read leaves the cache unset so it is retried', async () => {
    getModules.mockImplementation(() => {
      throw new Error('registry not initialized')
    })
    const { isDeclaredCustomEntity } = await loadModule()

    expect(isDeclaredCustomEntity('example:todo')).toBe(false)
    expect(isDeclaredCustomEntity('example:todo')).toBe(false)
    expect(getModules).toHaveBeenCalledTimes(2)
  })
})
