"use client"

import type { ComponentType } from 'react'
import type {
  MessageActionsProps,
  MessageContentProps,
  MessageListItemProps,
  ObjectPreviewProps,
  ObjectDetailProps,
} from '@open-mercato/shared/modules/messages/types'
import { getAllMessageTypes } from '../../lib/message-types-registry'
import { getAllMessageObjectTypes } from '../../lib/message-objects-registry'
import { MessageRecordObjectDetail } from '../defaults/MessageRecordObjectDetail'
import { MessageRecordObjectPreview } from './../defaults/MessageRecordObjectPreview'

// Build complete registries from auto-discovered components
const listItemComponents = new Map<string, ComponentType<MessageListItemProps>>()
const contentComponents = new Map<string, ComponentType<MessageContentProps>>()
const actionsComponents = new Map<string, ComponentType<MessageActionsProps>>()
const objectDetailComponents = new Map<string, ComponentType<ObjectDetailProps>>()
const objectPreviewComponents = new Map<string, ComponentType<ObjectPreviewProps>>()

// Register auto-discovered message types from registry
const registeredMessageTypes = getAllMessageTypes()
for (const messageType of registeredMessageTypes) {
  if (messageType.ui?.listItemComponent && messageType.ListItemComponent) {
    listItemComponents.set(messageType.ui.listItemComponent, messageType.ListItemComponent)
  }
  if (messageType.ui?.contentComponent && messageType.ContentComponent) {
    contentComponents.set(messageType.ui.contentComponent, messageType.ContentComponent)
  }
  if (messageType.ui?.actionsComponent && messageType.ActionsComponent) {
    actionsComponents.set(messageType.ui.actionsComponent, messageType.ActionsComponent)
  }
}

// Register auto-discovered message object types from registry
const registeredMessageObjectTypes = getAllMessageObjectTypes()
for (const objectType of registeredMessageObjectTypes) {
  const key = `${objectType.module}:${objectType.entityType}`
  if (objectType.PreviewComponent) {
    objectPreviewComponents.set(key, objectType.PreviewComponent)
  }
  if (objectType.DetailComponent) {
    objectDetailComponents.set(key, objectType.DetailComponent)
  }
}


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
  types: import('@open-mercato/shared/modules/messages/types').MessageTypeDefinition[],
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
  types: import('@open-mercato/shared/modules/messages/types').MessageObjectTypeDefinition[],
): void {
  for (const type of types) {
    if (type.PreviewComponent) {
      registerMessageObjectPreviewComponent(type.module, type.entityType, type.PreviewComponent)
    }
    if (type.DetailComponent) {
      registerMessageObjectDetailComponent(type.module, type.entityType, type.DetailComponent)
    }
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
  if (!entityModule || !entityType) return MessageRecordObjectDetail
  return objectDetailComponents.get(getObjectDetailComponentKey(entityModule, entityType))
    ?? MessageRecordObjectDetail
}

export function resolveMessageObjectPreviewComponent(
  entityModule: string | null | undefined,
  entityType: string | null | undefined,
): ComponentType<ObjectPreviewProps> | null {
  if (!entityModule || !entityType) {
    return objectPreviewComponents.get('messages:default') ?? MessageRecordObjectPreview
  }
  const component = objectPreviewComponents.get(getObjectDetailComponentKey(entityModule, entityType))
  return component ?? objectPreviewComponents.get('messages:default') ?? MessageRecordObjectPreview
}
