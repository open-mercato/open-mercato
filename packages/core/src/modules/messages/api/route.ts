import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import { MessageObject } from '../data/entities'
import { composeMessageSchema, listMessagesSchema } from '../data/validators'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../lib/constants'
import { getMessageType, isMessageTypeCreateableByUser } from '../lib/message-types-registry'
import { validateMessageObjectsForType } from '../lib/object-validation'
import { attachOperationMetadataHeader } from '../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../lib/routeHelpers'
import { MessageCommandExecuteResult } from '../commands/shared'
import {
  composeMessageSchema as composeSchema,
  composeResponseSchema,
  listMessagesSchema as listSchema,
  messageListItemSchema,
} from './openapi'

type MessageCommandExecuteResultWithThreadId = MessageCommandExecuteResult & {
  threadId: string
}

function getKnex(em: EntityManager): Knex {
  return (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()
}

type MessageListRow = {
  id: string
  type: string
  visibility: 'public' | 'internal' | null
  source_entity_type: string | null
  source_entity_id: string | null
  external_email: string | null
  external_name: string | null
  subject: string
  body: string
  sender_user_id: string
  priority: string
  recipient_status: string | null
  is_draft: boolean
  action_data: { actions?: unknown[] } | null
  action_taken: string | null
  sent_at: string | null
  read_at: string | null
  thread_id: string | null
}

type AttachmentCountRow = {
  record_id: string
  count: string | number
}

type RecipientCountRow = {
  message_id: string
  count: string | number
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams)
  const input = listMessagesSchema.parse(params)
  const knex = getKnex(em)

  let query = knex('messages as m')
    .where('m.tenant_id', scope.tenantId)
    .whereNull('m.deleted_at')

  if (scope.organizationId) {
    query = query.where('m.organization_id', scope.organizationId)
  } else {
    query = query.whereNull('m.organization_id')
  }

  const joinRecipient = () => {
    query = query.leftJoin('message_recipients as r', function () {
      this.on('m.id', '=', 'r.message_id').andOn('r.recipient_user_id', '=', knex.raw('?', [scope.userId]))
    })
  }

  switch (input.folder) {
    case 'inbox':
      joinRecipient()
      query = query
        .whereNotNull('r.message_id')
        .whereNull('r.deleted_at')
        .whereNull('r.archived_at')
        .where('m.is_draft', false)
      break
    case 'archived':
      joinRecipient()
      query = query
        .whereNotNull('r.message_id')
        .whereNull('r.deleted_at')
        .whereNotNull('r.archived_at')
      break
    case 'sent':
      query = query
        .where('m.sender_user_id', scope.userId)
        .where('m.is_draft', false)
      joinRecipient()
      break
    case 'drafts':
      query = query
        .where('m.sender_user_id', scope.userId)
        .where('m.is_draft', true)
      joinRecipient()
      break
    case 'all':
      joinRecipient()
      query = query.where(function () {
        this.where('m.sender_user_id', scope.userId).orWhereNotNull('r.message_id')
      })
      break
    default: {
      const unsupportedFolder: never = input.folder
      throw new Error(`Unsupported folder: ${String(unsupportedFolder)}`)
    }
  }

  if (input.status) {
    query = query.where('r.status', input.status)
  }

  if (input.type) {
    query = query.where('m.type', input.type)
  }

  if (input.visibility) {
    query = query.where('m.visibility', input.visibility)
  }

  if (input.sourceEntityType) {
    query = query.where('m.source_entity_type', input.sourceEntityType)
  }

  if (input.sourceEntityId) {
    query = query.where('m.source_entity_id', input.sourceEntityId)
  }

  if (input.externalEmail) {
    query = query.whereILike('m.external_email', `%${input.externalEmail}%`)
  }

  if (input.senderId) {
    query = query.where('m.sender_user_id', input.senderId)
  }

  if (input.search) {
    query = query.where(function () {
      this.whereILike('m.subject', `%${input.search}%`).orWhereILike('m.body', `%${input.search}%`)
    })
  }

  if (input.since) {
    query = query.where('m.sent_at', '>', new Date(input.since))
  }

  if (input.hasObjects !== undefined) {
    const subquery = knex('message_objects').select(1).whereRaw('message_objects.message_id = m.id')
    query = input.hasObjects ? query.whereExists(subquery) : query.whereNotExists(subquery)
  }

  if (input.hasAttachments !== undefined) {
    const subquery = knex('attachments')
      .select(1)
      .where('attachments.entity_id', MESSAGE_ATTACHMENT_ENTITY_ID)
      .whereRaw('attachments.record_id = m.id')
    query = input.hasAttachments ? query.whereExists(subquery) : query.whereNotExists(subquery)
  }

  if (input.hasActions !== undefined) {
    query = input.hasActions ? query.whereNotNull('m.action_data') : query.whereNull('m.action_data')
  }

  const countResult = await query.clone().count('* as count').first()
  const total = Number(countResult?.count ?? 0)

  const offset = (input.page - 1) * input.pageSize
  const messages = await query
    .select('m.*', 'r.status as recipient_status', 'r.read_at')
    .orderBy('m.sent_at', 'desc')
    .offset(offset)
    .limit(input.pageSize)

  const typedMessages = messages as MessageListRow[]
  const messageIds = typedMessages.map((message) => message.id)
  const objects = messageIds.length > 0
    ? await em.find(MessageObject, { messageId: { $in: messageIds } })
    : []

  const objectsByMessage = objects.reduce((acc, obj) => {
    if (!acc[obj.messageId]) acc[obj.messageId] = []
    acc[obj.messageId].push(obj)
    return acc
  }, {} as Record<string, MessageObject[]>)

  const attachmentCounts: AttachmentCountRow[] = messageIds.length > 0
    ? await getKnex(em)('attachments')
        .select('record_id')
        .count('* as count')
        .where('entity_id', MESSAGE_ATTACHMENT_ENTITY_ID)
        .whereIn('record_id', messageIds)
        .groupBy('record_id')
    : []

  const attachmentCountByMessage = attachmentCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.record_id] = Number(row.count)
    return acc
  }, {})

  const recipientCounts: RecipientCountRow[] = messageIds.length > 0
    ? await getKnex(em)('message_recipients')
        .select('message_id')
        .count('* as count')
        .whereIn('message_id', messageIds)
        .whereNull('deleted_at')
        .groupBy('message_id')
    : []

  const recipientCountByMessage = recipientCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.message_id] = Number(row.count)
    return acc
  }, {})

  const senderUserIds = Array.from(new Set(typedMessages.map((message) => message.sender_user_id).filter(Boolean)))
  const senderUsers = senderUserIds.length > 0
    ? await findWithDecryption(
        em,
        User,
        { id: { $in: senderUserIds } },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId }
      )
    : []

  const senderMetaById = new Map<string, { name: string | null; email: string | null }>()
  senderUsers.forEach((user) => {
    const name = typeof user.name === 'string' && user.name.trim().length ? user.name.trim() : null
    senderMetaById.set(user.id, { name, email: user.email ?? null })
  })

  return Response.json({
    items: typedMessages.map((message) => ({
      ...(senderMetaById.get(message.sender_user_id)
        ? {
            senderName: senderMetaById.get(message.sender_user_id)?.name ?? null,
            senderEmail: senderMetaById.get(message.sender_user_id)?.email ?? null,
          }
        : { senderName: null, senderEmail: null }),
      id: message.id,
      type: message.type,
      visibility: message.visibility,
      sourceEntityType: message.source_entity_type,
      sourceEntityId: message.source_entity_id,
      externalEmail: message.external_email,
      externalName: message.external_name,
      subject: message.subject,
      bodyPreview: message.body.substring(0, 150) + (message.body.length > 150 ? '...' : ''),
      senderUserId: message.sender_user_id,
      priority: message.priority,
      status: message.recipient_status ?? (message.is_draft ? 'draft' : 'sent'),
      hasObjects: (objectsByMessage[message.id] || []).length > 0,
      objectCount: (objectsByMessage[message.id] || []).length,
      hasAttachments: (attachmentCountByMessage[message.id] || 0) > 0,
      attachmentCount: attachmentCountByMessage[message.id] || 0,
      recipientCount: recipientCountByMessage[message.id] || 0,
      hasActions:
        Boolean(message.action_data?.actions?.length)
        || Boolean(getMessageType(message.type)?.defaultActions?.length)
        || (objectsByMessage[message.id] || []).some((item) => item.actionRequired && Boolean(item.actionType)),
      actionTaken: message.action_taken,
      sentAt: message.sent_at,
      readAt: message.read_at,
      threadId: message.thread_id,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
  })
}

export async function POST(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const body = await req.json().catch(() => ({}))
  const input = composeMessageSchema.parse(body)
  if (!isMessageTypeCreateableByUser(input.type)) {
    return Response.json({ error: 'Message type cannot be created by users' }, { status: 400 })
  }
  const isPublicVisibility = input.visibility === 'public'
  const sendViaEmail = isPublicVisibility ? true : input.sendViaEmail
  if (sendViaEmail && !(await canUseMessageEmailFeature(ctx, scope))) {
    return Response.json({ error: 'Missing feature: messages.email' }, { status: 403 })
  }

  if (input.objects?.length) {
    const objectValidationError = validateMessageObjectsForType(input.type, input.objects)
    if (objectValidationError) {
      return Response.json({ error: objectValidationError }, { status: 400 })
    }
  }

  const { result, logEntry } = await commandBus.execute('messages.messages.compose', {
    input: {
      ...input,
      sendViaEmail,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
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
  const { id: messageId, threadId: responseThreadId } = result as unknown as MessageCommandExecuteResultWithThreadId

  const response = Response.json({ id: messageId, threadId: responseThreadId }, { status: 201 })
  attachOperationMetadataHeader(response, logEntry, {
    resourceKind: 'messages.message',
    resourceId: messageId,
  })
  return response
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'List messages',
      query: listSchema,
      responses: [
        {
          status: 200,
          description: 'Message list',
          schema: z.object({
            items: z.array(messageListItemSchema),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        },
      ],
    },
    POST: {
      summary: 'Compose a message',
      requestBody: {
        schema: composeSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Message created',
          schema: composeResponseSchema,
        },
      ],
    },
  },
}
