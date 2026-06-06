import { reviveSnapshotSeed, serializeRowSnapshot, makeCreateRedo } from '../redo'

describe('reviveSnapshotSeed', () => {
  it('revives the default date fields from ISO strings to Date', () => {
    const seed = reviveSnapshotSeed({
      id: 'row-1',
      code: 'USD',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
      deletedAt: null,
    })
    expect(seed.id).toBe('row-1')
    expect(seed.code).toBe('USD')
    expect(seed.createdAt).toBeInstanceOf(Date)
    expect((seed.createdAt as Date).toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect(seed.updatedAt).toBeInstanceOf(Date)
    expect(seed.deletedAt).toBeNull()
  })

  it('revives explicitly declared extra date fields', () => {
    const seed = reviveSnapshotSeed(
      { id: 'row-1', effectiveAt: '2026-02-03T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z' },
      ['createdAt', 'updatedAt', 'deletedAt', 'effectiveAt'],
    )
    expect(seed.effectiveAt).toBeInstanceOf(Date)
    expect(seed.updatedAt).toBeInstanceOf(Date)
  })

  it('leaves non-date values untouched and clones the input', () => {
    const snapshot = { id: 'row-1', symbol: null, decimalPlaces: 2 }
    const seed = reviveSnapshotSeed(snapshot)
    expect(seed).not.toBe(snapshot)
    expect(seed.symbol).toBeNull()
    expect(seed.decimalPlaces).toBe(2)
  })
})

describe('serializeRowSnapshot', () => {
  it('picks the requested fields and converts dates to ISO strings', () => {
    const entity = {
      id: 'row-1',
      code: 'USD',
      symbol: undefined as unknown as string,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
      ignored: 'nope',
    }
    const snapshot = serializeRowSnapshot(entity, ['id', 'code', 'symbol', 'createdAt', 'updatedAt'])
    expect(snapshot).toEqual({
      id: 'row-1',
      code: 'USD',
      symbol: null,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    })
  })
})

describe('makeCreateRedo defaults', () => {
  function buildContext(em: { fork: () => unknown }) {
    const dataEngine = { markOrmEntityChange: () => undefined }
    return {
      container: {
        resolve: (name: string) => (name === 'em' ? em : dataEngine),
      },
    } as never
  }

  it('uses the snapshot as the seed (with date revival) when no seedFromSnapshot is given', async () => {
    const created: Array<Record<string, unknown>> = []
    const forked = {
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => {
        created.push(data)
        return { ...data }
      },
      persist: () => undefined,
      flush: async () => undefined,
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string; organizationId?: string | null; tenantId?: string | null }, { id: string; code: string; createdAt: string; updatedAt: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
    })
    const logEntry = {
      snapshotAfter: { id: 'row-1', code: 'USD', createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z' },
    }
    const result = await redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })
    expect(result).toEqual({ id: 'row-1' })
    expect(created).toHaveLength(1)
    expect(created[0].id).toBe('row-1')
    expect(created[0].code).toBe('USD')
    expect(created[0].createdAt).toBeInstanceOf(Date)
  })

  it('merges beforeRestore overrides into the create seed and runs before restore', async () => {
    const created: Array<Record<string, unknown>> = []
    const calls: string[] = []
    const forked = {
      findOne: async () => { calls.push('find'); return null },
      create: (_cls: unknown, data: Record<string, unknown>) => { created.push(data); return { ...data } },
      persist: () => undefined,
      flush: async () => undefined,
    }
    const em = { fork: () => forked }
    const resolvedRelation = { id: 'rel-1' }
    const redo = makeCreateRedo<{ id: string }, { id: string; relationId: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
      beforeRestore: async ({ snapshot }) => { calls.push('before'); return { relation: resolvedRelation, relationId: undefined } },
    })
    const logEntry = { snapshotAfter: { id: 'row-1', relationId: 'rel-1' } }
    await redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })
    expect(calls).toEqual(['before', 'find'])
    expect(created[0].relation).toBe(resolvedRelation)
    expect(created[0].relationId).toBeUndefined()
  })

  it('uses the findRow override instead of em.findOne', async () => {
    const surviving: Record<string, unknown> = { id: 'row-1', deletedAt: new Date() }
    let findRowCalled = false
    const forked = {
      findOne: async () => { throw new Error('default findOne must not run when findRow is set') },
      create: () => { throw new Error('should not create when findRow returns a row') },
      persist: () => undefined,
      flush: async () => undefined,
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string; deletedAt?: Date | null }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
      findRow: async ({ id }) => { findRowCalled = true; return id === 'row-1' ? (surviving as never) : null },
    })
    await redo({ input: {}, ctx: buildContext(em), logEntry: { snapshotAfter: { id: 'row-1' } } as never })
    expect(findRowCalled).toBe(true)
    expect(surviving.deletedAt).toBeNull()
  })

  it('passes logEntry to afterRestore', async () => {
    let seenLogEntry: unknown = null
    const forked = {
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: () => undefined,
      flush: async () => undefined,
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
      afterRestore: async ({ logEntry }) => { seenLogEntry = logEntry },
    })
    const logEntry = { snapshotAfter: { id: 'row-1' }, resourceId: 'row-1' }
    await redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })
    expect(seenLogEntry).toBe(logEntry)
  })

  it('wraps the restore in a transaction when transaction is true', async () => {
    const order: string[] = []
    const forked = {
      isInTransaction: () => false,
      begin: async () => { order.push('begin') },
      commit: async () => { order.push('commit') },
      rollback: async () => { order.push('rollback') },
      getUnitOfWork: () => ({ getChangeSets: () => [] }),
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => { order.push('create'); return { ...data } },
      persist: () => undefined,
      flush: async () => { order.push('flush') },
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
      transaction: true,
    })
    await redo({ input: {}, ctx: buildContext(em), logEntry: { snapshotAfter: { id: 'row-1' } } as never })
    expect(order[0]).toBe('begin')
    expect(order).toContain('create')
    expect(order[order.length - 1]).toBe('commit')
    expect(order).not.toContain('rollback')
  })

  it('runs afterRestore inside the transaction before commit when transaction is true', async () => {
    const order: string[] = []
    const forked = {
      isInTransaction: () => false,
      begin: async () => { order.push('begin') },
      commit: async () => { order.push('commit') },
      rollback: async () => { order.push('rollback') },
      getUnitOfWork: () => ({ getChangeSets: () => [] }),
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => { order.push('create'); return { ...data } },
      persist: () => undefined,
      flush: async () => { order.push('flush') },
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
      transaction: true,
      afterRestore: async () => { order.push('afterRestore') },
    })
    await redo({ input: {}, ctx: buildContext(em), logEntry: { snapshotAfter: { id: 'row-1' } } as never })
    expect(order).toEqual(['begin', 'create', 'flush', 'afterRestore', 'flush', 'commit'])
  })

  it('maps a Postgres unique-constraint violation thrown during flush to a 409 conflict', async () => {
    const uniqueError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const forked = {
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: () => undefined,
      flush: async () => { throw uniqueError },
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
    })
    const logEntry = { snapshotAfter: { id: 'row-1' } }
    await expect(redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('propagates a non-unique flush error unchanged', async () => {
    const otherError = Object.assign(new Error('some other failure'), { code: '23503' })
    const forked = {
      findOne: async () => null,
      create: (_cls: unknown, data: Record<string, unknown>) => ({ ...data }),
      persist: () => undefined,
      flush: async () => { throw otherError },
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string }, { id: string }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id }),
    })
    const logEntry = { snapshotAfter: { id: 'row-1' } }
    await expect(redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })).rejects.toBe(otherError)
  })

  it('defaults getSnapshotId to snapshot.id and restores a surviving row in place', async () => {
    const surviving: Record<string, unknown> = { id: 'row-1', deletedAt: new Date(), isActive: false }
    const forked = {
      findOne: async () => surviving,
      create: () => {
        throw new Error('should not create when row survives')
      },
      persist: () => undefined,
      flush: async () => undefined,
    }
    const em = { fork: () => forked }
    const redo = makeCreateRedo<{ id: string; deletedAt?: Date | null; isActive?: boolean }, { id: string; isActive: boolean }>({
      entityClass: class {} as never,
      buildResult: (entity) => ({ id: entity.id, isActive: entity.isActive }),
    })
    const logEntry = { snapshotAfter: { id: 'row-1', isActive: true } }
    const result = await redo({ input: {}, ctx: buildContext(em), logEntry: logEntry as never })
    expect(result).toEqual({ id: 'row-1', isActive: true })
    expect(surviving.deletedAt).toBeNull()
    expect(surviving.isActive).toBe(true)
  })
})
