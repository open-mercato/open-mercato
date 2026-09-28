import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('API Explorer search accessibility', () => {
  it('gives the endpoint search field an accessible name', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'frontend', 'docs', 'api', 'Explorer.tsx'),
      'utf8',
    )

    expect(source).toMatch(
      /<Input[\s\S]*?type="search"[\s\S]*?aria-label="Search endpoints by path or summary"[\s\S]*?\/>/,
    )
  })
})
