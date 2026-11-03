/**
 * Layout palette catalog.
 *
 * Layout palette entries are studio-only — they don't register as field
 * types and never appear in `properties`. The catalog is a sibling to
 * `FieldTypeRegistry` so the compiler can keep rejecting unknown
 * `x-om-type` values on real fields while the studio enumerates the
 * `Page` and `Section/Group` palette cards from a single source.
 *
 * Decision 1 (`.ai/specs/2026-05-10-forms-visual-builder.md`): "Grid" is
 * not a separate primitive. Multi-column layouts are a section with
 * `columns >= 2`.
 *
 * Pack-registered layout entries (Decisions 16a/16b) take a different
 * shape: they go through `FieldTypeRegistry.register({ category: 'layout' })`
 * and persist as fields in `properties` — the registry asserts the
 * display-only contract (`validator(undefined) === true`,
 * `exportAdapter(undefined) === ''`) at register time. This catalog stays
 * limited to `kind: 'page' | 'section'` boundary entries.
 */

import type { OmSectionKind } from './jsonschema-extensions'

export type LayoutCatalogEntry = {
  id: string
  kind: OmSectionKind
  icon: string
  displayNameKey: string
}

const PAGE_ENTRY: LayoutCatalogEntry = {
  id: 'page',
  kind: 'page',
  icon: 'file-text',
  displayNameKey: 'forms.studio.palette.layout.page',
}

const SECTION_ENTRY: LayoutCatalogEntry = {
  id: 'section',
  kind: 'section',
  icon: 'rows',
  displayNameKey: 'forms.studio.palette.layout.section',
}

const ENDING_ENTRY: LayoutCatalogEntry = {
  id: 'ending',
  kind: 'ending',
  icon: 'flag',
  displayNameKey: 'forms.studio.palette.layout.ending',
}

export const layoutCatalogEntries: ReadonlyArray<LayoutCatalogEntry> = [
  PAGE_ENTRY,
  SECTION_ENTRY,
  ENDING_ENTRY,
]

const ENTRIES_BY_ID = new Map<string, LayoutCatalogEntry>(
  layoutCatalogEntries.map((entry) => [entry.id, entry]),
)

export function getLayoutCatalogEntry(id: string): LayoutCatalogEntry | undefined {
  return ENTRIES_BY_ID.get(id)
}

export function listLayoutCatalogEntries(): ReadonlyArray<LayoutCatalogEntry> {
  return layoutCatalogEntries
}
