import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { Message, MessageObject, MessageRecipient } from '../../../../data/entities'
import {
  findResolvedMessageActionById,
  isTerminalMessageAction,
  resolveActionCommandInput,
  resolveActionHref,
} from '../../../../lib/actions'
import { getMessageType } from '../../../../lib/message-types-registry'
import { attachOperationMetadataHeader, type OperationLogEntryLike } from '../../../../lib/operationMetadata'
import { resolveMessageContext } from '../../../../lib/routeHelpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { actionResultResponseSchema } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.actions'] },
}

export async function POST(
  req: Request,
  { params }: { params: { id: string; actionId: string } }
) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

  const rawBody = await req.json().catch(() => ({}))
  const body = (typeof rawBody === 'object' && rawBody && !Array.isArray(rawBody)
    ? rawBody
    : {}) as Record<string, unknown>

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (scope.organizationId) {
    if (message.organizationId !== scope.organizationId) {
      return Response.json({ error: 'Access denied' }, { status: 403 })
    }
  } else if (message.organizationId) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (!recipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const objects = await em.find(MessageObject, { messageId: message.id })
  const action = findResolvedMessageActionById(message, objects, params.actionId)

  if (!action) {
    return Response.json({ error: 'Action not found' }, { status: 404 })
  }

  if (message.actionTaken) {
    return Response.json(
      {
        error: 'Action already taken',
        actionTaken: message.actionTaken,
        actionTakenAt: message.actionTakenAt,
      },
      { status: 409 }
    )
  }

  const shouldRecordActionTaken = isTerminalMessageAction(action)

  if (message.actionData?.expiresAt) {
    if (new Date(message.actionData.expiresAt) < new Date()) {
      return Response.json({ error: 'Actions have expired' }, { status: 410 })
    }
  } else {
    const messageType = getMessageType(message.type)
    if (messageType?.actionsExpireAfterHours && message.sentAt) {
      const expiry = new Date(message.sentAt.getTime() + messageType.actionsExpireAfterHours * 60 * 60 * 1000)
      if (expiry < new Date()) {
        return Response.json({ error: 'Actions have expired' }, { status: 410 })
      }
    }
  }

  let result: Record<string, unknown> = {}
  let operationLogEntry: OperationLogEntryLike | null = null

  if (action.commandId) {
    try {
      const commandCtx = {
        container: ctx.container,
        auth: {
          sub: scope.userId,
          tenantId: scope.tenantId,
          orgId: scope.organizationId,
        },
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
      }

      const actionInput = resolveActionCommandInput(
        action,
        message,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId,
        },
        body,
      )

      if (actionInput.id == null) {
        const fallbackId = action.objectRef?.entityId ?? message.sourceEntityId ?? null
        if (typeof fallbackId === 'string' && fallbackId.trim().length > 0) {
          actionInput.id = fallbackId
        }
      }

      const commandResult = await commandBus.execute(action.commandId, {
        input: actionInput,
        ctx: commandCtx,
        metadata: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          resourceKind: 'messages',
        },
      })

      result = (commandResult.result as Record<string, unknown>) ?? {}
      operationLogEntry = commandResult.logEntry ?? null
    } catch (error) {
      console.error(`[messages:action] Command ${action.commandId} failed:`, error)
      return Response.json(
        {
          error: 'Action failed',
        },
        { status: 500 }
      )
    }
  } else if (action.href) {
    result = {
      redirect: resolveActionHref(action, message, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      }) ?? action.href,
    }
  } else {
    return Response.json({ error: 'Action has no executable target' }, { status: 409 })
  }

  if (shouldRecordActionTaken) {
    try {
      await commandBus.execute('messages.actions.record_terminal', {
        input: {
          messageId: message.id,
          actionId: action.id,
          result,
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
    } catch (error) {
      if (error instanceof Error && error.message === 'Action already taken') {
        return Response.json(
          {
            error: 'Action already taken',
            actionTaken: message.actionTaken,
            actionTakenAt: message.actionTakenAt,
          },
          { status: 409 },
        )
      }
      throw error
    }
  } else {
    await em.flush()
  }

  const eventBus = ctx.container.resolve('eventBus') as { emit: (event: string, payload: unknown, options?: unknown) => Promise<void> }
  if (shouldRecordActionTaken) {
    await eventBus.emit(
      'messages.action.taken',
      {
        messageId: message.id,
        actionId: action.id,
        userId: scope.userId,
        result,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true }
    )
  }

  const response = Response.json({ ok: true, actionId: action.id, result })
  attachOperationMetadataHeader(response, operationLogEntry, {
    resourceKind: 'messages.message',
    resourceId: message.id,
  })
  return response
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    POST: {
      summary: 'Execute message action',
      requestBody: { schema: z.record(z.string(), z.unknown()).optional() },
      responses: [
        { status: 200, description: 'Action executed', schema: actionResultResponseSchema },
        { status: 403, description: 'Access denied' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already taken' },
        { status: 410, description: 'Action expired' },
      ],
    },
  },
}
