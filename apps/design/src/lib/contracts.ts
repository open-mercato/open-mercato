import { findEntry } from './manifest'
import type { ManifestEntry } from './manifest-types'

export function contractForEntry(entryId: string): NonNullable<ManifestEntry['contract']> | null {
  return findEntry(entryId)?.contract ?? null
}
