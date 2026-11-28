import fs from 'node:fs'
import path from 'node:path'
import manifest from '../../../generated/registry-manifest.json'
import { USAGE_PAIRS, hasUsageVisuals, usagePairsFor, usageVisualEntryIds, visibleUsageRules } from '../registry'
import { duplicatePairIds, unresolvedCovers } from '../registry-helpers'
import type { Copy, UsageRules } from '../types'

type ManifestEntry = { id: string; usage?: Partial<UsageRules> }

const entries = (manifest as { entries: ManifestEntry[] }).entries
const usageById = new Map(entries.map((entry) => [entry.id, { do: entry.usage?.do ?? [], dont: entry.usage?.dont ?? [] }]))
const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../i18n/en.json'), 'utf8')) as Record<string, string>
const coveredEntryIds = usageVisualEntryIds()
const MAX_CAPTION_LENGTH = 34
const MAX_PAIRS_PER_ENTRY = 3

function copiesOf(entryId: string): Copy[] {
  return usagePairsFor(entryId).flatMap((pair) => [pair.title, pair.do.caption, pair.avoid.caption])
}

describe('usage visual registry', () => {
  it('covers entries from every group', () => {
    expect(coveredEntryIds).toEqual(expect.arrayContaining(['spacing', 'button', 'entity-header']))
  })

  it('derives hasUsageVisuals from the registry', () => {
    for (const entryId of Object.keys(USAGE_PAIRS)) expect(hasUsageVisuals(entryId)).toBe(USAGE_PAIRS[entryId].length > 0)
    expect(hasUsageVisuals('no-such-entry')).toBe(false)
  })

  it.each(coveredEntryIds)('%s exists in the registry manifest', (entryId) => {
    expect(usageById.has(entryId)).toBe(true)
  })

  it.each(coveredEntryIds)('%s has one to three pairs with unique ids', (entryId) => {
    const pairs = usagePairsFor(entryId)
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs.length).toBeLessThanOrEqual(MAX_PAIRS_PER_ENTRY)
    expect(duplicatePairIds(pairs)).toEqual([])
  })

  it.each(coveredEntryIds)('%s covers only rules that exist in its manifest usage', (entryId) => {
    const usage = usageById.get(entryId) ?? { do: [], dont: [] }
    expect(unresolvedCovers(usagePairsFor(entryId), usage)).toEqual([])
  })

  it.each(coveredEntryIds)('%s keeps its copy in the dictionary and its captions short', (entryId) => {
    for (const item of copiesOf(entryId)) expect(dictionary[item.key]).toBe(item.fallback)
    for (const pair of usagePairsFor(entryId)) {
      expect(pair.do.caption.fallback.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH)
      expect(pair.avoid.caption.fallback.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH)
    }
  })

  it('hides covered rules from the text lists and keeps the others', () => {
    const usage = usageById.get('button') ?? { do: [], dont: [] }
    const visible = visibleUsageRules('button', usage)
    expect(visible.do).not.toContain('One default (primary) Button per view; remaining actions step down to outline, ghost or muted.')
    expect(visible.do.length).toBe(usage.do.length - 1)
    expect(visible.dont).toEqual(usage.dont)
  })

  it('returns the rules unchanged for an entry without visuals', () => {
    const usage = { do: ['Rule one'], dont: ['Rule two'] }
    expect(visibleUsageRules('no-such-entry', usage)).toEqual(usage)
  })
})
