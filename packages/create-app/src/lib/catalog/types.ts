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
  install: string
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
