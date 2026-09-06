import fs from 'node:fs'
import path from 'node:path'

function findRepoRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(dir, 'apps', 'mercato', 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate the repository root from the test directory')
}

const repoRoot = findRepoRoot()
const PACKAGE_NAME = '@open-mercato/manufacturing'

const APP_MANIFEST = path.join(repoRoot, 'apps', 'mercato', 'package.json')
const APP_MODULES = path.join(repoRoot, 'apps', 'mercato', 'src', 'modules.ts')
const TEMPLATE_MANIFEST = path.join(
  repoRoot,
  'packages',
  'create-app',
  'template',
  'package.json.template',
)
const TEMPLATE_MODULES = path.join(
  repoRoot,
  'packages',
  'create-app',
  'template',
  'src',
  'modules.ts',
)

function readDependencies(manifestPath: string): Record<string, string> {
  const raw = fs.readFileSync(manifestPath, 'utf8').replace(/\{\{[A-Z_]+\}\}/g, '0.0.0')
  const manifest = JSON.parse(raw) as { dependencies?: Record<string, string> }
  return manifest.dependencies ?? {}
}

describe('manufacturing package installation parity', () => {
  it('is a dependency of the standard app', () => {
    expect(readDependencies(APP_MANIFEST)).toHaveProperty(PACKAGE_NAME)
  })

  it('is a dependency of the create-app template', () => {
    expect(readDependencies(TEMPLATE_MANIFEST)).toHaveProperty(PACKAGE_NAME)
  })

  it('is pinned to the released version placeholder in the template', () => {
    const raw = fs.readFileSync(TEMPLATE_MANIFEST, 'utf8')
    expect(raw).toContain(`"${PACKAGE_NAME}": "{{PACKAGE_VERSION}}"`)
  })
})

describe('manufacturing activation contract', () => {
  it('is absent from the create-app template enabled-module registry', () => {
    expect(fs.readFileSync(TEMPLATE_MODULES, 'utf8')).not.toContain(PACKAGE_NAME)
  })

  it('never activates a retired manufacturing module id', () => {
    for (const modulesFile of [APP_MODULES, TEMPLATE_MODULES]) {
      const source = fs.readFileSync(modulesFile, 'utf8')
      expect(source).not.toContain("id: 'manufacturing_base'")
      expect(source).not.toContain("id: 'manufacturing_discrete'")
    }
  })
})
