import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

const GLOBAL_NOTIFICATION_HANDLERS_KEY = '__openMercatoNotificationHandlers__'

type NotificationHandlerRegistryEntry = {
  moduleId: string
  handler: NotificationHandler
}

let _handlerEntries: NotificationHandlerRegistryEntry[] | null = null

function readGlobalEntries(): NotificationHandlerRegistryEntry[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_NOTIFICATION_HANDLERS_KEY]
    return Array.isArray(value) ? (value as NotificationHandlerRegistryEntry[]) : null
  } catch {
    return null
  }
}

function writeGlobalEntries(entries: NotificationHandlerRegistryEntry[]) {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_NOTIFICATION_HANDLERS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

export function registerNotificationHandlers(
  entries: Array<{ moduleId: string; handlers: NotificationHandler[] }>,
) {
  const flat: NotificationHandlerRegistryEntry[] = []
  for (const entry of entries) {
    for (const handler of entry.handlers ?? []) {
      flat.push({ moduleId: entry.moduleId, handler })
    }
  }
  flat.sort((a, b) => (b.handler.priority ?? 50) - (a.handler.priority ?? 50))
  _handlerEntries = flat
  writeGlobalEntries(flat)
}

export function getNotificationHandlerEntries(): NotificationHandlerRegistryEntry[] {
  const globalEntries = readGlobalEntries()
  if (globalEntries) return globalEntries
  if (!_handlerEntries) return []
  return _handlerEntries
}
