"use client"

import type { ComponentType } from 'react'
import type {
  MessageActionsProps,
  MessageContentProps,
  MessageListItemProps,
  ObjectPreviewProps,
  ObjectDetailProps,
} from '@open-mercato/shared/modules/messages/types'
import { MessageRecordObjectDetail } from '../defaults/MessageRecordObjectDetail'
import { MessageRecordObjectPreview } from './../defaults/MessageRecordObjectPreview'

export type MessageUiComponentRegistry = {
  listItemComponents: Record<string, ComponentType<MessageListItemProps>>
  contentComponents: Record<string, ComponentType<MessageContentProps>>
  actionsComponents: Record<string, ComponentType<MessageActionsProps>>
  objectDetailComponents: Record<string, ComponentType<ObjectDetailProps>>
  objectPreviewComponents: Record<string, ComponentType<ObjectPreviewProps>>
}

const listItemComponents = new Map<string, ComponentType<MessageListItemProps>>()
const contentComponents = new Map<string, ComponentType<MessageContentProps>>()
const actionsComponents = new Map<string, ComponentType<MessageActionsProps>>()
const objectDetailComponents = new Map<string, ComponentType<ObjectDetailProps>>()
const objectPreviewComponents = new Map<string, ComponentType<ObjectPreviewProps>>()

function getObjectDetailComponentKey(entityModule: string, entityType: string): string {
  return `${entityModule}:${entityType}`
}

export function configureMessageUiComponentRegistry(registry: MessageUiComponentRegistry): void {
  listItemComponents.clear()
  contentComponents.clear()
  actionsComponents.clear()
  objectDetailComponents.clear()
  objectPreviewComponents.clear()

  for (const [key, component] of Object.entries(registry.listItemComponents ?? {})) {
    listItemComponents.set(key, component)
  }
  for (const [key, component] of Object.entries(registry.contentComponents ?? {})) {
    contentComponents.set(key, component)
  }
  for (const [key, component] of Object.entries(registry.actionsComponents ?? {})) {
    actionsComponents.set(key, component)
  }
  for (const [key, component] of Object.entries(registry.objectDetailComponents ?? {})) {
    objectDetailComponents.set(key, component)
  }
  for (const [key, component] of Object.entries(registry.objectPreviewComponents ?? {})) {
    objectPreviewComponents.set(key, component)
  }
}

export function getMessageUiComponentRegistry(): MessageUiComponentRegistry {
  return {
    listItemComponents: Object.fromEntries(listItemComponents.entries()),
    contentComponents: Object.fromEntries(contentComponents.entries()),
    actionsComponents: Object.fromEntries(actionsComponents.entries()),
    objectDetailComponents: Object.fromEntries(objectDetailComponents.entries()),
    objectPreviewComponents: Object.fromEntries(objectPreviewComponents.entries()),
  }
}

export function getMessageUiComponentForListItem(
  key: string | null | undefined,
): ComponentType<MessageListItemProps> | null {
  if (!key) return null
  return listItemComponents.get(key) ?? null
}

export function getMessageUiComponentForContent(
  key: string | null | undefined,
): ComponentType<MessageContentProps> | null {
  if (!key) return null
  return contentComponents.get(key) ?? null
}

export function getMessageUiComponentForActions(
  key: string | null | undefined,
): ComponentType<MessageActionsProps> | null {
  if (!key) return null
  return actionsComponents.get(key) ?? null
}

export function getMessageUiComponentForObjectDetail(
  entityModule: string | null | undefined,
  entityType: string | null | undefined,
): ComponentType<ObjectDetailProps> | null {
  if (!entityModule || !entityType) return MessageRecordObjectDetail
  const key = getObjectDetailComponentKey(entityModule, entityType)
  return objectDetailComponents.get(key) ?? MessageRecordObjectDetail
}

export function getMessageUiComponentForObjectPreview(
  entityModule: string | null | undefined,
  entityType: string | null | undefined,
): ComponentType<ObjectPreviewProps> | null {
  if (!entityModule || !entityType) {
    return objectPreviewComponents.get('messages:default') ?? MessageRecordObjectPreview
  }
  const key = getObjectDetailComponentKey(entityModule, entityType)
  const component = objectPreviewComponents.get(key)
  return component ?? objectPreviewComponents.get('messages:default') ?? MessageRecordObjectPreview
}
