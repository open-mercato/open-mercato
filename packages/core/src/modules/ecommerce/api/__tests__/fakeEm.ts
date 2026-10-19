export type FakeEmConfig = {
  counts?: (entity: unknown, where: Record<string, unknown>) => number
  findRows?: (entity: unknown, where: Record<string, unknown>) => unknown[]
  findOne?: (entity: unknown, where: Record<string, unknown>) => unknown
  nativeUpdateError?: (where: Record<string, unknown>) => unknown
  flushError?: unknown
}

export function createFakeEm(config: FakeEmConfig = {}) {
  const calls: string[] = []
  const em = {
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      calls.push('count')
      return config.counts ? config.counts(entity, where) : 0
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      calls.push('find')
      return config.findRows ? config.findRows(entity, where) : []
    }),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      calls.push('findOne')
      return config.findOne ? config.findOne(entity, where) : null
    }),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      calls.push(`nativeUpdate:${typeof where.id === 'string' ? 'self' : 'others'}`)
      const error = config.nativeUpdateError?.(where)
      if (error) throw error
      return 1
    }),
    flush: jest.fn(async () => {
      calls.push('flush')
      if (config.flushError) throw config.flushError
    }),
    transactional: jest.fn(async (callback: (tem: unknown) => Promise<unknown>): Promise<unknown> => callback(em)),
    fork: (): unknown => em,
  }
  return { em, calls }
}

export function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', constraint })
}
