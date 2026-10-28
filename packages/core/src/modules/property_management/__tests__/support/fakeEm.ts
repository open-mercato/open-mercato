export type Row = Record<string, unknown> & { id: string }
export type Where = Record<string, unknown>
export type EntityClass = { prototype: object; name: string }
type FindOptions = { lockMode?: number; orderBy?: Record<string, 'asc' | 'desc'>; limit?: number }

function compare(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
    const condition = expected as { $in?: unknown[]; $nin?: unknown[]; $ne?: unknown; $lt?: string; $eq?: unknown }
    if (condition.$in) return condition.$in.includes(actual)
    if (condition.$nin) return !condition.$nin.includes(actual)
    if ('$ne' in condition) return condition.$ne === null ? actual !== null && actual !== undefined : actual !== condition.$ne
    if (condition.$lt !== undefined) return typeof actual === 'string' && actual < condition.$lt
    if ('$eq' in condition) return actual === condition.$eq
    return true
  }
  return (actual ?? null) === expected
}

export function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or' && Array.isArray(expected)) return expected.some((part) => matches(row, part as Where))
    return compare(row[key], expected)
  })
}

export class FakeEm {
  store = new Map<string, Row[]>()
  lockFailures = new Set<string>()
  flushes = 0
  executed: Array<{ sql: string; params: unknown[] }> = []

  rows(entity: EntityClass): Row[] {
    const list = this.store.get(entity.name) ?? []
    this.store.set(entity.name, list)
    return list
  }

  async find(entity: EntityClass, where: Where, options?: FindOptions) {
    let result = this.rows(entity).filter((row) => matches(row, where))
    const order = options?.orderBy ? Object.entries(options.orderBy)[0] : null
    if (order) {
      const [field, direction] = order
      result = [...result].sort((left, right) => {
        const a = left[field] as number | string
        const b = right[field] as number | string
        return (a < b ? -1 : a > b ? 1 : 0) * (direction === 'desc' ? -1 : 1)
      })
    }
    return options?.limit ? result.slice(0, options.limit) : result
  }

  async findOne(entity: EntityClass, where: Where, options?: FindOptions) {
    const row = this.rows(entity).find((candidate) => matches(candidate, where)) ?? null
    if (row && options?.lockMode === 5 && this.lockFailures.has(row.id)) {
      throw Object.assign(new Error('could not obtain lock on row'), { code: '55P03' })
    }
    return row
  }

  create(entity: EntityClass, data: Row) {
    return Object.assign(Object.create(entity.prototype), { createdAt: new Date(), updatedAt: new Date(), ...data })
  }

  persist(row: Row) {
    const list = this.rows(row.constructor as EntityClass)
    if (!list.includes(row)) list.push(row)
    return this
  }

  remove(row: Row) {
    const list = this.rows(row.constructor as EntityClass)
    const index = list.indexOf(row)
    if (index >= 0) list.splice(index, 1)
  }

  async flush() {
    this.flushes += 1
  }

  async transactional<T>(callback: (em: FakeEm) => Promise<T>) {
    return callback(this)
  }

  fork() {
    return this
  }

  getTransactionContext() {
    return undefined
  }

  getConnection() {
    return {
      execute: async (sql: string, params: unknown[] = []) => {
        this.executed.push({ sql, params })
        return []
      },
    }
  }

  seed<T extends object>(entity: { prototype: T; name: string }, data: Row): T & Row {
    const row = Object.assign(Object.create(entity.prototype), { createdAt: new Date(), updatedAt: new Date(), ...data })
    this.rows(entity).push(row)
    return row
  }
}

export function encryptionFindMock() {
  return {
    findOneWithDecryption: (em: FakeEm, entity: EntityClass, where: Where, options?: FindOptions) => em.findOne(entity, where, options),
    findWithDecryption: (em: FakeEm, entity: EntityClass, where: Where, options?: FindOptions) => em.find(entity, where, options),
  }
}
