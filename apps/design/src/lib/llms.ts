import { ENTRY_GROUPS, type EntryGroup } from './groups'
import { entryHref } from './links'
import type { ManifestEntry } from './manifest-types'

export type LlmsTxtCopy = {
  title: string
  summary: string
  groupLabels: Record<EntryGroup, string>
}

export function buildLlmsTxt(entries: readonly ManifestEntry[], copy: LlmsTxtCopy, siteUrl = ''): string {
  const base = siteUrl.replace(/\/+$/, '')
  const lines: string[] = [`# ${copy.title}`, '', `> ${copy.summary}`, '', `[registry.json](${base}/r/index.json)`, '']
  for (const group of ENTRY_GROUPS) {
    const groupEntries = entries
      .filter((entry) => entry.group === group)
      .slice()
      .sort((left, right) => left.title.localeCompare(right.title))
    if (groupEntries.length === 0) continue
    lines.push(`## ${copy.groupLabels[group]}`, '')
    for (const entry of groupEntries) {
      lines.push(`- [${entry.title}](${base}${entryHref(group, entry.id)}): \`${entry.importPath}\``)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
