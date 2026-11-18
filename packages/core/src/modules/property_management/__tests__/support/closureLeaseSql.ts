import { Lease } from '../../data/entities'
import { reservedInterval } from '../../lib/leaseTerm'
import type { FakeEm, Row } from './fakeEm'

function placeholders(sql: string, pattern: RegExp): number {
  return (pattern.exec(sql)?.[1].match(/\?/g) ?? []).length
}

export function respondClosureLeases(em: FakeEm, sql: string, params: unknown[]): unknown[] | null {
  if (!sql.includes('from property_management_leases lease') || sql.includes(' join ')) return null
  const unitCount = placeholders(sql, /lease\.unit_id in \(([^)]*)\)/)
  const statusCount = placeholders(sql, /lease\.status in \(([^)]*)\)/)
  let cursor = 0
  const take = (count: number) => {
    const values = params.slice(cursor, cursor + count)
    cursor += count
    return values
  }
  const [organizationId, tenantId] = take(2) as string[]
  const unitIds = take(unitCount)
  const statuses = take(statusCount)
  const [today, startsOn] = take(2) as string[]
  const endsOn = sql.includes('<= ?::date') ? String(take(1)[0]) : null
  const limit = sql.includes('limit ?') ? Number(take(1)[0]) : null
  const matching = em
    .rows(Lease)
    .filter((row) => row.organizationId === organizationId && row.tenantId === tenantId && !row.deletedAt)
    .filter((row) => unitIds.includes(row.unitId) && statuses.includes(row.status))
    .filter((row) => {
      const reserved = reservedInterval(row as unknown as Parameters<typeof reservedInterval>[0])
      return reserved.endsOn >= today && reserved.endsOn >= startsOn && (endsOn === null || reserved.startsOn <= endsOn)
    })
  if (sql.includes('count(*)')) return [{ total: matching.length }]
  const ordered = [...matching].sort(
    (left: Row, right: Row) => String(left.startsOn).localeCompare(String(right.startsOn)) || left.id.localeCompare(right.id),
  )
  return (limit === null ? ordered : ordered.slice(0, limit)).map((row) => ({ id: row.id }))
}

export function withClosureLeaseSql(em: FakeEm): FakeEm {
  const respond = em.respond
  em.respond = (sql, params) => respondClosureLeases(em, sql, params) ?? respond(sql, params)
  return em
}
