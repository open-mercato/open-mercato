import type { EntryGroup } from './groups'

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
  variants: ManifestVariant[]
}

export type RegistryManifest = {
  generatedAt: string
  entries: ManifestEntry[]
}
