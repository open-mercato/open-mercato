import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
  removeLocalStorageKey,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

type HiddenWidgetsEnvelopeV1 = { v: 1; hidden: string[] }

const LEGACY_HIDDEN_WIDGETS_KEY = 'om:portal:dashboard:hidden'
const HIDDEN_WIDGETS_KEY_PREFIX = 'om:portal:dashboard:hidden:v1:'
const CURRENT_VERSION = 1 as const

function buildHiddenWidgetsKey(orgSlug: string, userId: string): string {
  return `${HIDDEN_WIDGETS_KEY_PREFIX}${orgSlug}:${userId}`
}

function isHiddenWidgetsEnvelope(value: unknown): value is HiddenWidgetsEnvelopeV1 {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Record<string, unknown>
  return envelope.v === CURRENT_VERSION
    && Array.isArray(envelope.hidden)
    && envelope.hidden.every((id) => typeof id === 'string')
}

export function loadHiddenWidgets(orgSlug: string, userId: string): Set<string> {
  const envelope = readJsonFromLocalStorage<HiddenWidgetsEnvelopeV1 | null>(
    buildHiddenWidgetsKey(orgSlug, userId),
    null,
  )
  return isHiddenWidgetsEnvelope(envelope) ? new Set(envelope.hidden) : new Set()
}

export function saveHiddenWidgets(orgSlug: string, userId: string, hidden: Set<string>): void {
  const envelope: HiddenWidgetsEnvelopeV1 = { v: CURRENT_VERSION, hidden: Array.from(hidden) }
  writeJsonToLocalStorage(buildHiddenWidgetsKey(orgSlug, userId), envelope)
}

/** Drops the pre-scoping global key so stale preferences stop leaking across org/user contexts. */
export function clearLegacyHiddenWidgetsKey(): void {
  removeLocalStorageKey(LEGACY_HIDDEN_WIDGETS_KEY)
}
