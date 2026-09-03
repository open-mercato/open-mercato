import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MODULE_ROOT = join(__dirname, '..', '..')

const ALLOWED_DIRECT_IMPORTERS = new Set([
  join('lib', 'llm-bootstrap.ts'),
  join('lib', 'llm-registry.ts'),
])

const VALUE_IMPORT_PATTERN =
  /import\s+\{[^}]*\bllmProviderRegistry\b[^}]*\}\s+from\s+'@open-mercato\/shared\/lib\/ai\/llm-provider-registry'/

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    if (statSync(absolute).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      collectSourceFiles(absolute, found)
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(absolute)
  }
  return found
}

describe('llmProviderRegistry import discipline', () => {
  it('routes every registry consumer through the bootstrapped lib/llm-registry accessor', () => {
    const offenders = collectSourceFiles(MODULE_ROOT)
      .filter((absolute) => VALUE_IMPORT_PATTERN.test(readFileSync(absolute, 'utf8')))
      .map((absolute) => relative(MODULE_ROOT, absolute))
      .filter((relativePath) => !ALLOWED_DIRECT_IMPORTERS.has(relativePath))
      .map(
        (relativePath) =>
          `${relativePath.split(sep).join('/')} imports llmProviderRegistry from ` +
          '@open-mercato/shared/lib/ai/llm-provider-registry; import it from lib/llm-registry ' +
          'instead so ./llm-bootstrap runs before the registry is read',
      )

    expect(offenders).toEqual([])
  })
})
