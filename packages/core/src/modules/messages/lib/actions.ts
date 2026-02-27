import type { Message, MessageAction, MessageActionData, MessageObject } from '../data/entities'
import { getMessageObjectType } from './message-objects-registry'
import { getMessageType } from './message-types-registry'

type MessageActionSource = 'message' | 'type_default' | 'object'

export type MessageActionObjectRef = {
  objectId: string
  entityModule: string
  entityType: string
  entityId: string
}

export type ResolvedMessageAction = MessageAction & {
  source: MessageActionSource
  objectRef?: MessageActionObjectRef
}

export type MessageActionResolutionContext = {
  tenantId: string
  organizationId?: string | null
  userId: string
}

function normalizeActionLabel(
  action: Pick<MessageAction, 'label' | 'id'>,
  fallback?: string | null,
): string {
  if (typeof action.label === 'string' && action.label.trim().length > 0) {
    return action.label
  }
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim()
  }
  return action.id
}

export function isTerminalMessageAction(
  action: Pick<MessageAction, 'isTerminal' | 'commandId' | 'href'>,
): boolean {
  if (typeof action.isTerminal === 'boolean') return action.isTerminal
  if (typeof action.commandId === 'string' && action.commandId.trim().length > 0) return true
  if (typeof action.href === 'string' && action.href.trim().length > 0) return false
  return true
}

export function buildMessageObjectActionId(objectId: string, actionId: string): string {
  return `object:${objectId}:${actionId}`
}

function readActionDataExpiry(message: Message): string | undefined {
  if (message.actionData?.expiresAt) return message.actionData.expiresAt
  const messageType = getMessageType(message.type)
  if (!messageType?.actionsExpireAfterHours || !message.sentAt) return undefined
  return new Date(
    message.sentAt.getTime() + messageType.actionsExpireAfterHours * 60 * 60 * 1000,
  ).toISOString()
}

export function buildResolvedMessageActions(
  message: Message,
  objects: MessageObject[],
): MessageActionData | null {
  const resolved: ResolvedMessageAction[] = []
  const usedIds = new Set<string>()

  const pushAction = (
    action: MessageAction,
    source: MessageActionSource,
    objectRef?: MessageActionObjectRef,
    labelFallback?: string | null,
  ) => {
    const id = typeof action.id === 'string' ? action.id.trim() : ''
    if (!id || usedIds.has(id)) return
    usedIds.add(id)

    resolved.push({
      ...action,
      id,
      label: normalizeActionLabel(action, labelFallback),
      source,
      objectRef,
    })
  }

  for (const action of message.actionData?.actions ?? []) {
    pushAction(action, 'message')
  }

  const messageType = getMessageType(message.type)
  for (const action of messageType?.defaultActions ?? []) {
    pushAction(action, 'type_default')
  }

  for (const object of objects) {
    if (!object.actionRequired || !object.actionType) continue
    const objectType = getMessageObjectType(object.entityModule, object.entityType)
    if (!objectType) continue
    const actionDef = objectType.actions.find((entry) => entry.id === object.actionType)
    if (!actionDef) continue

    pushAction(
      {
        id: buildMessageObjectActionId(object.id, actionDef.id),
        label: object.actionLabel ?? actionDef.id,
        labelKey: actionDef.labelKey,
        variant: actionDef.variant,
        icon: actionDef.icon,
        commandId: actionDef.commandId,
        href: actionDef.href,
        isTerminal: actionDef.isTerminal,
        confirmRequired: actionDef.confirmRequired,
        confirmMessage: actionDef.confirmMessage,
      },
      'object',
      {
        objectId: object.id,
        entityModule: object.entityModule,
        entityType: object.entityType,
        entityId: object.entityId,
      },
      object.actionLabel ?? actionDef.id,
    )
  }

  const expiresAt = readActionDataExpiry(message)
  if (resolved.length === 0 && !expiresAt) {
    return null
  }

  const configuredPrimaryActionId = message.actionData?.primaryActionId
  const primaryActionId = configuredPrimaryActionId && resolved.some((entry) => entry.id === configuredPrimaryActionId)
    ? configuredPrimaryActionId
    : resolved[0]?.id

  return {
    actions: resolved,
    primaryActionId,
    expiresAt,
  }
}

export function findResolvedMessageActionById(
  message: Message,
  objects: MessageObject[],
  actionId: string,
): ResolvedMessageAction | null {
  const actionData = buildResolvedMessageActions(message, objects)
  const match = actionData?.actions.find((entry) => entry.id === actionId)
  return (match as ResolvedMessageAction | undefined) ?? null
}

function buildTemplateContext(
  message: Message,
  resolutionContext: MessageActionResolutionContext,
  objectRef?: MessageActionObjectRef,
): Record<string, unknown> {
  return {
    messageId: message.id,
    sourceEntityId: message.sourceEntityId ?? message.id,
    sourceEntityType: message.sourceEntityType ?? null,
    threadId: message.threadId ?? null,
    parentMessageId: message.parentMessageId ?? null,
    messageType: message.type,
    tenantId: resolutionContext.tenantId,
    organizationId: resolutionContext.organizationId ?? null,
    userId: resolutionContext.userId,
    objectId: objectRef?.objectId ?? null,
    entityId: objectRef?.entityId ?? null,
    entityType: objectRef?.entityType ?? null,
    entityModule: objectRef?.entityModule ?? null,
  }
}

function resolveTemplateString(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (fullMatch, key: string) => {
    const value = context[key]
    if (value == null) return fullMatch
    return String(value)
  })
}

export function resolveActionHref(
  action: ResolvedMessageAction,
  message: Message,
  resolutionContext: MessageActionResolutionContext,
): string | null {
  if (!action.href) return null
  const context = buildTemplateContext(message, resolutionContext, action.objectRef)
  return resolveTemplateString(action.href, context)
}

export function resolveActionCommandInput(
  action: ResolvedMessageAction,
  message: Message,
  _resolutionContext: MessageActionResolutionContext,
  requestInput: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...requestInput,
    messageId: message.id,
    actionId: action.id,
  }
}
