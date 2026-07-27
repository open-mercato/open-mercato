import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry } from '../module-registry'
import { detectBackendRouteCollisions } from '../route-collisions'

let tmpDir: string

const PAGE_CONTENT = `export default function Page() { return null }
`

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'route-collisions-test-'))
}

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function scaffoldBackendPage(tmpDir: string, modId: string, location: 'pkg' | 'app', pageSubPath: string): void {
  const base =
    location === 'pkg'
      ? path.join(tmpDir, 'packages', 'core', 'src', 'modules', modId)
      : path.join(tmpDir, 'app', 'src', 'modules', modId)
  touchFile(path.join(base, 'backend', pageSubPath), PAGE_CONTENT)
}

function createMockResolver(tmpDir: string, enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(tmpDir, 'output', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })

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

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('detectBackendRouteCollisions', () => {
  it('errors when two package modules register the same backend path, naming both and the path', () => {
    const result = detectBackendRouteCollisions([
      { routePath: '/backend/tasks', moduleId: 'workflows', packageSourced: true },
      { routePath: '/backend/tasks', moduleId: 'agent_orchestrator', packageSourced: true },
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('/backend/tasks')
    expect(result.errors[0]).toContain('"workflows"')
    expect(result.errors[0]).toContain('"agent_orchestrator"')
    expect(result.notes).toHaveLength(0)
  })

  it('emits an informational note (no error) when an app module shadows a package module path', () => {
    const result = detectBackendRouteCollisions([
      { routePath: '/backend/orders', moduleId: 'sales', packageSourced: true },
      { routePath: '/backend/orders', moduleId: 'my_overrides', packageSourced: false },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]).toContain('/backend/orders')
    expect(result.notes[0]).toContain('"sales"')
    expect(result.notes[0]).toContain('"my_overrides"')
  })

  it('ignores duplicate registrations from a single module (app override of its own package page)', () => {
    const result = detectBackendRouteCollisions([
      { routePath: '/backend/orders', moduleId: 'sales', packageSourced: true },
      { routePath: '/backend/orders', moduleId: 'sales', packageSourced: false },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.notes).toHaveLength(0)
  })

  it('stays silent when there is no collision', () => {
    const result = detectBackendRouteCollisions([
      { routePath: '/backend/tasks', moduleId: 'workflows', packageSourced: true },
      { routePath: '/backend/agentic-tasks', moduleId: 'agent_orchestrator', packageSourced: true },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.notes).toHaveLength(0)
  })
})

describe('generateModuleRegistry backend route collision guard', () => {
  it('fails generation when two package modules register the same backend path', async () => {
    scaffoldBackendPage(tmpDir, 'workflows_like', 'pkg', 'tasks/page.tsx')
    scaffoldBackendPage(tmpDir, 'launcher_like', 'pkg', 'tasks/page.tsx')
    const resolver = createMockResolver(tmpDir, [
      { id: 'workflows_like', from: '@open-mercato/core' },
      { id: 'launcher_like', from: '@open-mercato/core' },
    ])

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(generateModuleRegistry({ resolver, quiet: true })).rejects.toThrow(
        /Backend route collision/,
      )
      const printed = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(printed).toContain('/backend/tasks')
      expect(printed).toContain('"workflows_like"')
      expect(printed).toContain('"launcher_like"')
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('allows an app module to shadow a package module page', async () => {
    scaffoldBackendPage(tmpDir, 'workflows_like', 'pkg', 'tasks/page.tsx')
    scaffoldBackendPage(tmpDir, 'app_overrides', 'app', 'tasks/page.tsx')
    const resolver = createMockResolver(tmpDir, [
      { id: 'workflows_like', from: '@open-mercato/core' },
      { id: 'app_overrides', from: '@app' },
    ])

    await expect(generateModuleRegistry({ resolver, quiet: true })).resolves.toBeDefined()
  })

  it('passes when package modules register distinct backend paths', async () => {
    scaffoldBackendPage(tmpDir, 'workflows_like', 'pkg', 'tasks/page.tsx')
    scaffoldBackendPage(tmpDir, 'launcher_like', 'pkg', 'agentic-tasks/page.tsx')
    const resolver = createMockResolver(tmpDir, [
      { id: 'workflows_like', from: '@open-mercato/core' },
      { id: 'launcher_like', from: '@open-mercato/core' },
    ])

    await expect(generateModuleRegistry({ resolver, quiet: true })).resolves.toBeDefined()
  })
})
