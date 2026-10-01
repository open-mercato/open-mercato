import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment } from '../../data/entities'
import { createAttachmentAccessContext } from '../../lib/access-runner'
import { assertAttachmentOwnerAccess } from '../../lib/access-query'
import { withAttachmentAccessErrors, throwAttachmentAccessError } from '../../lib/access-errors'
import { prepareAttachmentMutation } from '../../lib/access-mutation'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { mergeAttachmentMetadata, readAttachmentMetadata } from '../../lib/metadata'
import {
  attachmentsTag,
  transferAttachmentsRequestSchema,
  transferAttachmentsResponseSchema,
  attachmentErrorSchema,
} from '../openapi'

const transferSchema = z.object({
  entityId: z.string().min(1),
  attachmentIds: z.array(z.string().uuid()).min(1),
  fromRecordId: z.string().min(1).optional(),
  toRecordId: z.string().min(1),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

async function transferAttachments(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const json = await readJsonSafe(req, null)
  const parsed = transferSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const guard = await prepareAttachmentMutation({ container, req, auth, operation: 'update', payload: parsed.data })
  const effective = transferSchema.safeParse(guard.modifiedPayload ?? parsed.data)
  if (!effective.success) return throwAttachmentAccessError(403)
  const { attachmentIds, entityId, fromRecordId, toRecordId } = effective.data
  const filters: Record<string, unknown> = {
    id: { $in: [...new Set(attachmentIds)].sort() }, entityId,
    tenantId: auth.tenantId, organizationId: auth.orgId,
    ...(fromRecordId ? { recordId: fromRecordId } : {}),
  }
  const accessContext = createAttachmentAccessContext(container)
  const updated = await em.transactional(async (tx) => {
    const records = await findWithDecryption(tx, Attachment, filters, {
      orderBy: { id: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
    }, { tenantId: auth.tenantId, organizationId: auth.orgId })
    if (records.length !== new Set(attachmentIds).size) return throwAttachmentAccessError(404)
    const changes = []
    for (const record of records) {
      const metadata = readAttachmentMetadata(record.storageMetadata)
      const assignments = metadata.assignments?.map((assignment) => (
        assignment.type === entityId && assignment.id === (fromRecordId ?? record.recordId)
          ? { ...assignment, id: toRecordId } : assignment
      )) ?? []
      const storageMetadata = mergeAttachmentMetadata(record.storageMetadata, { assignments })
      await assertAttachmentOwnerAccess({ em: tx, context: accessContext, auth, attachment: record, action: 'reassign', persistProtection: true })
      await assertAttachmentOwnerAccess({ em: tx, context: accessContext, auth, attachment: { ...record, recordId: toRecordId, storageMetadata }, action: 'reassign' })
      changes.push({ record, storageMetadata })
    }
    for (const { record, storageMetadata } of changes) {
      record.recordId = toRecordId
      record.storageMetadata = storageMetadata
    }
    await tx.flush()
    return records.length
  })
  await guard.runAfterSuccess()
  return NextResponse.json({ ok: true, updated })
}

export const POST = withAttachmentAccessErrors(transferAttachments)

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Transfer attachments between records',
  methods: {
    POST: {
      summary: 'Transfer attachments to different record',
      description: 'Transfers one or more attachments from one record to another within the same entity type. Updates attachment assignments and metadata to reflect the new record.',
      requestBody: {
        contentType: 'application/json',
        schema: transferAttachmentsRequestSchema,
      },
      responses: [
        { status: 200, description: 'Attachments transferred successfully', schema: transferAttachmentsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachments not found', schema: attachmentErrorSchema },
        { status: 500, description: 'Attachment model missing', schema: attachmentErrorSchema },
        { status: 403, description: 'Owner policy denies access', schema: attachmentErrorSchema },
        { status: 504, description: 'Owner authorization timed out', schema: attachmentErrorSchema },
      ],
    },
  },
}
