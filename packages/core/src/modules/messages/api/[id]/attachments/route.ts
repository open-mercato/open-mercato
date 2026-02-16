import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { parseUnlinkAttachmentIds } from '../../../commands/attachments'
import { Message, MessageRecipient } from '../../../data/entities'
import { attachmentIdsPayloadSchema, unlinkAttachmentPayloadSchema } from '../../../data/validators'
import { getMessageAttachments, linkAttachmentsToMessage } from '../../../lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../../../lib/constants'
import { attachOperationMetadataHeader } from '../../../lib/operationMetadata'
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

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute('messages.attachments.link_to_draft', {
    input: {
      messageId: message.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      attachmentIds: input.attachmentIds,
    },
    ctx: {
      container: ctx.container,
      auth: ctx.auth ?? null,
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: scope.organizationId ? [scope.organizationId] : null,
      request: req,
    },
  })

  const response = Response.json({ ok: true })
  attachOperationMetadataHeader(response, logEntry, {
    resourceKind: 'messages.message',
    resourceId: params.id,
  })
  return response
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

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute('messages.attachments.unlink_from_draft', {
    input: {
      messageId: message.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      attachmentIds: parseUnlinkAttachmentIds(input),
    },
    ctx: {
      container: ctx.container,
      auth: ctx.auth ?? null,
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: scope.organizationId ? [scope.organizationId] : null,
      request: req,
    },
  })

  const response = Response.json({ ok: true })
  attachOperationMetadataHeader(response, logEntry, {
    resourceKind: 'messages.message',
    resourceId: params.id,
  })
  return response
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
