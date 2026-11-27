import { ENTRY_GROUPS, type EntryGroup } from './groups'
import { entryHref, publicSourceUrl } from './links'
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
      const blockDetails = group === 'blocks'
        ? `, contract [${entry.id}.json](${base}/r/${entry.id}.json), copy with \`yarn mercato ui add ${entry.id} --module <moduleId>\``
        : ''
      const sourceDetails = group === 'screens' && entry.sourceFile
        ? `source [${entry.sourceFile.split('/').pop()}](${base}${publicSourceUrl(entry.sourceFile)})`
        : `\`${entry.importPath}\`${blockDetails}`
      lines.push(`- [${entry.title}](${base}${entryHref(group, entry.id)}): ${sourceDetails}`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
