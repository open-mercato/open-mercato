import type { FormSchema } from './schema-helpers'

export type StudioSelection =
  | { kind: 'field'; key: string }
  | { kind: 'section'; key: string }
  | null

export type StudioTopTab = 'builder' | 'preview'

export type PaletteEntry = {
  id: string
  category: 'input' | 'layout'
  iconName: string
  displayNameKey: string
  fieldTypeKey?: string
}

export type StudioSnapshot = {
  schema: FormSchema
  selection: StudioSelection
}

// Decision 6c — grid-aware drop target: sortable kind keeps the legacy
// before/after midpoint hint; grid kinds carry section + row + column
// coords so the canvas can pick the right indicator without re-parsing.
export type ActiveDropTarget =
  | null
  | { kind: 'sortable'; id: string; position: 'before' | 'after' }
  | { kind: 'cell'; sectionKey: string; rowIndex: number; columnIndex: number; dropId: string }
  | { kind: 'col-gap'; sectionKey: string; rowIndex: number; columnIndex: number; dropId: string }
  | { kind: 'row-gap'; sectionKey: string; rowIndex: number; dropId: string }
