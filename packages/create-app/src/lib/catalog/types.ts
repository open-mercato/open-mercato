export type CatalogSource = 'core' | 'official' | 'community' | 'third-party' | 'enterprise'

export type CatalogLicense = {
  spdx: string | null
  kind: 'osi' | 'proprietary' | 'enterprise' | 'unknown'
}

export type CatalogModule = {
  id: string
  from: string
  title: string
  description: string
  requires: string[]
  source: CatalogSource
  locator: string
  license: CatalogLicense
  tier: 'listed' | 'verified' | null
  verifiedOn: string[]
  /** Command with the version the catalog verified on its latest line (`lines[0]`). */
  install: string
  /** Command per verified line (`picker.json` `installByLine`); null when the catalog does not publish it. */
  installByLine: Record<string, string> | null
  /** Lines whose new app (classic preset) already registers this module (`picker.json` `inPresets`); [] when none. */
  inPresets: string[]
  /** What the catalog says instead of a command when the latest line's new app has the module (`presetNote`). */
  presetNote: string | null
  /** Module IDs of a new app whose backend route this module adds too (`picker.json` `conflictsWith`); [] when none. */
  conflictsWith: string[]
  /** The catalog's sentence that `yarn generate` refuses this module next to them (`warning`); null when none. */
  warning: string | null
}

export type PickerIndex = {
  schemaVersion: 1
  generatedAt: string
  lines: string[]
  modules: CatalogModule[]
}

export type CatalogFetchResult =
  | { status: 'ok'; url: string; index: PickerIndex }
  | { status: 'unavailable'; url: string; reason: string }

export type CatalogSelectionFile = {
  schemaVersion: 1
  catalog: string
  catalogGeneratedAt: string
  line: string
  modules: {
    id: string
    from: string
    locator: string
    source: CatalogSource
    license: CatalogLicense
    tier: 'listed' | 'verified' | null
    install: string
    reason: 'requested' | 'required'
  }[]
  commands: string[]
}
