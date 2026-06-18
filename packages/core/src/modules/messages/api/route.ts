import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { User } from '../../auth/data/entities'
import { Message, MessageObject } from '../data/entities'
import { composeMessageSchema, listMessagesSchema, type ListMessagesInput } from '../data/validators'
import { MESSAGE_ATTACHMENT_ENTITY_ID, MESSAGE_ENTITY_ID } from '../lib/constants'
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
const MESSAGE_RESOURCE = 'messages.message'

function getDb(em: EntityManager): Kysely<any> {
  return em.getKysely<any>()
}

type MessageListScopeRow = {
  id: string
  recipient_status: string | null
  read_at: Date | string | null
}

type AttachmentCountRow = {
  record_id: string
  count: string | number
}

type RecipientCountRow = {
  message_id: string
  count: string | number
}

type MessageListCrudItem = Record<string, unknown> & {
  id?: string
  senderUserId?: string | null
  sender_user_id?: string | null
  isDraft?: boolean | null
  is_draft?: boolean | null
  type?: string | null
  body?: string | null
  actionData?: unknown
  action_data?: unknown
}

function asIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return null
}

function parseActionData(value: unknown): { actions?: unknown[] } | null {
  if (!value) return null
  if (typeof value === 'object') return value as { actions?: unknown[] }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as { actions?: unknown[] } : null
    } catch {
      return null
    }
  }
  return null
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const snakeValue = record[snakeKey]
  if (typeof snakeValue === 'string') return snakeValue
  const camelValue = record[camelKey]
  if (typeof camelValue === 'string') return camelValue
  return null
}

function readBoolean(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean {
  const snakeValue = record[snakeKey]
  if (typeof snakeValue === 'boolean') return snakeValue
  const camelValue = record[camelKey]
  return typeof camelValue === 'boolean' ? camelValue : false
}

async function buildMessageListIdFilter(input: ListMessagesInput, ctx: CrudCtx): Promise<Record<string, unknown>> {
  const em = ctx.container.resolve('em') as EntityManager
  const db = getDb(em) as any
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const userId = ctx.auth?.sub ?? null

  if (!tenantId || !userId) return { id: { $eq: NO_MATCH_ID } }

  const searchIds = input.search
    ? await findMessageIdsBySearchTokens({
        em,
        query: input.search,
        tenantId,
        organizationId,
      })
    : undefined

  let q: any = db
    .selectFrom('messages as m')
    .select('m.id')
    .where('m.tenant_id', '=', tenantId)
    .where('m.deleted_at', 'is', null)

  q = organizationId
    ? q.where('m.organization_id', '=', organizationId)
    : q.where('m.organization_id', 'is', null)

  const joinRecipient = () => {
    q = q.leftJoin('message_recipients as r', (jb: any) => jb
      .onRef('m.id', '=', 'r.message_id')
      .on('r.recipient_user_id', '=', userId))
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
        .where('m.sender_user_id', '=', userId)
        .where('m.is_draft', '=', false)
      joinRecipient()
      break
    case 'drafts':
      q = q
        .where('m.sender_user_id', '=', userId)
        .where('m.is_draft', '=', true)
      joinRecipient()
      break
    case 'all':
      joinRecipient()
      q = q.where((eb: any) => eb.or([
        eb('m.sender_user_id', '=', userId),
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
  if (input.externalEmail) q = q.where('m.external_email_hash', 'in', lookupHashCandidates(input.externalEmail))
  if (input.senderId) q = q.where('m.sender_user_id', '=', input.senderId)

  if (input.search) {
    q = searchIds && searchIds.length > 0
      ? q.where('m.id', 'in', searchIds)
      : q.where('m.id', '=', NO_MATCH_ID)
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
        .where(sql<boolean>`attachments.record_id = m.id::text`)
    )
    const notExistsFn = (eb: any) => eb.not(eb.exists(
      eb.selectFrom('attachments')
        .select(sql<number>`1`.as('one'))
        .where('attachments.entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
        .where(sql<boolean>`attachments.record_id = m.id::text`)
    ))
    q = input.hasAttachments ? q.where(existsFn) : q.where(notExistsFn)
  }

  q = input.hasActions === undefined
    ? q
    : input.hasActions
      ? q.where('m.action_data', 'is not', null)
      : q.where('m.action_data', 'is', null)

  const rows = await q.execute() as Array<{ id: string }>
  const ids = rows.map((row) => row.id).filter(Boolean)
  return ids.length > 0 ? { id: { $in: ids } } : { id: { $eq: NO_MATCH_ID } }
}

function transformMessageListItem(item: MessageListCrudItem): Record<string, unknown> {
  if (!item || typeof item !== 'object') return item
  const body = readString(item, 'body', 'body') ?? ''
  const type = readString(item, 'type', 'type') ?? 'default'
  const actionData = parseActionData(item.action_data ?? item.actionData)
  const isDraft = readBoolean(item, 'is_draft', 'isDraft')
  const bodyPreview = body.substring(0, 150) + (body.length > 150 ? '...' : '')

  return {
    senderName: null,
    senderEmail: null,
    id: item.id,
    type,
    visibility: readString(item, 'visibility', 'visibility'),
    sourceEntityType: readString(item, 'source_entity_type', 'sourceEntityType'),
    sourceEntityId: readString(item, 'source_entity_id', 'sourceEntityId'),
    externalEmail: readString(item, 'external_email', 'externalEmail'),
    externalName: readString(item, 'external_name', 'externalName'),
    subject: readString(item, 'subject', 'subject') ?? '',
    bodyPreview,
    senderUserId: readString(item, 'sender_user_id', 'senderUserId'),
    priority: readString(item, 'priority', 'priority') ?? 'normal',
    status: isDraft ? 'draft' : 'sent',
    hasObjects: false,
    objectCount: 0,
    hasAttachments: false,
    attachmentCount: 0,
    recipientCount: 0,
    hasActions:
      Boolean(actionData?.actions?.length)
      || Boolean(getMessageType(type)?.defaultActions?.length),
    actionTaken: readString(item, 'action_taken', 'actionTaken'),
    sentAt: asIsoString(item.sent_at ?? item.sentAt),
    readAt: null,
    threadId: readString(item, 'thread_id', 'threadId'),
  }
}

async function decorateMessageListPayload(payload: { items?: unknown[] }, ctx: CrudCtx): Promise<void> {
  const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : []
  const messageIds = items
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => Boolean(id))
  if (!messageIds.length) return

  const em = ctx.container.resolve('em') as EntityManager
  const db = getDb(em) as any
  const userId = ctx.auth?.sub ?? null

  const recipientRows: MessageListScopeRow[] = userId
    ? await db
        .selectFrom('message_recipients')
        .select(['message_id as id', 'status as recipient_status', 'read_at'])
        .where('message_id', 'in', messageIds)
        .where('recipient_user_id', '=', userId)
        .execute()
    : []
  const recipientByMessage = new Map(recipientRows.map((row) => [row.id, row]))

  const objects = await em.find(MessageObject, { messageId: { $in: messageIds } })
  const objectsByMessage = objects.reduce((acc, obj) => {
    if (!acc[obj.messageId]) acc[obj.messageId] = []
    acc[obj.messageId].push(obj)
    return acc
  }, {} as Record<string, MessageObject[]>)

  const attachmentCounts: AttachmentCountRow[] = await db
    .selectFrom('attachments')
    .select(['record_id', sql<string>`count(*)`.as('count')])
    .where('entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
    .where('record_id', 'in', messageIds)
    .groupBy('record_id')
    .execute()
  const attachmentCountByMessage = attachmentCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.record_id] = Number(row.count)
    return acc
  }, {})

  const recipientCounts: RecipientCountRow[] = await db
    .selectFrom('message_recipients')
    .select(['message_id', sql<string>`count(*)`.as('count')])
    .where('message_id', 'in', messageIds)
    .where('deleted_at', 'is', null)
    .groupBy('message_id')
    .execute()
  const recipientCountByMessage = recipientCounts.reduce((acc: Record<string, number>, row) => {
    acc[row.message_id] = Number(row.count)
    return acc
  }, {})

  const senderUserIds = Array.from(new Set(
    items
      .map((item) => readString(item, 'sender_user_id', 'senderUserId'))
      .filter((id): id is string => Boolean(id))
  ))
  const senderUsers = senderUserIds.length > 0
    ? await findWithDecryption(
        em,
        User,
        { id: { $in: senderUserIds } },
        undefined,
        {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        }
      )
    : []

  const senderMetaById = new Map<string, { name: string | null; email: string | null }>()
  senderUsers.forEach((user) => {
    const name = typeof user.name === 'string' && user.name.trim().length ? user.name.trim() : null
    senderMetaById.set(user.id, { name, email: user.email ?? null })
  })

  payload.items = items.map((item) => {
    const id = typeof item.id === 'string' ? item.id : ''
    const senderUserId = readString(item, 'sender_user_id', 'senderUserId')
    const senderMeta = senderUserId ? senderMetaById.get(senderUserId) : null
    const recipient = recipientByMessage.get(id)
    const messageObjects = objectsByMessage[id] || []
    const hasObjectActions = messageObjects.some((object) => object.actionRequired && Boolean(object.actionType))

    return {
      ...item,
      senderName: senderMeta?.name ?? null,
      senderEmail: senderMeta?.email ?? null,
      status: recipient?.recipient_status ?? item.status,
      readAt: asIsoString(recipient?.read_at ?? item.readAt),
      hasObjects: messageObjects.length > 0,
      objectCount: messageObjects.length,
      hasAttachments: (attachmentCountByMessage[id] || 0) > 0,
      attachmentCount: attachmentCountByMessage[id] || 0,
      recipientCount: recipientCountByMessage[id] || 0,
      hasActions: Boolean(item.hasActions) || hasObjectActions,
    }
  })
}

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

const crud = makeCrudRoute<never, never, ListMessagesInput>({
  metadata,
  orm: {
    entity: Message,
    idField: 'id',
    orgField: null,
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'messages',
    entity: 'message',
  },
  indexer: {
    entityType: MESSAGE_ENTITY_ID,
  },
  enrichers: {
    entityId: MESSAGE_RESOURCE,
  },
  list: {
    schema: listMessagesSchema,
    entityId: MESSAGE_ENTITY_ID,
    fields: [
      'id',
      'type',
      'thread_id',
      'sender_user_id',
      'subject',
      'body',
      'priority',
      'is_draft',
      'sent_at',
      'action_data',
      'action_taken',
      'visibility',
      'source_entity_type',
      'source_entity_id',
      'external_email',
      'external_name',
      'tenant_id',
      'organization_id',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      sentAt: 'sent_at',
      sent_at: 'sent_at',
      subject: 'subject',
      priority: 'priority',
      updatedAt: 'updated_at',
      updated_at: 'updated_at',
    },
    buildFilters: buildMessageListIdFilter,
    transformItem: transformMessageListItem,
  },
  hooks: {
    afterList: decorateMessageListPayload,
  },
})

export function GET(req: Request) {
  const url = new URL(req.url)
  const hasExplicitSort =
    url.searchParams.has('sort')
    || url.searchParams.has('sortField')
    || url.searchParams.has('sortDir')
    || url.searchParams.has('order')
  if (!hasExplicitSort) {
    url.searchParams.set('sortField', 'sentAt')
    url.searchParams.set('sortDir', 'desc')
    return crud.GET(new Request(url, req))
  }
  return crud.GET(req)
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
