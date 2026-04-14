import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageAccessToken, MessageObject, MessageRecipient } from '../../../data/entities'
import { MAX_TOKEN_USE_COUNT } from '../../../commands/tokens'
import { messageTokenResponseSchema } from '../../openapi'
import { hashAuthToken } from '../../../../auth/lib/tokenHash'

export const metadata = {
  GET: { requireAuth: false },
}

type TokenAccess = {
  message: Message
  recipientUserId: string
}

function responseForTokenError(error: unknown): Response | null {
  if (!(error instanceof Error)) return null
  if (error.message === 'Invalid or expired link') {
    return Response.json({ error: 'Invalid or expired link' }, { status: 404 })
  }
  if (error.message === 'This link has expired') {
    return Response.json({ error: 'This link has expired' }, { status: 410 })
  }
  if (error.message === 'This link can no longer be used') {
    return Response.json({ error: 'This link can no longer be used' }, { status: 409 })
  }
  if (error.message === 'Message not found') {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }
  return null
}

async function resolveTokenAccess(em: EntityManager, token: string): Promise<TokenAccess> {
  const hashedToken = hashAuthToken(token)
  const accessToken =
    (await findOneWithDecryption(em, MessageAccessToken, { token: hashedToken })) ??
    (await findOneWithDecryption(em, MessageAccessToken, { token }))
  if (!accessToken) {
    throw new Error('Invalid or expired link')
  }
  if (accessToken.expiresAt < new Date()) {
    throw new Error('This link has expired')
  }
  if (accessToken.useCount >= MAX_TOKEN_USE_COUNT) {
    throw new Error('This link can no longer be used')
  }

  const message = await findOneWithDecryption(em, Message, {
    id: accessToken.messageId,
    deletedAt: null,
  })
  if (!message) {
    throw new Error('Message not found')
  }

  const tenantScope = { tenantId: message.tenantId, organizationId: message.organizationId ?? null }

  const recipient = await findOneWithDecryption(
    em,
    MessageRecipient,
    {
      messageId: accessToken.messageId,
      recipientUserId: accessToken.recipientUserId,
      deletedAt: null,
    },
    undefined,
    tenantScope,
  )
  if (!recipient) {
    throw new Error('Invalid or expired link')
  }

  return {
    message,
    recipientUserId: accessToken.recipientUserId,
  }
}

function resolveAuthenticatedUserId(auth: AuthContext): string | null {
  if (!auth) return null
  if (auth.isApiKey && typeof auth.userId === 'string') return auth.userId
  return auth.sub
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const em = container.resolve('em') as EntityManager

  let access: TokenAccess
  try {
    access = await resolveTokenAccess(em, params.token)
  } catch (error) {
    const errorResponse = responseForTokenError(error)
    if (errorResponse) return errorResponse
    throw error
  }

  const tenantScope = { tenantId: access.message.tenantId, organizationId: access.message.organizationId ?? null }
  const objects = await findWithDecryption(
    em,
    MessageObject,
    { messageId: access.message.id },
    undefined,
    tenantScope,
  )
  const requiresAuth = objects.some((item) => item.actionRequired)
  let auth: AuthContext = null
  if (requiresAuth) {
    auth = await getAuthFromRequest(req)
    if (!auth) {
      return Response.json({ requiresAuth: true })
    }
    if (resolveAuthenticatedUserId(auth) !== access.recipientUserId) {
      return Response.json({ error: 'Forbidden', requiresAuth: true }, { status: 403 })
    }
  }

  let commandResult: { messageId: string; recipientUserId: string }
  try {
    const executed = await commandBus.execute<unknown, { messageId: string; recipientUserId: string }>('messages.tokens.consume', {
      input: { token: params.token },
      ctx: {
        container,
        auth,
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
        request: req,
      },
    })
    commandResult = executed.result
  } catch (error) {
    const errorResponse = responseForTokenError(error)
    if (errorResponse) return errorResponse
    throw error
  }

  const message = await findOneWithDecryption(
    em,
    Message,
    { id: commandResult.messageId, tenantId: access.message.tenantId, deletedAt: null },
    undefined,
    tenantScope,
  )
  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  return Response.json({
    id: message.id,
    type: message.type,
    subject: message.subject,
    body: message.body,
    bodyFormat: message.bodyFormat,
    priority: message.priority,
    senderUserId: message.senderUserId,
    sentAt: message.sentAt,
    actionData: message.actionData,
    actionTaken: message.actionTaken,
    actionTakenAt: message.actionTakenAt,
    actionTakenByUserId: message.actionTakenByUserId,
    objects: objects.map((item) => ({
      id: item.id,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      actionType: item.actionType,
      actionLabel: item.actionLabel,
      snapshot: item.entitySnapshot,
    })),
    requiresAuth: objects.some((item) => item.actionRequired),
    recipientUserId: commandResult.recipientUserId,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Access message via token',
      responses: [
        {
          status: 200,
          description: 'Message detail via token',
          schema: messageTokenResponseSchema,
        },
        { status: 404, description: 'Invalid or expired link' },
        { status: 409, description: 'Token usage exceeded' },
        { status: 410, description: 'Token expired' },
      ],
    },
  },
}
