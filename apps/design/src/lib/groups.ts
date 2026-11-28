export const DOC_GROUPS = ['introduction', 'foundations', 'components', 'blocks', 'screens'] as const
export type DocGroup = (typeof DOC_GROUPS)[number]

export const ENTRY_GROUPS = ['foundations', 'components', 'blocks', 'screens'] as const
export type EntryGroup = (typeof ENTRY_GROUPS)[number]

const FOUNDATION_FAMILIES = new Set(['foundations', 'icons', 'library'])
const BLOCK_FAMILIES = new Set(['blocks'])
const SCREEN_FAMILIES = new Set(['screens'])

export const GROUP_LABEL_FALLBACKS: Record<EntryGroup, string> = {
  foundations: 'Foundations',
  components: 'Components',
  blocks: 'Blocks',
  screens: 'Screens',
}

export function groupForFamily(familyId: string): EntryGroup {
  if (BLOCK_FAMILIES.has(familyId)) return 'blocks'
  if (SCREEN_FAMILIES.has(familyId)) return 'screens'
  if (FOUNDATION_FAMILIES.has(familyId)) return 'foundations'
  return 'components'
}

export function isEntryGroup(value: string): value is EntryGroup {
  return (ENTRY_GROUPS as readonly string[]).includes(value)
}
