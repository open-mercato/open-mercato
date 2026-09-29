import { galleryFamilies } from '../registry'

/**
 * A snippet is only useful when a developer can paste it into their own module. Families listed
 * here have been migrated to self-contained snippets and must stay that way: no gallery
 * translation keys, no gallery helpers or assets, and short enough to read at a glance.
 * Add a family here once its snippets are migrated; the list must only grow.
 */
const COPYABLE_FAMILIES = ['inputs']

/** Pattern demos compose many primitives; they are labelled as patterns, not importable components. */
const PATTERN_ENTRIES = new Set(['marketing-controls'])

const MAX_SNIPPET_LINES = 60

describe('design_system gallery copy-paste snippets', () => {
  it.each(COPYABLE_FAMILIES)('%s snippets are self-contained', async (familyId) => {
    const family = galleryFamilies.find((candidate) => candidate.id === familyId)
    expect(family).toBeDefined()
    const { entries } = await family!.load()
    const problems: string[] = []
    for (const entry of entries) {
      if (PATTERN_ENTRIES.has(entry.id)) continue
      for (const variant of entry.variants) {
        const where = `${entry.id}/${variant.id}`
        if (/design_system\.[a-zA-Z]/.test(variant.code)) problems.push(`${where}: uses a gallery translation key`)
        if (/design_system\/gallery\//.test(variant.code)) problems.push(`${where}: imports a gallery helper or asset`)
        const lines = variant.code.split('\n').length
        if (lines > MAX_SNIPPET_LINES) problems.push(`${where}: ${lines} lines (max ${MAX_SNIPPET_LINES})`)
      }
    }
    expect(problems).toEqual([])
  })
})
