import { z } from 'zod'

export const recordLockStrategySchema = z.enum(['optimistic', 'pessimistic'])

export const recordLockSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  strategy: recordLockStrategySchema.default('optimistic'),
  timeoutSeconds: z.number().int().min(30).max(3600).default(300),
  heartbeatSeconds: z.number().int().min(5).max(300).default(30),
  enabledResources: z.array(z.string().trim().min(1)).default([]),
  allowForceUnlock: z.boolean().default(true),
  notifyOnConflict: z.boolean().default(true),
})

export type RecordLockStrategy = z.infer<typeof recordLockStrategySchema>
export type RecordLockSettings = z.infer<typeof recordLockSettingsSchema>

export const DEFAULT_RECORD_LOCK_SETTINGS: RecordLockSettings = {
  enabled: true,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  enabledResources: ['*'],
  allowForceUnlock: true,
  notifyOnConflict: true,
}

export const RECORD_LOCKS_MODULE_ID = 'record_locks'
export const RECORD_LOCKS_SETTINGS_NAME = 'settings'

export function normalizeRecordLockSettings(input: unknown): RecordLockSettings {
  const parsed = recordLockSettingsSchema.parse(input ?? {})
  const seen = new Set<string>()
  const enabledResources = parsed.enabledResources
    .map((resource) => resource.trim())
    .filter((resource) => {
      if (!resource) return false
      if (seen.has(resource)) return false
      seen.add(resource)
      return true
    })

  return {
    ...parsed,
    enabledResources,
  }
}

export function isRecordLockingEnabledForResource(
  settings: RecordLockSettings,
  resourceKind: string | null | undefined,
): boolean {
  if (!settings.enabled) return false
  if (!resourceKind || resourceKind.trim().length === 0) return false
  const normalizedResourceKind = resourceKind.trim()
  const enabledResources = settings.enabledResources.map((item) => item.trim()).filter((item) => item.length > 0)
  if (!enabledResources.length) return true
  if (enabledResources.includes('*')) return true
  return enabledResources.some((entry) => {
    if (entry === normalizedResourceKind) return true
    if (entry.endsWith('.*')) {
      const prefix = entry.slice(0, -1)
      return normalizedResourceKind.startsWith(prefix)
    }
    return false
  })
}
