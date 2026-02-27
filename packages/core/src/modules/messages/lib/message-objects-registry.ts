import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import defaultTypes from '../message-objects'

const registry = new Map<string, MessageObjectTypeDefinition>()

export type RegisterMessageObjectTypesOptions = {
  replace?: boolean
}

function getKey(module: string, entityType: string): string {
  return `${module}:${entityType}`
}

function ensureDefaults(): void {
  if (registry.size > 0) return
  registerMessageObjectTypes(defaultTypes)
}

export function registerMessageObjectTypes(
  types: MessageObjectTypeDefinition[],
  options: RegisterMessageObjectTypesOptions = {},
): void {
  if (options.replace) {
    registry.clear()
  }
  for (const type of types) {
    const key = getKey(type.module, type.entityType)
    if (registry.has(key)) {
      console.warn(`[messages] Message object type "${key}" is already registered, overwriting`)
    }
    registry.set(key, type)
  }
}

export function getMessageObjectType(module: string, entityType: string): MessageObjectTypeDefinition | undefined {
  ensureDefaults()
  return registry.get(getKey(module, entityType))
}

export function isMessageObjectTypeAllowedForMessageType(
  objectType: MessageObjectTypeDefinition,
  messageType: string,
): boolean {
  if (!messageType || !messageType.trim()) return true
  const allowed = objectType.messageTypes
  if (!Array.isArray(allowed) || allowed.length === 0) return true
  return allowed.includes(messageType)
}

export function getMessageObjectTypesForMessageType(messageType: string): MessageObjectTypeDefinition[] {
  ensureDefaults()
  return Array.from(registry.values()).filter((objectType) =>
    isMessageObjectTypeAllowedForMessageType(objectType, messageType),
  )
}

export function getAllMessageObjectTypes(): MessageObjectTypeDefinition[] {
  ensureDefaults()
  return Array.from(registry.values())
}
