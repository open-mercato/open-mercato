import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { User } from '../../auth/data/entities'
import { Message, MessageObject } from '../data/entities'
import { composeMessageSchema, listMessagesSchema } from '../data/validators'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../lib/constants'
import { getMessageType } from '../lib/message-types-registry'
import { validateMessageObjectsForType } from '../lib/object-validation'
import { attachOperationMetadataHeader } from '../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../lib/routeHelpers'
import { findMessageIdsBySearchTokens } from '../lib/searchLookup'
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

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

type MessageListScopeRow = {
  id: string
  sender_user_id: string
  is_draft: boolean
  recipient_status: string | null
  read_at: string | null
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
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams)
  const input = listMessagesSchema.parse(params)
  const db = getDb(em) as any

  const searchIds = input.search
    ? await findMessageIdsBySearchTokens({
        em,
        query: input.search,
        tenantId: scope.tenantId ?? null,
        organizationId: scope.organizationId,
      })
    : undefined

  const buildBaseQuery = () => {
    let q: any = db
      .selectFrom('messages as m')
      .where('m.tenant_id', '=', scope.tenantId)
      .where('m.deleted_at', 'is', null)

    if (scope.organizationId) {
      q = q.where('m.organization_id', '=', scope.organizationId)
    } else {
      q = q.where('m.organization_id', 'is', null)
    }

    const joinRecipient = () => {
      q = q.leftJoin('message_recipients as r', (jb: any) => jb
        .onRef('m.id', '=', 'r.message_id')
        .on('r.recipient_user_id', '=', scope.userId))
    }

    switch (input.folder) {
      case 'inbox':
        joinRecipient()
        q = q
          .where('r.message_id', 'is not', null)
          .where('r.deleted_at', 'is', null)
          .where('r.archived_at', 'is', null)
          .where('m.is_draft', '=', false)
        break
      case 'archived':
        joinRecipient()
        q = q
          .where('r.message_id', 'is not', null)
          .where('r.deleted_at', 'is', null)
          .where('r.archived_at', 'is not', null)
        break
      case 'sent':
        q = q
          .where('m.sender_user_id', '=', scope.userId)
          .where('m.is_draft', '=', false)
        joinRecipient()
        break
      case 'drafts':
        q = q
          .where('m.sender_user_id', '=', scope.userId)
          .where('m.is_draft', '=', true)
        joinRecipient()
        break
      case 'all':
        joinRecipient()
        q = q.where((eb: any) => eb.or([
          eb('m.sender_user_id', '=', scope.userId),
          eb('r.message_id', 'is not', null),
        ]))
        break
      default: {
        const unsupportedFolder: never = input.folder
        throw new Error(`Unsupported folder: ${String(unsupportedFolder)}`)
      }
    }

    if (input.status) q = q.where('r.status', '=', input.status)
    if (input.type) q = q.where('m.type', '=', input.type)
    if (input.visibility) q = q.where('m.visibility', '=', input.visibility)
    if (input.sourceEntityType) q = q.where('m.source_entity_type', '=', input.sourceEntityType)
    if (input.sourceEntityId) q = q.where('m.source_entity_id', '=', input.sourceEntityId)
    if (input.externalEmail) q = q.where('m.external_email_hash', '=', hashForLookup(input.externalEmail))
    if (input.senderId) q = q.where('m.sender_user_id', '=', input.senderId)

    if (input.search) {
      if (!searchIds || searchIds.length === 0) {
        q = q.where('m.id', '=', NO_MATCH_ID)
      } else {
        q = q.where('m.id', 'in', searchIds)
      }
    }

    if (input.since) q = q.where('m.sent_at', '>', new Date(input.since))

    if (input.hasObjects !== undefined) {
      const existsFn = (eb: any) => eb.exists(
        eb.selectFrom('message_objects')
          .select(sql<number>`1`.as('one'))
          .whereRef('message_objects.message_id', '=', 'm.id')
      )
      const notExistsFn = (eb: any) => eb.not(eb.exists(
        eb.selectFrom('message_objects')
          .select(sql<number>`1`.as('one'))
          .whereRef('message_objects.message_id', '=', 'm.id')
      ))
      q = input.hasObjects ? q.where(existsFn) : q.where(notExistsFn)
    }

    if (input.hasAttachments !== undefined) {
      const existsFn = (eb: any) => eb.exists(
        eb.selectFrom('attachments')
          .select(sql<number>`1`.as('one'))
          .where('attachments.entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
          .whereRef('attachments.record_id', '=', 'm.id')
      )
      const notExistsFn = (eb: any) => eb.not(eb.exists(
        eb.selectFrom('attachments')
          .select(sql<number>`1`.as('one'))
          .where('attachments.entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
          .whereRef('attachments.record_id', '=', 'm.id')
      ))
      q = input.hasAttachments ? q.where(existsFn) : q.where(notExistsFn)
    }

    if (input.hasActions !== undefined) {
      q = input.hasActions
        ? q.where('m.action_data', 'is not', null)
        : q.where('m.action_data', 'is', null)
    }

    return q
  }

  const countResult = await buildBaseQuery()
    .select(sql<number>`count(*)`.as('count'))
    .executeTakeFirst() as { count: string | number } | undefined
  const total = Number(countResult?.count ?? 0)

  const offset = (input.page - 1) * input.pageSize
  const scopeRows = await buildBaseQuery()
    .select([
      'm.id',
      'm.sender_user_id',
      'm.is_draft',
      'r.status as recipient_status',
      'r.read_at',
    ])
    .orderBy('m.sent_at', 'desc')
    .offset(offset)
    .limit(input.pageSize)
    .execute()

  const typedRows = scopeRows as MessageListScopeRow[]
  const messageIds = typedRows.map((row) => row.id)

  const messageEntities = messageIds.length > 0
    ? await findWithDecryption(
        em,
        Message,
        { id: { $in: messageIds } },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId }
      )
    : []

  const messagesById = new Map<string, Message>()
  for (const message of messageEntities) {
    messagesById.set(message.id, message)
  }

  const objects = messageIds.length > 0
    ? await em.find(MessageObject, { messageId: { $in: messageIds } })
    : []

  const objectsByMessage = objects.reduce((acc, obj) => {
    if (!acc[obj.messageId]) acc[obj.messageId] = []
    acc[obj.messageId].push(obj)
    return acc
  }, {} as Record<string, MessageObject[]>)

  const attachmentCounts: AttachmentCountRow[] = messageIds.length > 0
    ? await (getDb(em) as any)
        .selectFrom('attachments')
        .select(['record_id', sql<string>`count(*)`.as('count')])
        .where('entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
        .where('record_id', 'in', messageIds)
        .groupBy('record_id')
        .execute()
    : []

  const attachmentCountByMessage = attachmentCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.record_id] = Number(row.count)
    return acc
  }, {})

  const recipientCounts: RecipientCountRow[] = messageIds.length > 0
    ? await (getDb(em) as any)
        .selectFrom('message_recipients')
        .select(['message_id', sql<string>`count(*)`.as('count')])
        .where('message_id', 'in', messageIds)
        .where('deleted_at', 'is', null)
        .groupBy('message_id')
        .execute()
    : []

  const recipientCountByMessage = recipientCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.message_id] = Number(row.count)
    return acc
  }, {})

  const senderUserIds = Array.from(new Set(typedRows.map((row) => row.sender_user_id).filter(Boolean)))
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
    items: typedRows
      .map((row) => {
        const message = messagesById.get(row.id)
        if (!message) return null
        const body = typeof message.body === 'string' ? message.body : ''
        const bodyPreview = body.substring(0, 150) + (body.length > 150 ? '...' : '')
        const actionData = message.actionData ?? null
        return {
          ...(senderMetaById.get(row.sender_user_id)
            ? {
                senderName: senderMetaById.get(row.sender_user_id)?.name ?? null,
                senderEmail: senderMetaById.get(row.sender_user_id)?.email ?? null,
              }
            : { senderName: null, senderEmail: null }),
          id: message.id,
          type: message.type,
          visibility: message.visibility ?? null,
          sourceEntityType: message.sourceEntityType ?? null,
          sourceEntityId: message.sourceEntityId ?? null,
          externalEmail: message.externalEmail ?? null,
          externalName: message.externalName ?? null,
          subject: message.subject,
          bodyPreview,
          senderUserId: message.senderUserId,
          priority: message.priority,
          status: row.recipient_status ?? (row.is_draft ? 'draft' : 'sent'),
          hasObjects: (objectsByMessage[message.id] || []).length > 0,
          objectCount: (objectsByMessage[message.id] || []).length,
          hasAttachments: (attachmentCountByMessage[message.id] || 0) > 0,
          attachmentCount: attachmentCountByMessage[message.id] || 0,
          recipientCount: recipientCountByMessage[message.id] || 0,
          hasActions:
            Boolean(actionData?.actions?.length)
            || Boolean(getMessageType(message.type)?.defaultActions?.length)
            || (objectsByMessage[message.id] || []).some((item) => item.actionRequired && Boolean(item.actionType)),
          actionTaken: message.actionTaken ?? null,
          sentAt: message.sentAt ? message.sentAt.toISOString() : null,
          readAt: row.read_at,
          threadId: message.threadId ?? null,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
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

  const { result, logEntry } = await commandBus.execute('messages.message.compose', {
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
