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
