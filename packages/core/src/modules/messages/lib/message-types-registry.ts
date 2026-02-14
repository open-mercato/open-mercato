import type { MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import defaultTypes from '../message-types'

const registry = new Map<string, MessageTypeDefinition>()

export type RegisterMessageTypesOptions = {
  replace?: boolean
}

function ensureDefaults(): void {
  if (registry.size > 0) return
  registerMessageTypes(defaultTypes)
}

export function registerMessageTypes(
  types: MessageTypeDefinition[],
  options: RegisterMessageTypesOptions = {},
): void {
  if (options.replace) {
    registry.clear()
  }
  for (const type of types) {
    if (registry.has(type.type)) {
      console.warn(`[messages] Message type "${type.type}" is already registered, overwriting`)
    }
    registry.set(type.type, type)
  }
}

export function getMessageType(type: string): MessageTypeDefinition | undefined {
  ensureDefaults()
  return registry.get(type)
}

export function isMessageTypeCreateableByUser(type: string): boolean {
  const definition = getMessageType(type)
  return Boolean(definition?.isCreateableByUser)
}

export function getMessageTypeOrDefault(type: string): MessageTypeDefinition {
  ensureDefaults()
  return registry.get(type) ?? registry.get('default') ?? defaultTypes[0]!
}

export function getAllMessageTypes(): MessageTypeDefinition[] {
  ensureDefaults()
  return Array.from(registry.values())
}

export function getMessageTypesByModule(module: string): MessageTypeDefinition[] {
  ensureDefaults()
  return Array.from(registry.values()).filter((entry) => entry.module === module)
}
