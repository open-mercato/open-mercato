import fs from 'node:fs'
import path from 'node:path'

const PACKAGES_ROOT = path.resolve(__dirname, '..', '..', '..')
const CONVENTION_FILE = 'insights.explain.ts'

const EXPECTED_CONTRIBUTORS = [
  'ai-assistant/src/modules/ai_assistant',
  'core/src/modules/api_keys',
  'core/src/modules/auth',
  'core/src/modules/business_rules',
  'core/src/modules/customer_groups',
  'core/src/modules/customers',
  'core/src/modules/data_sync',
  'core/src/modules/dictionaries',
  'core/src/modules/sales',
  'core/src/modules/workflows',
  'scheduler/src/modules/scheduler',
]

function listConventionFiles(): string[] {
  const files: string[] = []
  for (const packageName of fs.readdirSync(PACKAGES_ROOT)) {
    const modulesRoot = path.join(PACKAGES_ROOT, packageName, 'src', 'modules')
    if (!fs.existsSync(modulesRoot)) continue
    for (const moduleName of fs.readdirSync(modulesRoot)) {
      if (moduleName === 'insights') continue
      const candidate = path.join(modulesRoot, moduleName, CONVENTION_FILE)
      if (fs.existsSync(candidate)) files.push(candidate)
    }
  }
  return files
}

function readImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

describe('insights.explain.ts decoupling', () => {
  const files = listConventionFiles()

  it('finds every module contribution declared for the MVP', () => {
    const contributors = files.map((file) => path.relative(PACKAGES_ROOT, path.dirname(file)).split(path.sep).join('/'))
    for (const expected of EXPECTED_CONTRIBUTORS) expect(contributors).toContain(expected)
  })

  it.each(listConventionFiles().map((file) => [path.relative(PACKAGES_ROOT, file), file]))(
    '%s never imports the insights module runtime',
    (_label, file) => {
      const specifiers = readImportSpecifiers(fs.readFileSync(file, 'utf8'))
      expect(specifiers.length).toBeGreaterThan(0)
      const insightsImports = specifiers.filter((specifier) => /(^|\/)modules\/insights(\/|$)|(^|\.\/|\.\.\/)insights(\/|$)/.test(specifier))
      for (const specifier of insightsImports) {
        expect(specifier.startsWith('@open-mercato/shared/modules/insights/')).toBe(true)
      }
      expect(specifiers.some((specifier) => specifier.startsWith('@open-mercato/core/modules/insights'))).toBe(false)
    },
  )
})
