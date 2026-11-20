import { DriverException, ReferenceKind } from '@mikro-orm/core'
import { TenantEncryptionSubscriber } from '../subscriber'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// Regression coverage for issue #2744: a loaded *-to-many Collection relation must be expanded into
// its items during deep-decrypt. extractEntities() previously matched the MikroORM Reference branch
// first — both a Collection and a Reference expose isInitialized() — so a Collection (which has no
// unwrap()/__entity) was returned as the wrapper itself and decrypt() ran on the Collection instead
// of each item, leaving encrypted child fields as ciphertext in populated response graphs.

// Mirrors a MikroORM Collection: exposes isInitialized() + getItems(), but NO unwrap()/__entity.
function makeCollection(items: Record<string, unknown>[], initialized = true) {
  return {
    isInitialized: () => initialized,
    getItems: () => items,
  }
}

// Mirrors a MikroORM Reference: exposes isInitialized() + unwrap(), but NO getItems().
function makeReference(entity: Record<string, unknown>, initialized = true) {
  return {
    isInitialized: () => initialized,
    unwrap: () => entity,
  }
}

const CHILD_META = { className: 'Child', tableName: 'children', properties: {} } as any

const parentMeta = (childKind: ReferenceKind, relationName: string) =>
  ({
    className: 'Parent',
    tableName: 'parents',
    properties: { [relationName]: { name: relationName, kind: childKind } },
  }) as any

function makeEm() {
  return { getMetadata: () => undefined, getComparator: () => undefined }
}

// Decrypts by stripping an "enc:" prefix; records every entity id it was asked to decrypt.
function makeService(decryptedEntityIds: string[]): TenantDataEncryptionService {
  return {
    isEnabled: () => true,
    async decryptEntityPayload(entityId: string, target: Record<string, unknown>) {
      decryptedEntityIds.push(entityId)
      const value = target.secret
      if (typeof value === 'string' && value.startsWith('enc:')) {
        return { secret: value.slice('enc:'.length) }
      }
      return {}
    },
  } as unknown as TenantDataEncryptionService
}

describe('TenantEncryptionSubscriber deep-decrypt of loaded collection relations (issue #2744)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION // default => encryption enabled
    registerEntityIds({ test: { parent: 'test:parent', child: 'test:child' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  it('decrypts every item of an initialized ONE_TO_MANY collection', async () => {
    const decryptedEntityIds: string[] = []
    const childA = { secret: 'enc:alpha', tenantId: 't1', __meta: CHILD_META }
    const childB = { secret: 'enc:beta', tenantId: 't1', __meta: CHILD_META }
    const meta = parentMeta(ReferenceKind.ONE_TO_MANY, 'children')
    const parent = { tenantId: 't1', children: makeCollection([childA, childB]), __meta: meta }

    const subscriber = new TenantEncryptionSubscriber(makeService(decryptedEntityIds))
    await subscriber.decryptEntityGraph(parent, meta, makeEm(), { syncOriginal: true })

    expect(childA.secret).toBe('alpha')
    expect(childB.secret).toBe('beta')
    expect(decryptedEntityIds.filter((id) => id === 'test:child')).toHaveLength(2)
  })

  it('decrypts every item of an initialized MANY_TO_MANY collection', async () => {
    const decryptedEntityIds: string[] = []
    const child = { secret: 'enc:gamma', tenantId: 't1', __meta: CHILD_META }
    const meta = parentMeta(ReferenceKind.MANY_TO_MANY, 'children')
    const parent = { tenantId: 't1', children: makeCollection([child]), __meta: meta }

    const subscriber = new TenantEncryptionSubscriber(makeService(decryptedEntityIds))
    await subscriber.decryptEntityGraph(parent, meta, makeEm(), { syncOriginal: true })

    expect(child.secret).toBe('gamma')
    expect(decryptedEntityIds).toContain('test:child')
  })

  it('leaves an uninitialized collection untouched (does not decrypt unloaded items)', async () => {
    const decryptedEntityIds: string[] = []
    const child = { secret: 'enc:delta', tenantId: 't1', __meta: CHILD_META }
    const meta = parentMeta(ReferenceKind.ONE_TO_MANY, 'children')
    const parent = { tenantId: 't1', children: makeCollection([child], false), __meta: meta }

    const subscriber = new TenantEncryptionSubscriber(makeService(decryptedEntityIds))
    await subscriber.decryptEntityGraph(parent, meta, makeEm(), { syncOriginal: true })

    expect(child.secret).toBe('enc:delta')
    expect(decryptedEntityIds).not.toContain('test:child')
  })

  it('still decrypts a single-valued MANY_TO_ONE Reference (reorder must not regress references)', async () => {
    const decryptedEntityIds: string[] = []
    const child = { secret: 'enc:epsilon', tenantId: 't1', __meta: CHILD_META }
    const meta = parentMeta(ReferenceKind.MANY_TO_ONE, 'child')
    const parent = { tenantId: 't1', child: makeReference(child), __meta: meta }

    const subscriber = new TenantEncryptionSubscriber(makeService(decryptedEntityIds))
    await subscriber.decryptEntityGraph(parent, meta, makeEm(), { syncOriginal: true })

    expect(child.secret).toBe('epsilon')
    expect(decryptedEntityIds).toContain('test:child')
  })
})

describe('TenantEncryptionSubscriber nested decrypt failures inside a transaction', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION
    registerEntityIds({ test: { parent: 'test:parent', child: 'test:child' } })
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  function makeFailingChildService(error: Error): TenantDataEncryptionService {
    return {
      isEnabled: () => true,
      async decryptEntityPayload(entityId: string) {
        if (entityId === 'test:child') throw error
        return {}
      },
    } as unknown as TenantDataEncryptionService
  }

  function makeGraph() {
    const child = { secret: 'enc:zeta', tenantId: 't1', __meta: CHILD_META }
    const meta = parentMeta(ReferenceKind.MANY_TO_ONE, 'child')
    return { meta, parent: { tenantId: 't1', child: makeReference(child), __meta: meta } }
  }

  function makeTransactionalEm(inTransaction: boolean) {
    return { ...makeEm(), isInTransaction: () => inTransaction }
  }

  const abortedStatement = () => new DriverException(
    Object.assign(new Error('current transaction is aborted'), { code: '25P02' }),
  )

  it('rethrows a database error so the caller sees its aborted transaction', async () => {
    const { meta, parent } = makeGraph()
    const subscriber = new TenantEncryptionSubscriber(makeFailingChildService(abortedStatement()))

    await expect(
      subscriber.decryptEntityGraph(parent, meta, makeTransactionalEm(true), { syncOriginal: true }),
    ).rejects.toBeInstanceOf(DriverException)
  })

  it('keeps swallowing a database error outside a transaction', async () => {
    const { meta, parent } = makeGraph()
    const subscriber = new TenantEncryptionSubscriber(makeFailingChildService(abortedStatement()))

    await expect(
      subscriber.decryptEntityGraph(parent, meta, makeTransactionalEm(false), { syncOriginal: true }),
    ).resolves.toBeUndefined()
  })

  it('keeps swallowing a non-database decrypt error inside a transaction', async () => {
    const { meta, parent } = makeGraph()
    const subscriber = new TenantEncryptionSubscriber(makeFailingChildService(new Error('malformed payload')))

    await expect(
      subscriber.decryptEntityGraph(parent, meta, makeTransactionalEm(true), { syncOriginal: true }),
    ).resolves.toBeUndefined()
  })
})
