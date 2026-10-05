import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { prepareAttachmentMutation } from '../../../lib/access-mutation'
import { throwAttachmentAccessError } from '../../../lib/access-errors'
import { createAttachmentAccessContext } from '../../../lib/access-runner'
import { assertAttachmentOwnerAccess } from '../../../lib/access-query'
import { withAttachmentAccessErrors } from '../../../lib/access-errors'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../../../data/entities'
import {
  mergeAttachmentMetadata,
  normalizeAttachmentAssignments,
  normalizeAttachmentTags,
  readAttachmentMetadata,
} from '../../../lib/metadata'
import type { StorageDriverFactory } from '../../../lib/drivers'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { E } from '#generated/entities.ids.generated'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { attachmentCrudEvents, attachmentCrudIndexer } from '../../../lib/crud'
import { applyAssignmentEnrichments, resolveAssignmentEnrichments } from '../../../lib/assignmentDetails'
import {
  attachmentsTag,
  attachmentDetailResponseSchema,
  attachmentErrorSchema,
} from '../../openapi'

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

async function getAttachment(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as EntityManager
  let queryEngine: QueryEngine | null = null
  try {
    queryEngine = resolve('queryEngine') as QueryEngine
  } catch {
    queryEngine = null
  }
  const findFilter: Record<string, unknown> = {
    id: attachmentId,
    tenantId: auth.tenantId,
  }
  if (auth.orgId) {
    findFilter.organizationId = auth.orgId
  }
  const record = await em.findOne(Attachment, findFilter)
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  await assertAttachmentOwnerAccess({ em, context: createAttachmentAccessContext(container), auth, attachment: record, action: 'metadata' })
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
      content: record.content && record.content.trim() ? record.content : null,
      customFields,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export const GET = withAttachmentAccessErrors(getAttachment)

async function updateAttachment(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const rawBody = await readJsonSafe(req, null)
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = updateSchema.safeParse(base)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as EntityManager
  let queryEngine: QueryEngine | null = null
  try {
    queryEngine = resolve('queryEngine') as QueryEngine
  } catch {
    queryEngine = null
  }
  const dataEngine = resolve('dataEngine') as DataEngine
  const patchFilter: Record<string, unknown> = {
    id: attachmentId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }
  const accessContext = createAttachmentAccessContext(container)
  const outcome = await em.transactional(async (tx) => {
    const record = await findOneWithDecryption(tx, Attachment, patchFilter, {
      lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
    }, { tenantId: auth.tenantId, organizationId: auth.orgId })
    if (!record) return throwAttachmentAccessError(404)
    const guard = await prepareAttachmentMutation({
      container, req, auth, recordId: record.id, operation: 'update',
      payload: { ...parsed.data, customFields: custom },
    })
    const effective = splitCustomFieldPayload(guard.modifiedPayload ?? { ...parsed.data, customFields: custom })
    const effectiveParsed = updateSchema.safeParse(effective.base)
    if (!effectiveParsed.success) return throwAttachmentAccessError(403)
    const patch: Record<string, unknown> = {}
    if (effectiveParsed.data.tags) patch.tags = normalizeAttachmentTags(effectiveParsed.data.tags)
    if (effectiveParsed.data.assignments) patch.assignments = normalizeAttachmentAssignments(effectiveParsed.data.assignments)
    const nextMetadata = mergeAttachmentMetadata(record.storageMetadata, patch)
    await assertAttachmentOwnerAccess({ em: tx, context: accessContext, auth, attachment: record, action: 'reassign', persistProtection: true })
    await assertAttachmentOwnerAccess({ em: tx, context: accessContext, auth, attachment: { ...record, storageMetadata: nextMetadata }, action: 'reassign' })
    await assertAttachmentOwnerAccess({ em: tx, context: accessContext, auth, attachment: { ...record, storageMetadata: nextMetadata }, action: 'metadata' })
    record.storageMetadata = nextMetadata
    await tx.flush()
    if (dataEngine && Object.keys(effective.custom).length) {
      await setCustomFieldsIfAny({ dataEngine, entityId: E.attachments.attachment, recordId: record.id,
        tenantId: record.tenantId ?? auth.tenantId, organizationId: record.organizationId ?? auth.orgId,
        values: effective.custom,
      })
    }
    return { record, custom: effective.custom, guard }
  })
  const { record } = outcome
  await outcome.guard.runAfterSuccess()

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
      customFields: normalizeCustomFieldResponse(outcome.custom ?? null),
    },
  })
}

async function deleteAttachment(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = await resolveAttachmentId(ctx)
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as EntityManager
  const dataEngine = resolve('dataEngine') as DataEngine
  const storageDriverFactory = resolve('storageDriverFactory') as StorageDriverFactory
  const deleteFilter: Record<string, unknown> = {
    id: attachmentId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }
  const outcome = await em.transactional(async (tx) => {
    const record = await findOneWithDecryption(tx, Attachment, deleteFilter, {
      lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
    }, { tenantId: auth.tenantId, organizationId: auth.orgId })
    if (!record) return throwAttachmentAccessError(404)
    const guard = await prepareAttachmentMutation({ container, req, auth, recordId: record.id, operation: 'delete' })
    await assertAttachmentOwnerAccess({ em: tx, context: createAttachmentAccessContext(container), auth, attachment: record, action: 'delete' })
    const driver = await storageDriverFactory.resolveForPartition(record.partitionCode, {
      tenantId: record.tenantId ?? auth.tenantId!, organizationId: record.organizationId ?? auth.orgId!,
    })
    tx.remove(record)
    await tx.flush()
    return { record, driver, guard }
  })
  const { record } = outcome
  await outcome.driver.delete(record.partitionCode, record.storagePath)
  await outcome.guard.runAfterSuccess()

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

export const PATCH = withAttachmentAccessErrors(updateAttachment)
export const DELETE = withAttachmentAccessErrors(deleteAttachment)

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Attachment detail management',
  methods: {
    GET: {
      summary: 'Get attachment details',
      description: 'Returns complete details of an attachment including metadata, tags, assignments, and custom fields.',
      responses: [
        { status: 200, description: 'Attachment details', schema: attachmentDetailResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid attachment ID', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
        { status: 403, description: 'Owner policy denies access', schema: attachmentErrorSchema },
        { status: 504, description: 'Owner authorization timed out', schema: attachmentErrorSchema },
      ],
    },
    PATCH: {
      summary: 'Update attachment metadata',
      description: 'Updates attachment tags, assignments, and custom fields. Emits CRUD side effects for indexing and events.',
      requestBody: {
        contentType: 'application/json',
        schema: updateSchema,
      },
      responses: [
        { status: 200, description: 'Attachment updated successfully', schema: z.object({ ok: z.literal(true), item: z.any() }) },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or attachment ID', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
        { status: 500, description: 'Failed to save attributes', schema: attachmentErrorSchema },
        { status: 403, description: 'Owner policy denies access', schema: attachmentErrorSchema },
        { status: 504, description: 'Owner authorization timed out', schema: attachmentErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete attachment',
      description: 'Permanently deletes an attachment file from storage and database. Emits CRUD side effects.',
      responses: [
        { status: 200, description: 'Attachment deleted successfully', schema: z.object({ ok: z.literal(true) }) },
      ],
      errors: [
        { status: 400, description: 'Invalid attachment ID', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
        { status: 403, description: 'Owner policy denies access', schema: attachmentErrorSchema },
        { status: 504, description: 'Owner authorization timed out', schema: attachmentErrorSchema },
      ],
    },
  },
}
