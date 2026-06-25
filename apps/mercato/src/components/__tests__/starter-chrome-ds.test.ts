import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')

const componentPairs = [
  [
    'app',
    path.join(repoRoot, 'apps/mercato/src/components'),
  ],
  [
    'template',
    path.join(repoRoot, 'packages/create-app/template/src/components'),
  ],
] as const

const forbiddenStarterStatusColor =
  /\b(?:(?:hover:|dark:hover:)?(?:bg|border|text)|(?:dark:)?marker:text|dark:(?:bg|border|text))-(?:amber|blue|emerald|slate)-\d+(?:\/\d+)?/g

describe('starter chrome design-system coverage', () => {
  it.each(componentPairs)('%s StartPageContent and GlobalNoticeBars use semantic status tokens', (_label, componentsDir) => {
    for (const fileName of ['StartPageContent.tsx', 'GlobalNoticeBars.tsx']) {
      const filePath = path.join(componentsDir, fileName)
      const source = fs.readFileSync(filePath, 'utf8')

      expect(source.match(forbiddenStarterStatusColor) ?? []).toEqual([])
    }
  })

  it.each(componentPairs)('%s OrganizationSwitcher uses button primitives instead of raw buttons', (_label, componentsDir) => {
    const source = fs.readFileSync(path.join(componentsDir, 'OrganizationSwitcher.tsx'), 'utf8')

    expect(source).not.toMatch(/<button\b/)
  })
})
