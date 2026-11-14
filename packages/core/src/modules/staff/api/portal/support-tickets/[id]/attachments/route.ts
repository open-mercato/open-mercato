/**
 * `GET|POST|DELETE /api/staff/portal/support-tickets/{id}/attachments`
 *
 * Modeled on `warranty_claims/api/portal/attachments/route.ts`, with two
 * differences: the attachments module is loaded with a dynamic import (staff keeps
 * no static edge to it, and answers 503 when it is absent), and a customer may only
 * delete files they uploaded themselves — every customer upload is tagged
 * `customer-upload:<customerUserId>` because the attachment row has no uploader
 * column. Only files tagged `customer-visible` are ever listed or streamed.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { Attachment as AttachmentEntity } from '@open-mercato/core/modules/attachments/data/entities'
import type { ScopedAttachmentUploadService } from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'
import {
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE,
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  loadPortalOwnedTicket,
  resolveSupportPortalScope,
  type SupportPortalScope,
} from '../../../../../lib/support/portalTickets'
import {
  SUPPORT_TICKET_RESOURCE_KIND,
  checkPortalRateLimit,
  portalErrorResponse,
  readPathId,
} from '../../../../../lib/support/portalRoute'
import {
  CUSTOMER_VISIBLE_ATTACHMENT_TAG,
  SUPPORT_TICKET_ATTACHMENT_ENTITY_ID,
  customerUploadTag,
  translateSupportUploadError,
} from '../../../../../lib/support/attachments'
import {
  listCustomerVisibleAttachments,
  loadPortalAttachmentsApi,
  portalAttachmentAuth,
  readAttachmentTags,
  serializePortalAttachment,
  portalSupportAttachmentItemSchema,
  type PortalAttachmentsApi,
} from '../../../../../lib/support/portalAttachments'
import { emitSupportAttachmentActivity } from '../../../../../lib/support/supportActivity'

const logger = createLogger('staff').child({ component: 'api/portal/support-tickets/attachments' })

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
  DELETE: { requireAuth: false },
}

const uploadGuardPayloadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(255),
})

function unavailable(): Response {
  return NextResponse.json({ ok: false, error: 'staff.support.errors.attachmentsUnavailable' }, { status: 503 })
}

function notFound(): Response {
  return NextResponse.json({ ok: false, error: 'staff.errors.notFound' }, { status: 404 })
}

async function resolveDriverFactory(api: PortalAttachmentsApi, scope: SupportPortalScope) {
  try {
    const resolved = scope.container.resolve('storageDriverFactory') as InstanceType<PortalAttachmentsApi['StorageDriverFactory']> | null
    return resolved ?? new api.StorageDriverFactory(scope.em)
  } catch {
    return new api.StorageDriverFactory(scope.em)
  }
}

async function loadVisibleAttachment(
  api: PortalAttachmentsApi,
  scope: SupportPortalScope,
  taskId: string,
  attachmentId: string,
): Promise<AttachmentEntity | null> {
  const attachment = await findOneWithDecryption(
    scope.em,
    api.Attachment,
    {
      id: attachmentId,
      entityId: SUPPORT_TICKET_ATTACHMENT_ENTITY_ID,
      recordId: taskId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!attachment) return null
  return readAttachmentTags(api, attachment).includes(CUSTOMER_VISIBLE_ATTACHMENT_TAG) ? attachment : null
}

export async function GET(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    if (scope instanceof Response) return scope
    const taskId = readPathId(req, /\/support-tickets\/([^/]+)\/attachments/)
    const owned = taskId ? await loadPortalOwnedTicket(scope, taskId) : null
    if (!owned) return notFound()
    const api = await loadPortalAttachmentsApi()
    if (!api) return unavailable()
    const attachmentId = new URL(req.url).searchParams.get('attachmentId')
    if (attachmentId) {
      if (!z.string().uuid().safeParse(attachmentId).success) return notFound()
      const attachment = await loadVisibleAttachment(api, scope, owned.task.id, attachmentId)
      if (!attachment) return notFound()
      const partition = await scope.em.findOne(api.AttachmentPartition, { code: attachment.partitionCode })
      if (!partition) return notFound()
      if (!api.checkAttachmentAccess(portalAttachmentAuth(scope), attachment, partition, { requireAuthForPublic: true }).ok) return notFound()
      const driver = await (await resolveDriverFactory(api, scope)).resolveForPartition(attachment.partitionCode, {
        tenantId: attachment.tenantId ?? scope.tenantId,
        organizationId: attachment.organizationId ?? scope.organizationId,
      })
      let buffer: Buffer
      try {
        buffer = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
      } catch {
        return notFound()
      }
      const headers: Record<string, string> = {
        'Cache-Control': 'private, max-age=60',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${api.slugifyAttachmentFileName(attachment.fileName)}"`,
        'X-Content-Type-Options': 'nosniff',
      }
      if (attachment.fileSize > 0) headers['Content-Length'] = String(attachment.fileSize)
      return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
    }
    const canManage = await scope.hasFeature(PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    return NextResponse.json({ items: await listCustomerVisibleAttachments(api, scope, owned.task.id, canManage) })
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support attachments GET failed')
  }
}

export async function POST(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    if (scope instanceof Response) return scope
    const taskId = readPathId(req, /\/support-tickets\/([^/]+)\/attachments/)
    const owned = taskId ? await loadPortalOwnedTicket(scope, taskId) : null
    if (!owned) return notFound()
    const limited = await checkPortalRateLimit(scope, 'upload')
    if (limited) return limited
    const api = await loadPortalAttachmentsApi()
    if (!api) return unavailable()
    const { t } = await resolveTranslations()
    if (!(req.headers.get('content-type') || '').toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json({ ok: false, error: t('staff.errors.invalid_request', 'Invalid request') }, { status: 400 })
    }
    if (!api.isMultipartRequestWithinUploadLimit(req.headers.get('content-length'))) {
      return NextResponse.json({ ok: false, error: t('attachments.errors.maxUploadSize', 'Attachment exceeds the maximum upload size.') }, { status: 413 })
    }
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: t('staff.support.errors.fileRequired', 'Choose a file before uploading.') }, { status: 400 })
    }
    const uploadPayload = { fileName: file.name, fileSize: file.size, mimeType: file.type }
    const guarded = await runRouteMutationGuards({
      container: scope.container,
      req,
      auth: { userId: scope.auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId, userFeatures: [] },
      input: {
        resourceKind: SUPPORT_TICKET_RESOURCE_KIND,
        resourceId: owned.task.id,
        operation: 'update',
        mutationPayload: uploadPayload,
      },
    })
    if (!guarded.ok) return guarded.response
    const effectiveUpload = guarded.modifiedPayload
      ? uploadGuardPayloadSchema.parse({ ...uploadPayload, ...guarded.modifiedPayload, fileSize: file.size })
      : uploadPayload
    let uploadService: ScopedAttachmentUploadService | null = null
    try {
      uploadService = scope.container.resolve('attachmentScopedUploadService') as ScopedAttachmentUploadService
    } catch {
      uploadService = null
    }
    if (!uploadService) return unavailable()
    let attachment: AttachmentEntity
    try {
      attachment = await uploadService.upload({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityId: SUPPORT_TICKET_ATTACHMENT_ENTITY_ID,
        recordId: owned.task.id,
        fileName: effectiveUpload.fileName,
        buffer: Buffer.from(await file.arrayBuffer()),
        declaredMimeType: effectiveUpload.mimeType,
        tags: [CUSTOMER_VISIBLE_ATTACHMENT_TAG, customerUploadTag(scope.auth.sub)],
      })
    } catch (error) {
      if (api.isScopedAttachmentUploadError(error)) {
        return NextResponse.json(
          { ok: false, error: translateSupportUploadError(error.code, t), code: error.code },
          { status: error.status },
        )
      }
      throw error
    }
    await guarded.runAfterSuccess()
    emitSupportAttachmentActivity(owned.task, owned.ticket, 'attachment_added', attachment.id)
    return NextResponse.json({ ok: true, item: serializePortalAttachment(api, attachment, owned.task.id, scope.auth.sub, true) }, { status: 201 })
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support attachments POST failed')
  }
}

export async function DELETE(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    if (scope instanceof Response) return scope
    const taskId = readPathId(req, /\/support-tickets\/([^/]+)\/attachments/)
    const owned = taskId ? await loadPortalOwnedTicket(scope, taskId) : null
    if (!owned) return notFound()
    const api = await loadPortalAttachmentsApi()
    if (!api) return unavailable()
    const attachmentId = new URL(req.url).searchParams.get('attachmentId')
    if (!attachmentId || !z.string().uuid().safeParse(attachmentId).success) return notFound()
    const attachment = await loadVisibleAttachment(api, scope, owned.task.id, attachmentId)
    if (!attachment) return notFound()
    if (!readAttachmentTags(api, attachment).includes(customerUploadTag(scope.auth.sub))) {
      return NextResponse.json({ ok: false, error: 'staff.support.errors.attachmentNotYours' }, { status: 403 })
    }
    const guarded = await runRouteMutationGuards({
      container: scope.container,
      req,
      auth: { userId: scope.auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId, userFeatures: [] },
      input: { resourceKind: SUPPORT_TICKET_RESOURCE_KIND, resourceId: owned.task.id, operation: 'delete', mutationPayload: { attachmentId } },
    })
    if (!guarded.ok) return guarded.response
    await scope.em.remove(attachment).flush()
    await api.clearAttachmentThumbnailCache(attachment.partitionCode, attachment.id).catch((err) => {
      logger.error('staff portal support attachment thumbnail cleanup failed', { err, attachmentId })
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_attachment_thumbnail_cleanup_failed' })
    })
    if (attachment.storagePath) {
      try {
        const driver = await (await resolveDriverFactory(api, scope)).resolveForPartition(attachment.partitionCode, {
          tenantId: attachment.tenantId ?? scope.tenantId,
          organizationId: attachment.organizationId ?? scope.organizationId,
        })
        await driver.delete(attachment.partitionCode, attachment.storagePath)
      } catch (err) {
        logger.error('staff portal support attachment storage cleanup failed', { err, attachmentId })
        getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_attachment_storage_cleanup_failed' })
      }
    }
    try {
      const dataEngine = scope.container.resolve('dataEngine') as DataEngine
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: attachment,
        identifiers: { id: attachment.id, organizationId: attachment.organizationId ?? null, tenantId: attachment.tenantId ?? null },
        events: api.attachmentCrudEvents,
        indexer: api.attachmentCrudIndexer,
      })
      await dataEngine.flushOrmEntityChanges()
    } catch (err) {
      logger.error('staff portal support attachment side effects failed', { err, attachmentId })
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_attachment_side_effects_failed' })
    }
    await guarded.runAfterSuccess()
    emitSupportAttachmentActivity(owned.task, owned.ticket, 'attachment_removed', attachmentId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support attachments DELETE failed')
  }
}

const attachmentItemSchema = portalSupportAttachmentItemSchema

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  summary: 'Support ticket attachments',
  methods: {
    GET: {
      summary: 'List or download support ticket files',
      description:
        'Lists customer-visible files of a ticket the caller owns, or streams one when `attachmentId` is given. Staff files that were not shared with the customer are never listed.',
      responses: [{ status: 200, description: 'Files', schema: z.object({ items: z.array(attachmentItemSchema) }) }],
      errors: [
        { status: 401, description: 'No portal session' },
        { status: 404, description: 'Ticket or file not found' },
        { status: 503, description: 'Attachments module unavailable' },
      ],
    },
    POST: {
      summary: 'Upload a file to a support ticket',
      description: 'Multipart upload (`file`). The file is tagged customer-visible and as uploaded by the caller. Rate limited per customer user; rejected files answer with a translated `error` and the machine `code`.',
      responses: [{ status: 201, description: 'Uploaded', schema: z.object({ ok: z.literal(true), item: attachmentItemSchema }) }],
      errors: [
        { status: 403, description: 'Missing portal.support_tickets.manage' },
        { status: 404, description: 'Ticket not found' },
        { status: 413, description: 'File too large' },
        { status: 429, description: 'Upload rate limit exceeded (per customer user)' },
      ],
    },
    DELETE: {
      summary: 'Delete a file you uploaded',
      description: 'Deletes a file the caller uploaded (`attachmentId` query). Files uploaded by staff or by other customer users answer 403.',
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 403, description: 'The file was not uploaded by the caller' },
        { status: 404, description: 'Ticket or file not found' },
      ],
    },
  },
}
