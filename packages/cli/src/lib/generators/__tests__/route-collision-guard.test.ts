// Tests for the backend route-collision guard in `mercato generate`
// (`assertUniqueBackendRoutePattern`): two modules emitting the same backend URL
// must fail generation, while distinct patterns must keep generating unchanged.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryApp } from '../module-registry'

let tmpDir: string
let outputDir: string

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function pkgModulePath(modId: string, ...segments: string[]): string {
  return path.join(tmpDir, 'packages', 'core', 'src', 'modules', modId, ...segments)
}

function createMockResolver(enabled: ModuleEntry[]): PackageResolver {
  return {
    isMonorepo: () => true,
    getRootDir: () => tmpDir,
    getAppDir: () => path.join(tmpDir, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(tmpDir, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'packages', 'core'),
  }
}

// Minimal core module: index metadata + a single backend page at the given sub-path.
function makeCoreModule(modId: string, backendPageSegments: string[]): ModuleEntry {
  touchFile(pkgModulePath(modId, 'index.ts'), `export const metadata = { id: '${modId}', label: '${modId}' }\n`)
  touchFile(
    pkgModulePath(modId, 'backend', ...backendPageSegments, 'page.tsx'),
    `export default function ${modId}Page() { return null }\n`,
  )
  return { id: modId, from: '@open-mercato/core' }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-collision-'))
  outputDir = path.join(tmpDir, 'app', '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('backend route-collision guard', () => {
  it('throws when two modules generate the same backend pattern (string/registry path)', async () => {
    // Both leave the detail page un-namespaced → both resolve to `/backend/[id]`.
    const enabled = [
      makeCoreModule('alpha', ['[id]']),
      makeCoreModule('beta', ['[id]']),
    ]
    const resolver = createMockResolver(enabled)

    await expect(generateModuleRegistry({ resolver, quiet: true })).rejects.toThrow(
      /Duplicate backend route pattern "\/backend\/\[id\]"/,
    )
  })

  it('throws for the same collision in the app (AST) generator', async () => {
    const enabled = [
      makeCoreModule('alpha', ['[id]']),
      makeCoreModule('beta', ['[id]']),
    ]
    const resolver = createMockResolver(enabled)

    await expect(generateModuleRegistryApp({ resolver, quiet: true })).rejects.toThrow(
      /Duplicate backend route pattern/,
    )
  })

  it('names both colliding modules in the error', async () => {
    const enabled = [
      makeCoreModule('alpha', ['[id]']),
      makeCoreModule('beta', ['[id]']),
    ]
    const resolver = createMockResolver(enabled)

    await expect(generateModuleRegistry({ resolver, quiet: true })).rejects.toThrow(/alpha/)
    const resolver2 = createMockResolver(enabled)
    await expect(generateModuleRegistry({ resolver: resolver2, quiet: true })).rejects.toThrow(/beta/)
  })

  it('does not throw when backend pages are namespaced under their module folder', async () => {
    // Distinct patterns: `/backend/alpha/[id]` and `/backend/beta/[id]`.
    const enabled = [
      makeCoreModule('alpha', ['alpha', '[id]']),
      makeCoreModule('beta', ['beta', '[id]']),
    ]
    const resolver = createMockResolver(enabled)

    await expect(generateModuleRegistry({ resolver, quiet: true })).resolves.toBeDefined()

    const generated = fs.readFileSync(path.join(outputDir, 'backend-routes.generated.ts'), 'utf8')
    expect(generated).toContain('/backend/alpha/[id]')
    expect(generated).toContain('/backend/beta/[id]')
  })

  it('does not throw for a single module owning a pattern (no false positive)', async () => {
    const enabled = [makeCoreModule('alpha', ['[id]'])]
    const resolver = createMockResolver(enabled)

    await expect(generateModuleRegistry({ resolver, quiet: true })).resolves.toBeDefined()
  })
})
