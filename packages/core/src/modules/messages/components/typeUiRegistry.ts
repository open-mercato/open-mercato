"use client"

import type { ComponentType } from 'react'
import type {
  MessageActionsProps,
  MessageContentProps,
  MessageListItemProps,
  MessageObjectTypeDefinition,
  MessageTypeDefinition,
  ObjectPreviewProps,
  ObjectDetailProps,
} from '@open-mercato/shared/modules/messages/types'
import { DefaultMessageActions } from './DefaultMessageActions'
import { DefaultMessageContent } from './DefaultMessageContent'
import { DefaultMessageListItem } from './DefaultMessageListItem'
import { MessageConfirmationActions } from './MessageConfirmationActions'
import { MessageConfirmationContent } from './MessageConfirmationContent'

const listItemComponents = new Map<string, ComponentType<MessageListItemProps>>([
  ['messages.default.listItem', DefaultMessageListItem],
])

const contentComponents = new Map<string, ComponentType<MessageContentProps>>([
  ['messages.default.content', DefaultMessageContent],
  ['messages.confirmation.content', MessageConfirmationContent],
])

const actionsComponents = new Map<string, ComponentType<MessageActionsProps>>([
  ['messages.default.actions', DefaultMessageActions],
  ['messages.confirmation.actions', MessageConfirmationActions],
])

const objectDetailComponents = new Map<string, ComponentType<ObjectDetailProps>>()
const objectPreviewComponents = new Map<string, ComponentType<ObjectPreviewProps>>()

function getObjectDetailComponentKey(entityModule: string, entityType: string): string {
  return `${entityModule}:${entityType}`
}

export function registerMessageListItemComponent(
  key: string,
  component: ComponentType<MessageListItemProps>,
): void {
  listItemComponents.set(key, component)
}

export function registerMessageContentComponent(
  key: string,
  component: ComponentType<MessageContentProps>,
): void {
  contentComponents.set(key, component)
}

export function registerMessageActionsComponent(
  key: string,
  component: ComponentType<MessageActionsProps>,
): void {
  actionsComponents.set(key, component)
}

export function registerMessageObjectDetailComponent(
  entityModule: string,
  entityType: string,
  component: ComponentType<ObjectDetailProps>,
): void {
  objectDetailComponents.set(getObjectDetailComponentKey(entityModule, entityType), component)
}

export function registerMessageObjectPreviewComponent(
  entityModule: string,
  entityType: string,
  component: ComponentType<ObjectPreviewProps>,
): void {
  objectPreviewComponents.set(getObjectDetailComponentKey(entityModule, entityType), component)
}

export function registerMessageTypeUiComponents(
  types: MessageTypeDefinition[],
): void {
  for (const type of types) {
    const listItemKey = type.ui?.listItemComponent
    if (listItemKey && type.ListItemComponent) {
      registerMessageListItemComponent(listItemKey, type.ListItemComponent)
    }

    const contentKey = type.ui?.contentComponent
    if (contentKey && type.ContentComponent) {
      registerMessageContentComponent(contentKey, type.ContentComponent)
    }

    const actionsKey = type.ui?.actionsComponent
    if (actionsKey && type.ActionsComponent) {
      registerMessageActionsComponent(actionsKey, type.ActionsComponent)
    }
  }
}

export function registerMessageObjectTypeUiComponents(
  types: MessageObjectTypeDefinition[],
): void {
  for (const type of types) {
    if (type.PreviewComponent) {
      registerMessageObjectPreviewComponent(type.module, type.entityType, type.PreviewComponent)
    }
    if (!type.DetailComponent) continue
    registerMessageObjectDetailComponent(type.module, type.entityType, type.DetailComponent)
  }
}

export function resolveMessageListItemComponent(key: string | null | undefined): ComponentType<MessageListItemProps> | null {
  if (!key) return null
  return listItemComponents.get(key) ?? null
}

export function resolveMessageContentComponent(key: string | null | undefined): ComponentType<MessageContentProps> | null {
  if (!key) return null
  return contentComponents.get(key) ?? null
}

export function resolveMessageActionsComponent(key: string | null | undefined): ComponentType<MessageActionsProps> | null {
  if (!key) return null
  return actionsComponents.get(key) ?? null
}

export function resolveMessageObjectDetailComponent(
  entityModule: string | null | undefined,
  entityType: string | null | undefined,
): ComponentType<ObjectDetailProps> | null {
  if (!entityModule || !entityType) return null
  return objectDetailComponents.get(getObjectDetailComponentKey(entityModule, entityType)) ?? null
}

export function resolveMessageObjectPreviewComponent(
  entityModule: string | null | undefined,
  entityType: string | null | undefined,
): ComponentType<ObjectPreviewProps> | null {
  if (!entityModule || !entityType) return null
  return objectPreviewComponents.get(getObjectDetailComponentKey(entityModule, entityType)) ?? null
}
