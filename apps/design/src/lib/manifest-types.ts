import type { EntryGroup } from './groups'
import type { PropRow } from './props-table'

export type ManifestVariant = {
  id: string
  title: string
  code: string
}

export type ManifestEntry = {
  id: string
  title: string
  family: string
  familyLabelKey: string
  group: EntryGroup
  importPath: string
  descriptionKey?: string
  keywords: string[]
  usage?: { do?: string[]; dont?: string[] }
  galleryFile: string
  sourceFile?: string
  contract?: { file: string; rows: PropRow[] }
  variants: ManifestVariant[]
}

export type RegistryManifest = {
  generatedAt: string
  entries: ManifestEntry[]
}
