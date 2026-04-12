/**
 * Static regression test for issue #601: disabling the example module must not
 * break the app build.
 *
 * Verifies that example and example_customers_sync source files do not import
 * from generated artifacts that disappear when the module is disabled
 * (e.g. E.example.*, @/.mercato/generated/entities/todo).
 */
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const APP_DIR = path.join(REPO_ROOT, 'apps', 'mercato')
const EXAMPLE_MODULE_DIR = path.join(APP_DIR, 'src', 'modules', 'example')
const EXAMPLE_SYNC_MODULE_DIR = path.join(APP_DIR, 'src', 'modules', 'example_customers_sync')

function collectTsFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__integration__' || entry.name === 'migrations') continue
        walk(fullPath)
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        results.push(fullPath)
      }
    }
  }

  walk(dir)
  return results
}

// Patterns that break when example is removed from enabledModules:
// 1. Import from per-entity generated field selectors (e.g. @/.mercato/generated/entities/todo)
//    Note: @/.mercato/generated/entities/organization is OK (always-enabled module)
const EXAMPLE_ENTITY_IMPORT = /from\s+['"]@\/\.mercato\/generated\/entities\/(todo|example_customer_priority)['"]/
// 2. Usage of E.example.* registry members
const E_EXAMPLE_USAGE = /E\.example\./
// 3. Relative import of generated entity IDs (used by example_customers_sync)
const RELATIVE_GENERATED_IDS_IMPORT = /from\s+['"][\./]*\.mercato\/generated\/entities\.ids\.generated['"]/

describe('Disabled example module: no generated-entity imports (#601)', () => {
  const exampleFiles = collectTsFiles(EXAMPLE_MODULE_DIR)
  const syncFiles = collectTsFiles(EXAMPLE_SYNC_MODULE_DIR)
  const allFiles = [...exampleFiles, ...syncFiles]

  if (allFiles.length === 0) {
    it('skips when example module directories do not exist', () => {
      expect(true).toBe(true)
    })
  }

  for (const filePath of allFiles) {
    const relPath = path.relative(APP_DIR, filePath)

    it(`${relPath} does not import generated example entity selectors`, () => {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(EXAMPLE_ENTITY_IMPORT)
    })

    it(`${relPath} does not use E.example.* registry members`, () => {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(E_EXAMPLE_USAGE)
    })

    it(`${relPath} does not import entities.ids.generated via relative path`, () => {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(RELATIVE_GENERATED_IDS_IMPORT)
    })
  }
})
