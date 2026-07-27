/**
 * Pure helpers for the task-definition form's scheduling-safety UX (cron
 * preview, IANA timezone options, permission prefill, features-picker
 * vocabulary). Client-safe and dependency-free — the cron SEMANTIC check lives
 * in `@open-mercato/scheduler`'s `validateCronExpression`, imported by the page
 * itself.
 */

/**
 * Least-privilege floor a WORKFLOW-target task needs to start and observe its
 * own instances (ids verified against core `workflows` acl.ts). Agent-target
 * tasks legitimately run with an empty grant set.
 */
export const WORKFLOW_TARGET_PREFILL_FEATURES = [
  'workflows.instances.view',
  'workflows.instances.create',
] as const

export function parseGrantedFeaturesText(text: string | null | undefined): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Returns the prefill feature list when switching to a workflow target with no
 * grants yet, null when nothing should change. The caller guards create-mode
 * and once-per-mount semantics.
 */
export function resolveFeaturePrefill(
  targetType: 'agent' | 'workflow',
  currentFeatures: string[],
): string[] | null {
  if (targetType !== 'workflow') return null
  if (currentFeatures.length > 0) return null
  return [...WORKFLOW_TARGET_PREFILL_FEATURES]
}

/**
 * Feature ids not present in the declared catalog. Wildcard grants
 * (`workflows.*`) count as known when any catalog id lives under the prefix —
 * custom-module features may legitimately be missing, which is why unknown ids
 * warn instead of erroring at save time.
 */
export function unknownFeatureIds(selected: string[], catalogIds: string[]): string[] {
  if (selected.length === 0) return []
  const catalog = new Set(catalogIds)
  return selected.filter((id) => {
    if (catalog.has(id)) return false
    if (id === '*') return false
    if (id.endsWith('.*')) {
      const prefix = id.slice(0, -1)
      for (const known of catalog) {
        if (known.startsWith(prefix)) return false
      }
    }
    return true
  })
}

/** Compact fallback when the runtime lacks `Intl.supportedValuesOf`. */
const FALLBACK_TIME_ZONES = [
  'UTC',
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
]

export function listTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    )
    if (Array.isArray(supported) && supported.length > 0) {
      // The runtime list spells UTC as "Etc/UTC"; plain "UTC" is the scheduler
      // default and the most-wanted entry — surface it first.
      return supported.includes('UTC') ? supported : ['UTC', ...supported]
    }
  } catch {
    // fall through to the static list
  }
  return [...FALLBACK_TIME_ZONES]
}
