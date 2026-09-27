import fs from 'node:fs'
import path from 'node:path'

const marketplaceSource = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'integrations', 'page.tsx'),
  'utf8',
)
const bundleSource = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'integrations', 'bundle', '[id]', 'page.tsx'),
  'utf8',
)

function integrationSwitches(source: string): string[] {
  return [...source.matchAll(/<Switch[\s\S]*?\/>/g)]
    .map(([markup]) => markup)
    .filter((markup) => markup.includes('checked={item.isEnabled}'))
}

describe('integration toggle accessibility', () => {
  it('identifies every marketplace switch by integration title', () => {
    const switches = integrationSwitches(marketplaceSource)

    expect(switches).toHaveLength(2)
    switches.forEach((markup) => expect(markup).toContain('aria-label={item.title}'))
  })

  it('identifies every bundle switch by integration title', () => {
    const switches = integrationSwitches(bundleSource)

    expect(switches).toHaveLength(1)
    expect(switches[0]).toContain('aria-label={item.title}')
  })
})
