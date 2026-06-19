import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const integrationRoot = join(__dirname, '..')

const legacyAliasPattern =
  /from\s+['"]@open-mercato\/core\/modules\/core\/__integration__\/helpers\//
const legacyRelativePattern = /from\s+['"](?:\.{1,2}\/)+helpers\/(?!integration\/)/

function collectSpecFiles(dir: string): string[] {
  const collected: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      collected.push(...collectSpecFiles(fullPath))
    } else if (entry.endsWith('.spec.ts')) {
      collected.push(fullPath)
    }
  }
  return collected
}

describe('core integration specs use the public helper import path', () => {
  const specFiles = collectSpecFiles(integrationRoot)

  it('discovers core integration specs (guards against a broken scan)', () => {
    expect(specFiles.length).toBeGreaterThan(0)
  })

  it.each(specFiles.map((filePath) => [relative(integrationRoot, filePath), filePath]))(
    '%s imports helpers from @open-mercato/core/helpers/integration/* only',
    (_label, filePath) => {
      const source = readFileSync(filePath, 'utf8')
      expect(source).not.toMatch(legacyAliasPattern)
      expect(source).not.toMatch(legacyRelativePattern)
    },
  )
})
