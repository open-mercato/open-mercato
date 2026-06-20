import { z } from 'zod'

export const dictionaryEntrySortModes = [
  'label_asc',
  'label_desc',
  'value_asc',
  'value_desc',
  'created_at_asc',
  'created_at_desc',
] as const

export const dictionaryEntrySortModeSchema = z.enum(dictionaryEntrySortModes)

export type DictionaryEntrySortMode = z.infer<typeof dictionaryEntrySortModeSchema>

export const DEFAULT_DICTIONARY_ENTRY_SORT_MODE: DictionaryEntrySortMode = 'label_asc'

export type DictionaryEntrySortItem = {
  id?: string | null
  value?: string | null
  label?: string | null
  createdAt?: Date | string | number | null
}

export function resolveDictionaryEntrySortMode(value: unknown): DictionaryEntrySortMode {
  const parsed = dictionaryEntrySortModeSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_DICTIONARY_ENTRY_SORT_MODE
}

function compareText(left: unknown, right: unknown): number {
  const leftText = typeof left === 'string' ? left : ''
  const rightText = typeof right === 'string' ? right : ''
  return leftText.localeCompare(rightText, undefined, { sensitivity: 'base' })
}

function timestamp(value: DictionaryEntrySortItem['createdAt']): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function compareByMode(left: DictionaryEntrySortItem, right: DictionaryEntrySortItem, mode: DictionaryEntrySortMode): number {
  switch (mode) {
    case 'label_desc':
      return compareText(right.label ?? right.value, left.label ?? left.value)
    case 'value_asc':
      return compareText(left.value, right.value)
    case 'value_desc':
      return compareText(right.value, left.value)
    case 'created_at_asc':
      return timestamp(left.createdAt) - timestamp(right.createdAt)
    case 'created_at_desc':
      return timestamp(right.createdAt) - timestamp(left.createdAt)
    case 'label_asc':
    default:
      return compareText(left.label ?? left.value, right.label ?? right.value)
  }
}

export function sortDictionaryEntries<T extends DictionaryEntrySortItem>(
  entries: T[],
  mode: DictionaryEntrySortMode = DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
): T[] {
  return entries.slice().sort((left, right) => {
    const primary = compareByMode(left, right, mode)
    if (primary !== 0) return primary
    return compareText(left.id, right.id)
  })
}
