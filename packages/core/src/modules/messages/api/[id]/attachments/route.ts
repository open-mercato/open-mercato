import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { attachmentIdsPayloadSchema, unlinkAttachmentPayloadSchema } from '../../../data/validators'
import { getMessageAttachments, linkAttachmentsToMessage } from '../../../lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../../../lib/constants'
import { resolveMessageContext } from '../../../lib/routeHelpers'
import {
  attachmentIdsPayloadSchema as attachmentIdsOpenApiSchema,
  errorResponseSchema,
  messageAttachmentResponseSchema,
  okResponseSchema,
  unlinkAttachmentPayloadSchema as unlinkAttachmentOpenApiSchema,
} from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
  POST: { requireAuth: true, requireFeatures: ['messages.attach_files'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.attach_files'] },
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (message.senderUserId !== scope.userId && !recipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const attachments = await getMessageAttachments(
    em,
    params.id,
    scope.organizationId,
    scope.tenantId
  )

  return Response.json({ attachments })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const body = await req.json().catch(() => ({}))
  const input = attachmentIdsPayloadSchema.parse(body)

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (message.senderUserId !== scope.userId) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!message.isDraft) {
    return Response.json({ error: 'Attachments can only be modified on drafts' }, { status: 409 })
  }

  await linkAttachmentsToMessage(
    em,
    message.id,
    input.attachmentIds,
    scope.organizationId,
    scope.tenantId
  )

  return Response.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const body = await req.json().catch(() => ({}))
  const input = unlinkAttachmentPayloadSchema.parse(body)

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (message.senderUserId !== scope.userId) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!message.isDraft) {
    return Response.json({ error: 'Attachments can only be modified on drafts' }, { status: 409 })
  }

  const attachmentIds = input.attachmentIds ?? (input.attachmentId ? [input.attachmentId] : [])

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  await em.nativeDelete(Attachment, {
    id: { $in: attachmentIds },
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: message.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'List message attachments',
      responses: [
        { status: 200, description: 'Attachments', schema: messageAttachmentResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Link attachments to draft message',
      requestBody: { schema: attachmentIdsOpenApiSchema },
      responses: [
        { status: 200, description: 'Attachments linked', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 409, description: 'Only draft messages can be edited', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Unlink attachments from draft message',
      requestBody: { schema: unlinkAttachmentOpenApiSchema },
      responses: [
        { status: 200, description: 'Attachments unlinked', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 409, description: 'Only draft messages can be edited', schema: errorResponseSchema },
      ],
    },
  },
}
