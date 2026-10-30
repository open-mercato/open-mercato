import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The lead-routing nav entry must require everything its own API does.
 *
 * `api/lead-routing/route.ts`'s GET needs `customers.people.view` on top of
 * `marketing_automation.runs.view` — the list it answers includes decrypted customer names. The page's
 * `requireFeatures` used to list only the first feature, so a role holding `runs.view` alone saw "Lead
 * routing" in the nav, opened it, and watched every row fail to load. Mirrors the same check the existing
 * `customers/[id]` page already passes.
 */
const PAGE_META = readFileSync(
  join(__dirname, '..', 'marketing', 'lead-routing', 'page.meta.ts'),
  'utf8',
)
const API_ROUTE = readFileSync(
  join(__dirname, '..', '..', 'api', 'lead-routing', 'route.ts'),
  'utf8',
)

function requireFeaturesOf(source: string): string[] {
  const match = source.match(/requireFeatures:\s*\[([^\]]*)\]/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

describe('the lead-routing nav entry mirrors its API gate', () => {
  it('requires every feature the GET route requires', () => {
    const apiFeatures = requireFeaturesOf(API_ROUTE.slice(0, API_ROUTE.indexOf('GET:') + 200))
    const pageFeatures = requireFeaturesOf(PAGE_META)
    expect(apiFeatures.length).toBeGreaterThan(0)
    for (const feature of apiFeatures) {
      expect(pageFeatures).toContain(feature)
    }
  })
})
