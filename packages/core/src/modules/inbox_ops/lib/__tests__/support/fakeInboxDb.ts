import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxEmail, InboxEmailAttachment } from '../../../data/entities'
import { RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL } from '../../inboundAttachments'
import {
  SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL,
  SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL,
  SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL,
} from '../../inboundAttachmentMaintenance'

/**
 * In-memory stand-in for `inbox_emails` and `inbox_email_attachments` that evaluates the filters
 * and the two `raw()` expressions the ingest code uses, so ingest scenarios run without a
 * database. Real SQL semantics are covered by `__tests__/attachment-ingest.pg.test.ts`.
 */

export type Row = Record<string, unknown> & { id: string }

type Filter = Record<string, unknown>

export const TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const ORG_ID = '22222222-2222-4222-8222-222222222222'
export const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')

function isRaw(value: unknown): value is { sql: string; params?: unknown[] } {
  return Boolean(value) && typeof value === 'object' && typeof (value as { sql?: unknown }).sql === 'string'
}

function toComparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' || typeof value === 'string') return value
  return String(value)
}

function matchesOperator(value: unknown, operator: string, operand: unknown): boolean {
  const left = toComparable(value)
  switch (operator) {
    case '$in':
      return Array.isArray(operand) && operand.some((candidate) => toComparable(candidate) === left)
    case '$ne':
      return operand === null ? left !== null : left !== toComparable(operand)
    case '$lt': {
      const right = toComparable(operand)
      return left !== null && right !== null && left < right
    }
    case '$lte': {
      const right = toComparable(operand)
      return left !== null && right !== null && left <= right
    }
    default:
      throw new Error(`fake db: unsupported operator ${operator}`)
  }
}

export function matchesFilter(row: Row, where: Filter): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Filter[]).every((part) => matchesFilter(row, part))
    if (key === '$or') return (condition as Filter[]).some((part) => matchesFilter(row, part))
    const value = row[key]
    if (condition === null) return value === null || value === undefined
    if (condition instanceof Date) return toComparable(value) === condition.getTime()
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      return Object.entries(condition as Filter).every(([operator, operand]) => matchesOperator(value, operator, operand))
    }
    return toComparable(value) === toComparable(condition)
  })
}

function evaluateRaw(previous: Row, fragment: { sql: string; params?: unknown[] }): unknown {
  if (fragment.sql.includes(`case when "attachments_status" = 'processing'`)) {
    return previous.attachmentsStatus === 'processing'
      ? (previous.attachmentsFirstFailureAt ?? fragment.params?.[0] ?? null)
      : (previous.attachmentsFirstFailureAt ?? null)
  }
  if (fragment.sql.includes(`case when "attachments_status" is null`)) {
    return previous.attachmentsStatus == null ? null : 'completed'
  }
  throw new Error(`fake db: unsupported raw fragment ${fragment.sql}`)
}

type UpdateHook = (entity: 'email' | 'part', where: Filter, data: Filter) => void | Promise<void>

export class FakeInboxDb {
  readonly emails = new Map<string, Row>()
  readonly parts = new Map<string, Row>()
  readonly executed: Array<{ sql: string; params: unknown[] }> = []
  beforeUpdate: UpdateHook | null = null

  table(entity: unknown): Map<string, Row> {
    if (entity === InboxEmail) return this.emails
    if (entity === InboxEmailAttachment) return this.parts
    throw new Error('fake db: unknown entity')
  }

  addEmail(values: Partial<Row> = {}): Row {
    const row: Row = {
      id: randomUUID(),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      forwardedByAddress: 'sender@example.test',
      subject: 'Offer',
      metadata: { attachmentIngest: { provider: 'resend', providerEmailId: 'resend-email-1' } },
      attachmentIds: null,
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsClaimedAt: null,
      attachmentsFirstFailureAt: null,
      attachmentsReleaseRequestedAt: null,
      attachmentsReleasedAt: null,
      attachmentsIngestGeneration: 1,
      attachmentsCurrentGeneration: 1,
      attachmentsNextRunAt: new Date(),
      deletedAt: null,
      updatedAt: UPDATED_AT,
      ...values,
    }
    this.emails.set(row.id, row)
    return row
  }

  addPart(emailId: string, providerId: string, values: Partial<Row> = {}): Row {
    const row: Row = {
      id: randomUUID(),
      inboxEmailId: emailId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      partKey: `resend:${providerId}`,
      fileName: `${providerId}.pdf`,
      declaredMimeType: 'application/pdf',
      mimeType: null,
      sizeBytes: 3,
      contentId: null,
      attempts: 0,
      inFlightAt: null,
      disposition: 'attachment',
      status: 'pending',
      reason: null,
      attachmentId: null,
      extractedText: null,
      createdAt: new Date(Date.now() + this.parts.size),
      updatedAt: UPDATED_AT,
      deletedAt: null,
      ...values,
    }
    this.parts.set(row.id, row)
    return row
  }

  email(id: string): Row {
    const row = this.emails.get(id)
    if (!row) throw new Error('fake db: missing email')
    return row
  }

  partsOf(emailId: string): Row[] {
    return [...this.parts.values()]
      .filter((row) => row.inboxEmailId === emailId)
      .sort((left, right) => (left.createdAt as Date).getTime() - (right.createdAt as Date).getTime())
  }

  part(partId: string): Row {
    const row = this.parts.get(partId)
    if (!row) throw new Error('fake db: missing part')
    return row
  }

  async nativeUpdate(entity: unknown, where: Filter, data: Filter): Promise<number> {
    if (this.beforeUpdate) await this.beforeUpdate(entity === InboxEmail ? 'email' : 'part', where, data)
    let count = 0
    for (const row of this.table(entity).values()) {
      if (!matchesFilter(row, where)) continue
      const previous = { ...row }
      for (const [key, value] of Object.entries(data)) {
        row[key] = isRaw(value) ? evaluateRaw(previous, value) : value
      }
      count += 1
    }
    return count
  }

  find(entity: unknown, where: Filter, options?: { orderBy?: Record<string, 'asc' | 'desc'> }): Row[] {
    const rows = [...this.table(entity).values()].filter((row) => matchesFilter(row, where)).map((row) => ({ ...row }))
    const order = Object.entries(options?.orderBy ?? {})
    rows.sort((left, right) => {
      for (const [key, direction] of order) {
        const a = toComparable(left[key])
        const b = toComparable(right[key])
        if (a === b) continue
        if (a === null) return -1
        if (b === null) return 1
        return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1)
      }
      return 0
    })
    return rows
  }

  execute(sql: string, params: unknown[] = []): unknown[] {
    this.executed.push({ sql, params })
    if (sql.startsWith(RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL)) return this.reserve(sql, params)
    if (sql === SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL) return this.selectStranded(params)
    if (sql === SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL) {
      return this.selectRows((row) => row.deletedAt != null && ['pending', 'processing'].includes(String(row.attachmentsStatus)), params[0])
    }
    if (sql === SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL) {
      return this.selectRows(
        (row) => row.deletedAt != null && row.attachmentsReleasedAt == null && (row.attachmentsStatus != null || row.attachmentsReleaseRequestedAt != null),
        params[0],
      )
    }
    if (sql.includes('from inbox_email_attachments where status = \'stored\'')) {
      return [...this.parts.values()].some((row) => row.status === 'stored' && row.deletedAt == null) ? [{ found: 1 }] : []
    }
    throw new Error(`fake db: unsupported sql ${sql}`)
  }

  private reserve(sql: string, params: unknown[]): unknown[] {
    const [id, tenantId, organizationId, jobGeneration] = params
    const row = this.emails.get(String(id))
    if (!row || row.tenantId !== tenantId || row.organizationId !== organizationId) return []
    if (row.deletedAt != null || !['pending', 'processing'].includes(String(row.attachmentsStatus))) return []
    if (sql.includes('attachments_current_generation, 0) <= ?') && Number(row.attachmentsCurrentGeneration ?? 0) > Number(jobGeneration)) return []
    row.attachmentsIngestGeneration = Number(row.attachmentsIngestGeneration ?? 0) + 1
    return [{ generation: row.attachmentsIngestGeneration }]
  }

  private selectStranded(params: unknown[]): unknown[] {
    const [nextRunCutoff, leaseCutoff, , limit] = params as [Date, Date, Date, number]
    const due = (row: Row) => row.attachmentsNextRunAt == null || (row.attachmentsNextRunAt as Date) < nextRunCutoff
    return this.selectRows((row) => {
      if (row.deletedAt != null) return false
      if (row.attachmentsStatus === 'pending') return due(row)
      if (row.attachmentsStatus !== 'processing') return false
      const leaseExpired = row.attachmentsClaimedAt == null || (row.attachmentsClaimedAt as Date) < leaseCutoff
      return leaseExpired && due(row)
    }, limit, 'attachmentsNextRunAt')
  }

  private selectRows(predicate: (row: Row) => boolean, limit: unknown, orderKey = 'deletedAt'): unknown[] {
    return [...this.emails.values()]
      .filter(predicate)
      .sort((left, right) => (toComparable(left[orderKey]) ?? -Infinity) as number - ((toComparable(right[orderKey]) ?? -Infinity) as number))
      .slice(0, Number(limit))
      .map((row) => ({ id: row.id, tenant_id: row.tenantId, organization_id: row.organizationId }))
  }

  entityManager(): EntityManager {
    const em = {
      nativeUpdate: (entity: unknown, where: Filter, data: Filter) => this.nativeUpdate(entity, where, data),
      transactional: async <T>(fn: (tx: EntityManager) => Promise<T>) => fn(em as unknown as EntityManager),
      getConnection: () => ({ execute: async (sql: string, params?: unknown[]) => this.execute(sql, params ?? []) }),
      fork: () => em,
      __fakeDb: this,
    }
    return em as unknown as EntityManager
  }
}

export function fakeDbOf(em: unknown): FakeInboxDb {
  const db = (em as { __fakeDb?: FakeInboxDb }).__fakeDb
  if (!db) throw new Error('fake db: not a fake entity manager')
  return db
}

/** `findWithDecryption` / `findOneWithDecryption` stand-ins bound to the fake entity manager. */
export const fakeDecryption = {
  findWithDecryption: async (em: unknown, entity: unknown, where: Filter, options?: { orderBy?: Record<string, 'asc' | 'desc'> }) =>
    fakeDbOf(em).find(entity, where, options),
  findOneWithDecryption: async (em: unknown, entity: unknown, where: Filter) =>
    fakeDbOf(em).find(entity, where)[0] ?? null,
}
