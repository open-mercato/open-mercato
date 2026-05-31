import type { DataQualityGeneratedRegistry, DataQualityTarget } from '@open-mercato/shared/modules/data-quality'

export type DataQualityTargetEntry = {
  moduleId: string
  targets: DataQualityTarget[]
}

const DATA_QUALITY_TARGETS_KEY = '__openMercatoDataQualityTargetEntries__'

function readGlobalEntries(): DataQualityTargetEntry[] {
  try {
    const value = (globalThis as Record<string, unknown>)[DATA_QUALITY_TARGETS_KEY]
    return Array.isArray(value) ? (value as DataQualityTargetEntry[]) : []
  } catch {
    return []
  }
}

function writeGlobalEntries(entries: DataQualityTargetEntry[]): void {
  try {
    ;(globalThis as Record<string, unknown>)[DATA_QUALITY_TARGETS_KEY] = entries
  } catch {
    // ignore global assignment failures
  }
}

export function registerDataQualityTargetEntries(entries: DataQualityTargetEntry[]): void {
  writeGlobalEntries(entries)
}

export function getDataQualityTargetEntries(): DataQualityTargetEntry[] {
  return readGlobalEntries()
}

export function loadTargetRegistry(): DataQualityGeneratedRegistry {
  const seen = new Set<string>()
  const targets: DataQualityTarget[] = []

  for (const entry of getDataQualityTargetEntries()) {
    for (const target of entry.targets) {
      const key = `${target.entityId}:${target.tableName}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(target)
    }
  }

  return { targets }
}
