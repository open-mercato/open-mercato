import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../../../data/entities'
import {
  mergeAttachmentMetadata,
  normalizeAttachmentAssignments,
  normalizeAttachmentTags,
  readAttachmentMetadata,
} from '../../../lib/metadata'
import { deletePartitionFile } from '../../../lib/storage'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { attachmentCrudEvents, attachmentCrudIndexer } from '../../../lib/crud'
import { applyAssignmentEnrichments, resolveAssignmentEnrichments } from '../../../lib/assignmentDetails'

const updateSchema = z.object({
  tags: z.array(z.string()).optional(),
  assignments: z
    .array(
      z.object({
        type: z.string().min(1),
        id: z.string().min(1),
        href: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
      }),
    )
    .optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

type RouteParams = { id: string }
type RouteContext = { params: Promise<RouteParams> }

async function resolveAttachmentId(ctx: RouteContext): Promise<string | null> {
  const params = ctx?.params
  if (!params) return null
  try {
    const { id } = await params
    if (typeof id === 'string' && id.trim().length) {
      return id
    }
    return null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  let queryEngine: QueryEngine | null = null
  try {
    queryEngine = resolve('queryEngine') as QueryEngine
  } catch {
    queryEngine = null
  }
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  const metadata = readAttachmentMetadata(record.storageMetadata)
  const partition = record.partitionCode
    ? await em.findOne(AttachmentPartition, { code: record.partitionCode })
    : null
  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.attachments.attachment,
    recordIds: [record.id],
    tenantIdByRecord: { [record.id]: record.tenantId ?? auth.tenantId ?? null },
    organizationIdByRecord: { [record.id]: record.organizationId ?? auth.orgId ?? null },
    tenantFallbacks: [auth.tenantId ?? null].filter((value): value is string => !!value),
  })
  const customFields = normalizeCustomFieldResponse(customFieldValues[record.id])
  const assignments = metadata.assignments ?? []
  const enrichments = await resolveAssignmentEnrichments(assignments, {
    queryEngine,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  const enrichedAssignments = applyAssignmentEnrichments(assignments, enrichments)
  return NextResponse.json({
    item: {
      id: record.id,
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      partitionCode: record.partitionCode,
      partitionTitle: partition?.title ?? null,
      tags: metadata.tags ?? [],
      assignments: enrichedAssignments,
      customFields,
    },
  })
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const rawBody = await req.json().catch(() => null)
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = updateSchema.safeParse(base)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  let queryEngine: QueryEngine | null = null
  try {
    queryEngine = resolve('queryEngine') as QueryEngine
  } catch {
    queryEngine = null
  }
  const dataEngine = resolve('dataEngine') as DataEngine
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  const patch: Record<string, unknown> = {}
  if (parsed.data.tags) patch.tags = normalizeAttachmentTags(parsed.data.tags)
  if (parsed.data.assignments) patch.assignments = normalizeAttachmentAssignments(parsed.data.assignments)
  record.storageMetadata = mergeAttachmentMetadata(record.storageMetadata, patch)
  await em.flush()

  if (dataEngine && custom && Object.keys(custom).length) {
    try {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.attachments.attachment,
        recordId: record.id,
        tenantId: record.tenantId ?? auth.tenantId ?? null,
        organizationId: record.organizationId ?? auth.orgId ?? null,
        values: custom,
      })
    } catch (error) {
      console.error('[attachments] failed to persist custom attributes', error)
      return NextResponse.json({ error: 'Failed to save attachment attributes.' }, { status: 500 })
    }
  }

  if (dataEngine) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId ?? auth.orgId ?? null,
        tenantId: record.tenantId ?? auth.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }

  const metadata = readAttachmentMetadata(record.storageMetadata)
  const assignments = metadata.assignments ?? []
  const enrichments = await resolveAssignmentEnrichments(assignments, {
    queryEngine,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  const enrichedAssignments = applyAssignmentEnrichments(assignments, enrichments)
  return NextResponse.json({
    ok: true,
    item: {
      id: record.id,
      tags: metadata.tags ?? [],
      assignments: enrichedAssignments,
      customFields: normalizeCustomFieldResponse(custom ?? null),
    },
  })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const dataEngine = resolve('dataEngine') as DataEngine
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  await deletePartitionFile(record.partitionCode, record.storagePath, record.storageDriver)
  await em.removeAndFlush(record)

  if (dataEngine) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId ?? auth.orgId ?? null,
        tenantId: record.tenantId ?? auth.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }

  return NextResponse.json({ ok: true })
}
