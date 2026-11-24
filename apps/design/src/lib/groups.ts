export const DOC_GROUPS = ['introduction', 'foundations', 'components', 'blocks'] as const
export type DocGroup = (typeof DOC_GROUPS)[number]

export const ENTRY_GROUPS = ['foundations', 'components', 'blocks'] as const
export type EntryGroup = (typeof ENTRY_GROUPS)[number]

const FOUNDATION_FAMILIES = new Set(['foundations', 'icons', 'library'])
const BLOCK_FAMILIES = new Set(['blocks'])

export function groupForFamily(familyId: string): EntryGroup {
  if (BLOCK_FAMILIES.has(familyId)) return 'blocks'
  if (FOUNDATION_FAMILIES.has(familyId)) return 'foundations'
  return 'components'
}

export function isEntryGroup(value: string): value is EntryGroup {
  return (ENTRY_GROUPS as readonly string[]).includes(value)
}
