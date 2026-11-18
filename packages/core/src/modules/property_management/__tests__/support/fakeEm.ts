import { createHash } from 'node:crypto'
import { UniqueConstraintViolationException } from '@mikro-orm/core'

export type Row = Record<string, unknown> & { id: string }
export type Where = Record<string, unknown>
export type EntityClass = { prototype: object; name: string }
type FindOptions = { lockMode?: number; orderBy?: Record<string, 'asc' | 'desc'>; limit?: number }

function compare(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
    const condition = expected as {
      $in?: unknown[]
      $nin?: unknown[]
      $ne?: unknown
      $lt?: string | Date
      $lte?: string | Date
      $gt?: string | Date
      $gte?: string | Date
      $eq?: unknown
    }
    if (condition.$in) return condition.$in.includes(actual)
    if (condition.$nin) return !condition.$nin.includes(actual)
    if ('$ne' in condition) return condition.$ne === null ? actual !== null && actual !== undefined : actual !== condition.$ne
    if ('$eq' in condition) return actual === condition.$eq
    const text = typeof actual === 'string' ? actual : actual instanceof Date ? actual.toISOString() : null
    const bound = (value: string | Date) => (value instanceof Date ? value.toISOString() : value)
    if (condition.$lt !== undefined && !(text !== null && text < bound(condition.$lt))) return false
    if (condition.$lte !== undefined && !(text !== null && text <= bound(condition.$lte))) return false
    if (condition.$gt !== undefined && !(text !== null && text > bound(condition.$gt))) return false
    if (condition.$gte !== undefined && !(text !== null && text >= bound(condition.$gte))) return false
    return true
  }
  return (actual ?? null) === expected
}

export function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or' && Array.isArray(expected)) return expected.some((part) => matches(row, part as Where))
    if (key === '$and' && Array.isArray(expected)) return expected.every((part) => matches(row, part as Where))
    return compare(row[key], expected)
  })
}

function wallClockMinutes(value: string): { day: number; minutes: number; isoWeekday: number } {
  const [date, time = '00:00'] = value.replace(' ', 'T').split('T')
  const [year, month, dayOfMonth] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const day = Date.UTC(year, month - 1, dayOfMonth) / 86_400_000
  return { day, minutes: day * 1440 + hours * 60 + minutes, isoWeekday: ((new Date(day * 86_400_000).getUTCDay() + 6) % 7) + 1 }
}

function respondBookingsOutsideHours(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('from property_management_bookings') || !sql.includes('count(*) over ()')) return null
  const statusCount = (/status in \(([^)]*)\)/.exec(sql)?.[1].match(/\?/g) ?? []).length
  const [organizationId, tenantId, buildingId] = params as string[]
  const statuses = params.slice(3, 3 + statusCount)
  const now = wallClockMinutes(String(params[3 + statusCount])).minutes
  const windows = params.slice(4 + statusCount, -1) as number[]
  const limit = Number(params[params.length - 1])
  const insideWindow = (startsAt: string, endsAt: string) => {
    const start = wallClockMinutes(startsAt)
    const end = wallClockMinutes(endsAt).minutes
    for (let index = 0; index < windows.length; index += 3) {
      const [weekday, opensAt, closesAt] = windows.slice(index, index + 3)
      if (start.isoWeekday === weekday && start.minutes >= start.day * 1440 + opensAt && end <= start.day * 1440 + closesAt) return true
    }
    return false
  }
  const matching = em
    .rows({ name: 'Booking', prototype: {} })
    .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && row.buildingId === buildingId)
    .filter((row) => statuses.includes(row.status) && !row.deletedAt)
    .filter((row) => wallClockMinutes(String(row.endsAt)).minutes > now)
    .filter((row) => !insideWindow(String(row.startsAt), String(row.endsAt)))
    .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)) || left.id.localeCompare(right.id))
  return matching.slice(0, limit).map((row) => ({ id: row.id, total: String(matching.length) }))
}

function placeholderCount(match: RegExpMatchArray | undefined): number {
  return (match?.[1].match(/\?/g) ?? []).length
}

function respondClosureBookingSummary(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('from property_management_bookings') || !sql.includes('string_agg(id::text')) return null
  const statusLists = Array.from(sql.matchAll(/status in \(([^)]*)\)/g))
  const holdingCount = placeholderCount(statusLists[0])
  const tokenStatusCount = placeholderCount(statusLists[1])
  const unitCount = placeholderCount(/unit_id in \(([^)]*)\)/.exec(sql) ?? undefined)
  let cursor = 0
  const take = (count: number) => {
    const values = params.slice(cursor, cursor + count)
    cursor += count
    return values
  }
  const holding = take(holdingCount)
  const cutFrom = String(take(1)[0])
  const [organizationId, tenantId] = take(2) as string[]
  const unitIds = take(unitCount)
  const tokenStatuses = take(tokenStatusCount)
  const tokenFrom = String(take(1)[0])
  const end = sql.includes('starts_at <') ? String(take(1)[0]) : null
  const prefix = String(take(1)[0])
  const pendingStatus = String(take(1)[0])
  const candidates = em
    .rows({ name: 'Booking', prototype: {} })
    .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && !row.deletedAt)
    .filter((row) => unitIds.includes(row.unitId) && tokenStatuses.includes(row.status))
    .filter((row) => String(row.endsAt) > tokenFrom && (end === null || String(row.startsAt) < end))
  const affected = candidates.filter((row) => holding.includes(row.status) && String(row.endsAt) > cutFrom)
  const ids = candidates.map((row) => row.id).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return [{
    total: affected.length,
    token: createHash('sha256').update(`${prefix}${ids.join(',')}`).digest('hex'),
    needs_cancelled_status: affected.some((row) => Boolean(row.salesOrderId) || row.status === pendingStatus),
  }]
}

function paramCursor(params: unknown[]) {
  let cursor = 0
  return (count: number) => {
    const values = params.slice(cursor, cursor + count)
    cursor += count
    return values
  }
}

function wallClockBefore(left: unknown, right: unknown): boolean {
  return wallClockMinutes(String(left)).minutes < wallClockMinutes(String(right)).minutes
}

function respondTransactionProbe(sql: string): unknown[] | null {
  return sql.trim() === 'select 1' ? [{ '?column?': 1 }] : null
}

function respondLeaseReferenceCounterInsert(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('insert into property_management_lease_reference_counters') || !sql.includes('on conflict (organization_id, tenant_id) do nothing')) return null
  const [organizationId, tenantId, year] = params
  const counters = em.rows({ name: 'LeaseReferenceCounter', prototype: {} })
  if (!counters.some((row) => row.organizationId === organizationId && row.tenantId === tenantId)) {
    counters.push({ id: `counter-${counters.length + 1}`, organizationId, tenantId, year, lastNumber: 0, createdAt: new Date(), updatedAt: new Date() })
  }
  return []
}

function bookingCandidates(em: FakeEm, organizationId: unknown, tenantId: unknown, unitIds: unknown[]): Row[] {
  return em
    .rows({ name: 'Booking', prototype: {} })
    .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && unitIds.includes(row.unitId))
}

function respondDistinctBookedUnits(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!/^\s*select distinct unit_id from property_management_bookings/.test(sql)) return null
  const take = paramCursor(params)
  const [organizationId, tenantId] = take(2)
  const unitIds = take(placeholderCount(/unit_id in \(([^)]*)\)/.exec(sql) ?? undefined))
  const statusMatch = /status in \(([^)]*)\)/.exec(sql) ?? undefined
  const statuses = statusMatch ? take(placeholderCount(statusMatch)) : null
  const startsBefore = sql.includes('starts_at < ?') ? take(1)[0] : null
  const endsAfter = sql.includes('ends_at > ?') ? take(1)[0] : null
  const liveOnly = sql.includes('deleted_at is null')
  const units = bookingCandidates(em, organizationId, tenantId, unitIds)
    .filter((row) => !liveOnly || !row.deletedAt)
    .filter((row) => statuses === null || statuses.includes(row.status))
    .filter((row) => startsBefore === null || wallClockBefore(row.startsAt, startsBefore))
    .filter((row) => endsAfter === null || wallClockBefore(endsAfter, row.endsAt))
    .map((row) => row.unitId)
  return Array.from(new Set(units)).map((unitId) => ({ unit_id: unitId }))
}

function respondRankedUnitBookings(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('row_number() over (partition by unit_id order by starts_at asc, id asc)')) return null
  const take = paramCursor(params)
  const [organizationId, tenantId] = take(2)
  const unitIds = take(placeholderCount(/unit_id in \(([^)]*)\)/.exec(sql) ?? undefined))
  const statuses = take(placeholderCount(/status in \(([^)]*)\)/.exec(sql) ?? undefined))
  const [endsAfter, size] = take(2)
  const matching = bookingCandidates(em, organizationId, tenantId, unitIds)
    .filter((row) => !row.deletedAt && statuses.includes(row.status) && wallClockBefore(endsAfter, row.endsAt))
    .sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)) || left.id.localeCompare(right.id))
  return [...unitIds]
    .map(String)
    .sort()
    .flatMap((unitId) => {
      const mine = matching.filter((row) => row.unitId === unitId)
      return mine.slice(0, Number(size)).map((row) => ({ id: row.id, unit_id: unitId, unit_total: String(mine.length) }))
    })
}

function respondOrderStatusEntry(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('from dictionary_entries entry') || !sql.includes("dictionary.key = 'sales.order_status'")) return null
  const byEntryId = sql.includes('where entry.id = ?')
  const take = paramCursor(params)
  const entryId = byEntryId ? take(1)[0] : null
  const [organizationId, tenantId, entryOrganizationId, entryTenantId] = take(4)
  const normalizedValue = byEntryId ? null : take(1)[0]
  const dictionaryIds = new Set(
    em
      .rows({ name: 'Dictionary', prototype: {} })
      .filter((row) => row.key === 'sales.order_status' && row.organizationId === organizationId && row.tenantId === tenantId && !row.deletedAt)
      .map((row) => row.id),
  )
  const entry = em
    .rows({ name: 'DictionaryEntry', prototype: {} })
    .find((row) =>
      dictionaryIds.has(String(linkedId(row.dictionary))) &&
      row.organizationId === entryOrganizationId &&
      row.tenantId === entryTenantId &&
      (byEntryId ? row.id === entryId : row.normalizedValue === normalizedValue),
    )
  return entry ? [{ id: entry.id }] : []
}

function linkedId(link: unknown): unknown {
  return link && typeof link === 'object' ? (link as Row).id : link
}

function respondFirstOrderLine(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!/^\s*select id from sales_order_lines/.test(sql) || !sql.includes('order by line_number asc limit 1')) return null
  const [orderId, organizationId, tenantId] = params
  const liveOnly = sql.includes('deleted_at is null')
  const lines = em
    .rows({ name: 'SalesOrderLine', prototype: {} })
    .filter((row) => linkedId(row.order) === orderId && row.organizationId === organizationId && row.tenantId === tenantId)
    .filter((row) => !liveOnly || !row.deletedAt)
    .sort((left, right) => Number(left.lineNumber ?? 0) - Number(right.lineNumber ?? 0))
  return lines.slice(0, 1).map((row) => ({ id: row.id }))
}

export function rejectUnmodelledSql(sql: string): never {
  throw new Error(`[internal] FakeEm does not model this raw SQL; give the test an explicit respond handler: ${sql.replace(/\s+/g, ' ').trim()}`)
}

export function respondDefault(em: FakeEm, sql: string, params: unknown[]): unknown[] {
  return (
    respondTransactionProbe(sql) ??
    respondLeaseReferenceCounterInsert(em, sql, params) ??
    respondBookingsOutsideHours(em, sql, params) ??
    respondClosureBookingSummary(em, sql, params) ??
    respondDistinctBookedUnits(em, sql, params) ??
    respondRankedUnitBookings(em, sql, params) ??
    respondOrderStatusEntry(em, sql, params) ??
    respondFirstOrderLine(em, sql, params) ??
    rejectUnmodelledSql(sql)
  )
}

export class FakeEm {
  store = new Map<string, Row[]>()
  lockFailures = new Set<string>()
  flushes = 0
  executed: Array<{ sql: string; params: unknown[] }> = []
  respond: (sql: string, params: unknown[]) => unknown[] = (sql, params) => respondDefault(this, sql, params)

  rows(entity: EntityClass): Row[] {
    const list = this.store.get(entity.name) ?? []
    this.store.set(entity.name, list)
    return list
  }

  async find(entity: EntityClass, where: Where, options?: FindOptions) {
    let result = this.rows(entity).filter((row) => matches(row, where))
    const order = options?.orderBy ? Object.entries(options.orderBy) : []
    if (order.length) {
      result = [...result].sort((left, right) => {
        for (const [field, direction] of order) {
          const a = left[field] as number | string
          const b = right[field] as number | string
          const outcome = (a < b ? -1 : a > b ? 1 : 0) * (direction === 'desc' ? -1 : 1)
          if (outcome !== 0) return outcome
        }
        return 0
      })
    }
    return options?.limit ? result.slice(0, options.limit) : result
  }

  async count(entity: EntityClass, where: Where) {
    return this.rows(entity).filter((row) => matches(row, where)).length
  }

  async findOne(entity: EntityClass, where: Where, options?: FindOptions) {
    const row = this.rows(entity).find((candidate) => matches(candidate, where)) ?? null
    if (row && options?.lockMode === 5 && this.lockFailures.has(row.id)) {
      throw Object.assign(new Error('could not obtain lock on row'), { code: '55P03' })
    }
    if (row && options?.lockMode === 4 && this.lockFailures.has(row.id)) return null
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

  async nativeUpdate(entity: EntityClass, where: Where, data: Record<string, unknown>) {
    const targets = this.rows(entity).filter((row) => matches(row, where))
    for (const row of targets) Object.assign(row, data)
    return targets.length
  }

  remove(row: Row) {
    const list = this.rows(row.constructor as EntityClass)
    const index = list.indexOf(row)
    if (index >= 0) list.splice(index, 1)
  }

  async flush() {
    this.flushes += 1
    this.assertSingleOpenPeriodPerUnit()
  }

  private assertSingleOpenPeriodPerUnit() {
    const openUnits = new Set<unknown>()
    for (const row of this.store.get('UnitProductPeriod') ?? []) {
      if (row.validTo) continue
      if (openUnits.has(row.unitId)) {
        throw new UniqueConstraintViolationException(
          Object.assign(new Error('duplicate key value violates unique constraint "property_management_unit_product_periods_open_unique"'), {
            code: '23505',
            constraint: 'property_management_unit_product_periods_open_unique',
          }),
        )
      }
      openUnits.add(row.unitId)
    }
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
        return this.respond(sql, params)
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
