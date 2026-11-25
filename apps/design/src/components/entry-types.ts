import type { EntryGroup } from '@/lib/groups'
import type { PropRow } from '@/lib/props-table'

export type EntryViewData = {
  id: string
  title: string
  group: EntryGroup
  importPath: string
  description?: string
  usage: { do: string[]; dont: string[] }
  since?: string
  accessibility: string[]
  faq: Array<{ question: string; answer: string }>
  tokens: string[]
  variants: Array<{ id: string; title: string; code: string; description?: string }>
  contract: { file: string; rows: PropRow[] } | null
  sources: { component?: string; contract?: string; gallery: string }
}
