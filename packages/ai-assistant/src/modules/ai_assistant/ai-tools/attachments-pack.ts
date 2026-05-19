/**
 * General-purpose `attachments.*` tool pack (Phase 1 WS-C, Step 3.8).
 *
 * Read-only tools return metadata + optional extracted text; the
 * attachment-to-model bridge (Step 3.7) owns raw bytes / signed URLs.
 * The transfer tool is the only mutation — agents with `readOnly: true`
 * are already filtered by the Step 3.2 policy gate.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineAiTool } from '../lib/ai-tool-definition'
import type { AiToolDefinition } from '../lib/types'

type AttachmentMetadataModule = {
  readAttachmentMetadata: (raw: unknown) => {
    tags?: string[]
    assignments?: Array<{ type: string; id: string; href?: string | null; label?: string | null }>
  }
  mergeAttachmentMetadata: (
    raw: unknown,
    patch: { assignments?: unknown; tags?: unknown },
  ) => Record<string, unknown>
}

type AttachmentEntityModule = {
  Attachment: new () => unknown
}

async function loadAttachmentEntity(): Promise<AttachmentEntityModule['Attachment']> {
  const mod = (await import(
    '@open-mercato/core/modules/attachments/data/entities'
  )) as AttachmentEntityModule
  return mod.Attachment
}

async function loadAttachmentMetadata(): Promise<AttachmentMetadataModule> {
  const mod = (await import(
    '@open-mercato/core/modules/attachments/lib/metadata'
  )) as AttachmentMetadataModule
  return mod
}

type AttachmentRow = {
  id: string
  entityId: string
  recordId: string
  fileName: string
  mimeType: string
  fileSize: number
  storageMetadata?: Record<string, unknown> | null
  url?: string
  content?: string | null
  tenantId?: string | null
  organizationId?: string | null
  partitionCode?: string
  createdAt?: Date
}

function assertTenantScope(ctx: { tenantId: string | null }): string {
  if (!ctx.tenantId) {
    throw new Error('Tenant context is required for attachments tools')
  }
  return ctx.tenantId
}

function resolveEm(ctx: {
  container: { resolve: <T = unknown>(name: string) => T }
}): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

const listInput = z.object({
  entityType: z.string().min(1).describe('Entity identifier (e.g. "customers:customer_person_profile").'),
  recordId: z.string().min(1).describe('Record identifier within that entity.'),
})

const listRecordAttachmentsTool = defineAiTool({
  name: 'attachments.list_record_attachments',
  displayName: 'List record attachments',
  description:
    'List attachments bound to a record, scoped to the caller tenant and organization. Returns metadata only (no bytes, no signed URL).',
  inputSchema: listInput,
  requiredFeatures: ['attachments.view'],
  tags: ['read', 'attachments'],
  handler: async (rawInput, ctx) => {
    const tenantId = assertTenantScope(ctx)
    const input = listInput.parse(rawInput)
    const em = resolveEm(ctx)
    const Attachment = await loadAttachmentEntity()
    const where: Record<string, unknown> = {
      entityId: input.entityType,
      recordId: input.recordId,
      tenantId,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const rows = (await findWithDecryption<AttachmentRow>(
      em,
      Attachment as unknown as new () => AttachmentRow,
      where,
      { orderBy: { createdAt: 'desc' } as any },
      { tenantId, organizationId: ctx.organizationId },
    )) as AttachmentRow[]
    return {
      entityType: input.entityType,
      recordId: input.recordId,
      total: rows.length,
      items: rows.map((row) => ({
        id: row.id,
        entityType: row.entityId,
        recordId: row.recordId,
        fileName: row.fileName,
        mediaType: row.mimeType,
        size: row.fileSize,
        partitionCode: row.partitionCode,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
    }
  },
})

const readInput = z.object({
  attachmentId: z.string().uuid().describe('Attachment identifier.'),
  includeExtractedText: z
    .boolean()
    .optional()
    .describe('When true, include the stored extracted / OCR text if present (default false).'),
})

const readAttachmentTool = defineAiTool({
  name: 'attachments.read_attachment',
  displayName: 'Read attachment metadata',
  description:
    'Return attachment metadata, tags, assignments, and optionally the stored extracted text. Never returns raw bytes or signed URLs.',
  inputSchema: readInput,
  requiredFeatures: ['attachments.view'],
  tags: ['read', 'attachments'],
  handler: async (rawInput, ctx) => {
    const tenantId = assertTenantScope(ctx)
    const input = readInput.parse(rawInput)
    const em = resolveEm(ctx)
    const Attachment = await loadAttachmentEntity()
    const { readAttachmentMetadata } = await loadAttachmentMetadata()
    const where: Record<string, unknown> = { id: input.attachmentId, tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const row = (await findOneWithDecryption<AttachmentRow>(
      em,
      Attachment as unknown as new () => AttachmentRow,
      where,
      undefined,
      { tenantId, organizationId: ctx.organizationId },
    )) as AttachmentRow | null
    if (!row) {
      return { found: false as const, attachmentId: input.attachmentId }
    }
    const metadata = readAttachmentMetadata(row.storageMetadata)
    return {
      found: true as const,
      id: row.id,
      entityType: row.entityId,
      recordId: row.recordId,
      fileName: row.fileName,
      mediaType: row.mimeType,
      size: row.fileSize,
      partitionCode: row.partitionCode,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      extractedText:
        input.includeExtractedText === true && typeof row.content === 'string' ? row.content : null,
      hasExtractedText: typeof row.content === 'string' && row.content.length > 0,
    }
  },
})

const transferInput = z.object({
  fromEntityType: z.string().min(1).describe('Current entity type of the source attachments.'),
  fromRecordId: z.string().min(1).describe('Current record id the attachments are bound to.'),
  toEntityType: z.string().min(1).describe('Target entity type (must match the source).'),
  toRecordId: z.string().min(1).describe('Target record id to re-bind the attachments to.'),
  attachmentIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .optional()
    .describe('Optional subset; defaults to every attachment on the source record.'),
})

const transferRecordAttachmentsTool = defineAiTool({
  name: 'attachments.transfer_record_attachments',
  displayName: 'Transfer record attachments',
  description:
    'Move uploaded files from a temporary/draft record to a saved record. Mutation tool — agents with readOnly=true are blocked by the policy gate.',
  inputSchema: transferInput,
  isMutation: true,
  requiredFeatures: ['attachments.manage'],
  tags: ['write', 'attachments'],
  handler: async (rawInput, ctx) => {
    const tenantId = assertTenantScope(ctx)
    const input = transferInput.parse(rawInput)
    if (input.fromEntityType !== input.toEntityType) {
      throw new Error(
        'attachments.transfer_record_attachments requires fromEntityType and toEntityType to match',
      )
    }
    const em = resolveEm(ctx)
    const Attachment = await loadAttachmentEntity()
    const { readAttachmentMetadata, mergeAttachmentMetadata } = await loadAttachmentMetadata()
    const where: Record<string, unknown> = {
      entityId: input.fromEntityType,
      recordId: input.fromRecordId,
      tenantId,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      where.id = { $in: input.attachmentIds }
    }
    const rows = (await findWithDecryption<AttachmentRow>(
      em,
      Attachment as unknown as new () => AttachmentRow,
      where,
      undefined,
      { tenantId, organizationId: ctx.organizationId },
    )) as AttachmentRow[]
    if (!rows.length) {
      return {
        transferred: 0,
        fromEntityType: input.fromEntityType,
        fromRecordId: input.fromRecordId,
        toEntityType: input.toEntityType,
        toRecordId: input.toRecordId,
      }
    }
    for (const row of rows) {
      const previousRecordId = row.recordId
      row.recordId = input.toRecordId
      const metadata = readAttachmentMetadata(row.storageMetadata)
      const nextAssignments =
        metadata.assignments?.map((assignment) => {
          const matchesType = assignment.type === input.fromEntityType
          const matchesRecord = assignment.id === previousRecordId
          if (matchesType && matchesRecord) {
            return { ...assignment, id: input.toRecordId }
          }
          return assignment
        }) ?? []
      row.storageMetadata = mergeAttachmentMetadata(row.storageMetadata, {
        assignments: nextAssignments,
      })
    }
    await em.persist(rows).flush()
    return {
      transferred: rows.length,
      fromEntityType: input.fromEntityType,
      fromRecordId: input.fromRecordId,
      toEntityType: input.toEntityType,
      toRecordId: input.toRecordId,
      attachmentIds: rows.map((row) => row.id),
    }
  },
})

export const attachmentsAiTools: AiToolDefinition<any, any>[] = [
  listRecordAttachmentsTool,
  readAttachmentTool,
  transferRecordAttachmentsTool,
]

export default attachmentsAiTools
