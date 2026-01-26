import type { NotificationTypeDefinition, NotificationTypeAction } from '@open-mercato/shared/modules/notifications/types'
import type { CreateNotificationInput, CreateBatchNotificationInput, CreateRoleNotificationInput, CreateFeatureNotificationInput } from '../data/validators'

/**
 * Transform type definition actions to API input actions.
 * Type definitions use labelKey (i18n-first), while API input uses label with optional labelKey.
 */
function mapActions(actions: NotificationTypeAction[] | undefined) {
  if (!actions || actions.length === 0) return undefined
  return actions.map((action) => ({
    id: action.id,
    // Use labelKey as fallback label - will be resolved at display time
    label: action.labelKey,
    labelKey: action.labelKey,
    variant: action.variant,
    icon: action.icon,
    commandId: action.commandId,
    href: action.href,
    confirmRequired: action.confirmRequired,
    confirmMessage: action.confirmMessageKey,
  }))
}

/**
 * Build a notification input from a type definition with i18n support.
 * This is the recommended way to create notifications - use type definitions from notifications.ts
 * to ensure i18n-first approach.
 *
 * @param typeDef - Notification type definition from module's notifications.ts
 * @param options - Notification options (recipient, variables, expiry, etc.)
 * @returns Notification input ready for service or queue
 */
export function buildNotificationFromType(
  typeDef: NotificationTypeDefinition,
  options: {
    recipientUserId: string
    titleVariables?: Record<string, string>
    bodyVariables?: Record<string, string>
    sourceEntityType?: string
    sourceEntityId?: string
    linkHref?: string
    groupKey?: string
    expiresAt?: string
  }
): CreateNotificationInput {
  return {
    recipientUserId: options.recipientUserId,
    type: typeDef.type,
    // i18n-first: use keys from type definition
    titleKey: typeDef.titleKey,
    bodyKey: typeDef.bodyKey,
    titleVariables: options.titleVariables,
    bodyVariables: options.bodyVariables,
    // Fallback: use keys as title/body (will be resolved at display time)
    title: typeDef.titleKey,
    body: typeDef.bodyKey,
    icon: typeDef.icon,
    severity: typeDef.severity,
    actions: mapActions(typeDef.actions),
    primaryActionId: typeDef.primaryActionId,
    sourceModule: typeDef.module,
    sourceEntityType: options.sourceEntityType,
    sourceEntityId: options.sourceEntityId,
    linkHref: options.linkHref ?? typeDef.linkHref,
    groupKey: options.groupKey,
    expiresAt: options.expiresAt ?? (
      typeDef.expiresAfterHours
        ? new Date(Date.now() + typeDef.expiresAfterHours * 60 * 60 * 1000).toISOString()
        : undefined
    ),
  }
}

/**
 * Build a batch notification input from a type definition
 */
export function buildBatchNotificationFromType(
  typeDef: NotificationTypeDefinition,
  options: {
    recipientUserIds: string[]
    titleVariables?: Record<string, string>
    bodyVariables?: Record<string, string>
    sourceEntityType?: string
    sourceEntityId?: string
    linkHref?: string
    groupKey?: string
    expiresAt?: string
  }
): CreateBatchNotificationInput {
  return {
    recipientUserIds: options.recipientUserIds,
    type: typeDef.type,
    titleKey: typeDef.titleKey,
    bodyKey: typeDef.bodyKey,
    titleVariables: options.titleVariables,
    bodyVariables: options.bodyVariables,
    title: typeDef.titleKey,
    body: typeDef.bodyKey,
    icon: typeDef.icon,
    severity: typeDef.severity,
    actions: mapActions(typeDef.actions),
    primaryActionId: typeDef.primaryActionId,
    sourceModule: typeDef.module,
    sourceEntityType: options.sourceEntityType,
    sourceEntityId: options.sourceEntityId,
    linkHref: options.linkHref ?? typeDef.linkHref,
    groupKey: options.groupKey,
    expiresAt: options.expiresAt ?? (
      typeDef.expiresAfterHours
        ? new Date(Date.now() + typeDef.expiresAfterHours * 60 * 60 * 1000).toISOString()
        : undefined
    ),
  }
}

/**
 * Build a role notification input from a type definition
 */
export function buildRoleNotificationFromType(
  typeDef: NotificationTypeDefinition,
  options: {
    roleId: string
    titleVariables?: Record<string, string>
    bodyVariables?: Record<string, string>
    sourceEntityType?: string
    sourceEntityId?: string
    linkHref?: string
    groupKey?: string
    expiresAt?: string
  }
): CreateRoleNotificationInput {
  return {
    roleId: options.roleId,
    type: typeDef.type,
    titleKey: typeDef.titleKey,
    bodyKey: typeDef.bodyKey,
    titleVariables: options.titleVariables,
    bodyVariables: options.bodyVariables,
    title: typeDef.titleKey,
    body: typeDef.bodyKey,
    icon: typeDef.icon,
    severity: typeDef.severity,
    actions: mapActions(typeDef.actions),
    primaryActionId: typeDef.primaryActionId,
    sourceModule: typeDef.module,
    sourceEntityType: options.sourceEntityType,
    sourceEntityId: options.sourceEntityId,
    linkHref: options.linkHref ?? typeDef.linkHref,
    groupKey: options.groupKey,
    expiresAt: options.expiresAt ?? (
      typeDef.expiresAfterHours
        ? new Date(Date.now() + typeDef.expiresAfterHours * 60 * 60 * 1000).toISOString()
        : undefined
    ),
  }
}

/**
 * Build a feature-based notification input from a type definition
 */
export function buildFeatureNotificationFromType(
  typeDef: NotificationTypeDefinition,
  options: {
    requiredFeature: string
    titleVariables?: Record<string, string>
    bodyVariables?: Record<string, string>
    sourceEntityType?: string
    sourceEntityId?: string
    linkHref?: string
    groupKey?: string
    expiresAt?: string
  }
): CreateFeatureNotificationInput {
  return {
    requiredFeature: options.requiredFeature,
    type: typeDef.type,
    titleKey: typeDef.titleKey,
    bodyKey: typeDef.bodyKey,
    titleVariables: options.titleVariables,
    bodyVariables: options.bodyVariables,
    title: typeDef.titleKey,
    body: typeDef.bodyKey,
    icon: typeDef.icon,
    severity: typeDef.severity,
    actions: mapActions(typeDef.actions),
    primaryActionId: typeDef.primaryActionId,
    sourceModule: typeDef.module,
    sourceEntityType: options.sourceEntityType,
    sourceEntityId: options.sourceEntityId,
    linkHref: options.linkHref ?? typeDef.linkHref,
    groupKey: options.groupKey,
    expiresAt: options.expiresAt ?? (
      typeDef.expiresAfterHours
        ? new Date(Date.now() + typeDef.expiresAfterHours * 60 * 60 * 1000).toISOString()
        : undefined
    ),
  }
}
