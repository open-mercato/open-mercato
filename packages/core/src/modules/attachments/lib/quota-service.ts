import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { AttachmentQuotaReservation } from '../data/entities'
import { resolveAttachmentTenantQuotaBytes } from './upload-limits'

const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000

export type AttachmentQuotaSource =
  | 'attachment'
  | 'storage_s3_upload'
  | 'storage_s3_signed'
  | 'storage_service'

export type AttachmentQuotaReservationHandle = {
  id: string
  leaseToken: string
  expiresAt: Date
}

export type AttachmentQuotaReservationRecord = {
  id: string
  tenantId: string
  organizationId: string
  reservedBytes: number
  actualBytes: number | null
  status: 'reserved' | 'storing' | 'stored' | 'recovering' | 'committed'
  source: AttachmentQuotaSource
  storageDriver: string
  partitionCode: string | null
  storagePath: string
  leaseToken: string
  uploadTokenHash: string | null
  expiresAt: Date | null
}

export class AttachmentQuotaError extends Error {
  constructor(
    public readonly code:
      | 'quota_exceeded'
      | 'quota_accounting_unavailable'
      | 'quota_target_exists'
      | 'quota_lease_lost',
    message: string,
  ) {
    super(message)
    this.name = 'AttachmentQuotaError'
  }
}

function parseUsage(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  throw new AttachmentQuotaError('quota_accounting_unavailable', 'Storage quota accounting returned an invalid value.')
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function changedRow(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0
  if (!result || typeof result !== 'object') return false
  if ('id' in result) return true
  if ('numUpdatedRows' in result) return Number((result as { numUpdatedRows?: unknown }).numUpdatedRows ?? 0) > 0
  if ('numDeletedRows' in result) return Number((result as { numDeletedRows?: unknown }).numDeletedRows ?? 0) > 0
  return false
}

function mapReservationRow(row: any): AttachmentQuotaReservationRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    organizationId: String(row.organization_id),
    reservedBytes: parseUsage(row.reserved_bytes),
    actualBytes: row.actual_bytes == null ? null : parseUsage(row.actual_bytes),
    status: row.status,
    source: row.source,
    storageDriver: String(row.storage_driver),
    partitionCode: row.partition_code == null ? null : String(row.partition_code),
    storagePath: String(row.storage_path),
    leaseToken: String(row.lease_token),
    uploadTokenHash: row.upload_token_hash == null ? null : String(row.upload_token_hash),
    expiresAt: row.expires_at == null ? null : new Date(row.expires_at),
  } as AttachmentQuotaReservationRecord
}

export class AttachmentQuotaService {
  constructor(private readonly em: EntityManager) {}

  async reserve(input: {
    tenantId: string
    organizationId: string
    bytes: number
    source: AttachmentQuotaSource
    storageDriver: string
    storagePath: string
    partitionCode?: string | null
    uploadTokenHash?: string | null
    ttlMs?: number
  }): Promise<AttachmentQuotaReservationHandle> {
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
      throw new AttachmentQuotaError('quota_accounting_unavailable', 'Reservation bytes must be a non-negative safe integer.')
    }
    const id = randomUUID()
    const leaseToken = randomUUID()
    const expiresAt = new Date(Date.now() + Math.max(1_000, input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS))

    try {
      await this.em.transactional(async (tx) => {
        const db = tx.getKysely<any>() as any
        await sql`select pg_advisory_xact_lock(hashtextextended(${`attachment-quota:${input.tenantId}`}, 0))`.execute(db)

        const attachmentUsage = await db
          .selectFrom('attachments')
          .select(sql<string>`coalesce(sum(file_size), 0)`.as('total_size'))
          .where('tenant_id', '=', input.tenantId)
          .executeTakeFirst()
        const ledgerUsage = await db
          .selectFrom('attachment_quota_reservations')
          .select(
            sql<string>`coalesce(sum(case when status = 'committed' then actual_bytes else reserved_bytes end), 0)`.as('total_size'),
          )
          .where('tenant_id', '=', input.tenantId)
          .executeTakeFirst()

        const usedBytes = parseUsage(attachmentUsage?.total_size) + parseUsage(ledgerUsage?.total_size)
        if (usedBytes + input.bytes > resolveAttachmentTenantQuotaBytes()) {
          throw new AttachmentQuotaError('quota_exceeded', 'Attachment storage quota exceeded for this tenant.')
        }

        const reservation = tx.create(AttachmentQuotaReservation, {
          id,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          reservedBytes: input.bytes,
          actualBytes: null,
          status: 'reserved',
          source: input.source,
          storageDriver: input.storageDriver,
          partitionCode: input.partitionCode ?? null,
          storagePath: input.storagePath,
          leaseToken,
          uploadTokenHash: input.uploadTokenHash ?? null,
          expiresAt,
        })
        await tx.persist(reservation).flush()
      })
    } catch (error) {
      if (error instanceof AttachmentQuotaError) throw error
      if (isUniqueViolation(error)) {
        throw new AttachmentQuotaError('quota_target_exists', 'The target storage path already has an active allocation.')
      }
      throw new AttachmentQuotaError('quota_accounting_unavailable', 'Storage quota accounting is unavailable.')
    }

    return { id, leaseToken, expiresAt }
  }

  async beginStorage(id: string, leaseToken: string, ttlMs = DEFAULT_RESERVATION_TTL_MS): Promise<void> {
    await this.transition(id, leaseToken, 'reserved', 'storing', {
      expires_at: new Date(Date.now() + Math.max(1_000, ttlMs)),
    })
  }

  async markStored(id: string, leaseToken: string): Promise<void> {
    await this.transition(id, leaseToken, 'storing', 'stored')
  }

  async completeAttachment(id: string, leaseToken: string, manager: EntityManager = this.em): Promise<void> {
    const db = manager.getKysely<any>() as any
    const result = await db
      .deleteFrom('attachment_quota_reservations')
      .where('id', '=', id)
      .where('lease_token', '=', leaseToken)
      .where('status', '=', 'stored')
      .returning('id')
      .executeTakeFirst()
    if (!changedRow(result)) throw new AttachmentQuotaError('quota_lease_lost', 'The upload reservation lease was lost.')
  }

  async completeStandalone(id: string, leaseToken: string, actualBytes: number): Promise<void> {
    if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
      throw new AttachmentQuotaError('quota_accounting_unavailable', 'Actual bytes must be a non-negative safe integer.')
    }
    const db = this.em.getKysely<any>() as any
    const result = await db
      .updateTable('attachment_quota_reservations')
      .set({ status: 'committed', actual_bytes: actualBytes, expires_at: null, upload_token_hash: null, updated_at: new Date() })
      .where('id', '=', id)
      .where('lease_token', '=', leaseToken)
      .where('status', '=', 'stored')
      .where('reserved_bytes', '>=', actualBytes)
      .returning('id')
      .executeTakeFirst()
    if (!changedRow(result)) throw new AttachmentQuotaError('quota_lease_lost', 'The upload reservation lease was lost.')
  }

  async release(id: string, leaseToken?: string): Promise<void> {
    const db = this.em.getKysely<any>() as any
    let query = db
      .deleteFrom('attachment_quota_reservations')
      .where('id', '=', id)
      .where('status', '!=', 'committed')
    if (leaseToken) query = query.where('lease_token', '=', leaseToken)
    await query.execute()
  }

  async releaseCommittedByPath(input: {
    tenantId: string
    storageDriver: string
    storagePath: string
  }): Promise<void> {
    const db = this.em.getKysely<any>() as any
    await db
      .deleteFrom('attachment_quota_reservations')
      .where('tenant_id', '=', input.tenantId)
      .where('storage_driver', '=', input.storageDriver)
      .where('storage_path', '=', input.storagePath)
      .where('status', '=', 'committed')
      .execute()
  }

  async findPendingByUploadTokenHash(uploadTokenHash: string): Promise<AttachmentQuotaReservationRecord | null> {
    const db = this.em.getKysely<any>() as any
    const row = await db
      .selectFrom('attachment_quota_reservations')
      .selectAll()
      .where('upload_token_hash', '=', uploadTokenHash)
      .where('status', '=', 'reserved')
      .where('expires_at', '>', new Date())
      .executeTakeFirst()
    if (!row) return null
    return mapReservationRow(row)
  }

  async claimPendingByUploadTokenHash(
    uploadTokenHash: string,
    ttlMs = DEFAULT_RESERVATION_TTL_MS,
  ): Promise<AttachmentQuotaReservationRecord | null> {
    const db = this.em.getKysely<any>() as any
    const leaseToken = randomUUID()
    const row = await db
      .updateTable('attachment_quota_reservations')
      .set({
        status: 'storing',
        lease_token: leaseToken,
        expires_at: new Date(Date.now() + Math.max(1_000, ttlMs)),
        updated_at: new Date(),
      })
      .where('upload_token_hash', '=', uploadTokenHash)
      .where('status', '=', 'reserved')
      .where('expires_at', '>', new Date())
      .returningAll()
      .executeTakeFirst()
    return row ? mapReservationRow(row) : null
  }

  async getReservation(id: string): Promise<AttachmentQuotaReservationRecord | null> {
    const db = this.em.getKysely<any>() as any
    const row = await db
      .selectFrom('attachment_quota_reservations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? mapReservationRow(row) : null
  }

  async claimExpired(id: string, recoveryTtlMs = DEFAULT_RESERVATION_TTL_MS): Promise<AttachmentQuotaReservationRecord | null> {
    const db = this.em.getKysely<any>() as any
    const leaseToken = randomUUID()
    const row = await db
      .updateTable('attachment_quota_reservations')
      .set({
        status: 'recovering',
        lease_token: leaseToken,
        expires_at: new Date(Date.now() + Math.max(1_000, recoveryTtlMs)),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('status', 'in', ['reserved', 'storing', 'stored', 'recovering'])
      .where('expires_at', '<=', new Date())
      .returningAll()
      .executeTakeFirst()
    return row ? mapReservationRow(row) : null
  }

  async commitRecoveredStandalone(id: string, leaseToken: string, actualBytes: number): Promise<void> {
    const db = this.em.getKysely<any>() as any
    const result = await db
      .updateTable('attachment_quota_reservations')
      .set({ status: 'committed', actual_bytes: actualBytes, expires_at: null, upload_token_hash: null, updated_at: new Date() })
      .where('id', '=', id)
      .where('lease_token', '=', leaseToken)
      .where('status', '=', 'recovering')
      .where('reserved_bytes', '>=', actualBytes)
      .returning('id')
      .executeTakeFirst()
    if (!changedRow(result)) throw new AttachmentQuotaError('quota_lease_lost', 'The recovery reservation lease was lost.')
  }

  async reconcileStandaloneObjects(input: {
    tenantId: string
    organizationId: string
    storageDriver: string
    objects: Array<{ path: string; bytes: number }>
  }): Promise<void> {
    const uniqueObjects = Array.from(new Map(input.objects.map((object) => [object.path, object])).values())
    const attachmentPaths = new Set<string>()
    const db = this.em.getKysely<any>() as any
    for (let offset = 0; offset < uniqueObjects.length; offset += 500) {
      const paths = uniqueObjects.slice(offset, offset + 500).map((object) => object.path)
      if (paths.length === 0) continue
      const rows = await db
        .selectFrom('attachments')
        .select('storage_path')
        .where('tenant_id', '=', input.tenantId)
        .where('storage_driver', '=', input.storageDriver)
        .where('storage_path', 'in', paths)
        .execute()
      for (const row of rows) attachmentPaths.add(String(row.storage_path))
    }

    for (const object of uniqueObjects) {
      if (!Number.isSafeInteger(object.bytes) || object.bytes < 0) {
        throw new AttachmentQuotaError('quota_accounting_unavailable', 'Standalone storage accounting returned an invalid size.')
      }
      if (attachmentPaths.has(object.path)) continue
      await db
        .insertInto('attachment_quota_reservations')
        .values({
          id: randomUUID(),
          tenant_id: input.tenantId,
          organization_id: input.organizationId,
          reserved_bytes: object.bytes,
          actual_bytes: object.bytes,
          status: 'committed',
          source: 'storage_s3_upload',
          storage_driver: input.storageDriver,
          partition_code: null,
          storage_path: object.path,
          lease_token: randomUUID(),
          upload_token_hash: null,
          expires_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((conflict: any) => conflict.columns(['tenant_id', 'storage_driver', 'storage_path']).doNothing())
        .execute()
    }
  }

  private async transition(
    id: string,
    leaseToken: string,
    from: AttachmentQuotaReservationRecord['status'],
    to: AttachmentQuotaReservationRecord['status'],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const db = this.em.getKysely<any>() as any
    const result = await db
      .updateTable('attachment_quota_reservations')
      .set({ status: to, updated_at: new Date(), ...extra })
      .where('id', '=', id)
      .where('lease_token', '=', leaseToken)
      .where('status', '=', from)
      .returning('id')
      .executeTakeFirst()
    if (!changedRow(result)) throw new AttachmentQuotaError('quota_lease_lost', 'The upload reservation lease was lost.')
  }
}

export function createAttachmentQuotaService(em: EntityManager): AttachmentQuotaService {
  return new AttachmentQuotaService(em)
}
