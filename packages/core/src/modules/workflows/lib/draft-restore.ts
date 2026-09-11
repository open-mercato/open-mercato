/**
 * Draft restore decision helpers (spec §4.7 save model, Step 8.3).
 *
 * Pure logic behind the visual editor's per-user draft layer: whether a
 * definition id can have a server draft at all, a stable (key-order
 * insensitive) serialization used to compare editor state against persisted
 * drafts, and the restore-banner decision (draft exists? differs from the
 * loaded definition? was it based on an older definition version?).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isServerDraftEligible(definitionId: string | null | undefined): boolean {
  if (!definitionId) return false
  return UUID_PATTERN.test(definitionId)
}

function stableSerializeValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const items = value.map((item) => stableSerializeValue(item) ?? 'null')
    return `[${items.join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const serialized = stableSerializeValue(record[key])
      return serialized === undefined ? undefined : `${JSON.stringify(key)}:${serialized}`
    })
    .filter((entry): entry is string => entry !== undefined)
  return `{${entries.join(',')}}`
}

export function stableSerializeDefinition(value: unknown): string {
  return stableSerializeValue(value) ?? 'null'
}

export type DraftRestoreDecision =
  | { offerRestore: false }
  | { offerRestore: true; baseMismatch: boolean }

export type DraftRestoreInput = {
  draftDefinition: unknown
  draftBaseUpdatedAt: string | null
  loadedDefinition: unknown
  definitionUpdatedAt: string | null
}

function timestampsDiffer(base: string | null, current: string | null): boolean {
  if (!base || !current) return false
  const baseMs = Date.parse(base)
  const currentMs = Date.parse(current)
  if (Number.isNaN(baseMs) || Number.isNaN(currentMs)) return base !== current
  return baseMs !== currentMs
}

export function decideDraftRestore(input: DraftRestoreInput): DraftRestoreDecision {
  if (input.draftDefinition === null || input.draftDefinition === undefined) {
    return { offerRestore: false }
  }
  const draftSerialized = stableSerializeDefinition(input.draftDefinition)
  const loadedSerialized = stableSerializeDefinition(input.loadedDefinition)
  if (draftSerialized === loadedSerialized) {
    return { offerRestore: false }
  }
  return {
    offerRestore: true,
    baseMismatch: timestampsDiffer(input.draftBaseUpdatedAt, input.definitionUpdatedAt),
  }
}
