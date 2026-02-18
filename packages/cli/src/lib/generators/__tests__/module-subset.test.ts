import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryCli } from '../module-registry'

let tmpDir: string

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'module-subset-test-'))
}

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function scaffoldModule(
  tmpDir: string,
  modId: string,
  location: 'pkg' | 'app',
  files: string[]
): void {
  const base =
    location === 'pkg'
      ? path.join(tmpDir, 'packages', 'core', 'src', 'modules', modId)
      : path.join(tmpDir, 'app', 'src', 'modules', modId)
  for (const file of files) {
    touchFile(path.join(base, file))
  }
}

function createMockResolver(
  tmpDir: string,
  enabled: ModuleEntry[]
): PackageResolver {
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
      pkgBase: path.join(
        tmpDir,
        'packages',
        'core',
        'src',
        'modules',
        entry.id
      ),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'packages', 'core'),
  }
}

function readGenerated(tmpDir: string, filename: string): string | null {
  const filePath = path.join(tmpDir, 'output', 'generated', filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

beforeEach(() => {
  tmpDir = createTmpDir()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateModuleRegistry with module subsets', () => {
  it('generates valid output with zero modules enabled', async () => {
    const resolver = createMockResolver(tmpDir, [])
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')
    expect(output).not.toBeNull()
    expect(output).toContain('export const modules: Module[] = [')
    expect(output).toContain('export default modules')
  })

  it('generates valid output with a single module that has no files', async () => {
    const enabled: ModuleEntry[] = [
      { id: 'empty_mod', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')
    expect(output).toContain("id: 'empty_mod'")
  })

  it('handles module with only subscribers — no pages or APIs', async () => {
    scaffoldModule(tmpDir, 'notifications_only', 'pkg', [
      'subscribers/on-order.ts',
      'subscribers/on-payment.ts',
    ])
    const enabled: ModuleEntry[] = [
      { id: 'notifications_only', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(output).toContain("id: 'notifications_only'")
    expect(output).toContain('subscribers:')
    expect(output).not.toContain('frontendRoutes:')
    expect(output).not.toContain('backendRoutes:')
    expect(output).not.toContain('apis:')
  })

  it('handles module with only widgets — no pages or subscribers', async () => {
    scaffoldModule(tmpDir, 'widgets_only', 'pkg', [
      'widgets/dashboard/stats/widget.tsx',
      'widgets/injection/sidebar/widget.tsx',
    ])
    const enabled: ModuleEntry[] = [
      { id: 'widgets_only', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(output).toContain("id: 'widgets_only'")
    expect(output).toContain('dashboardWidgets:')
    expect(output).not.toContain('subscribers:')

    const widgetsOutput = readGenerated(tmpDir, 'dashboard-widgets.generated.ts')!
    expect(widgetsOutput).toContain('widgets_only')

    const injectionOutput = readGenerated(tmpDir, 'injection-widgets.generated.ts')!
    expect(injectionOutput).toContain('widgets_only')
  })

  it('handles module with only convention files — no walk-based scans', async () => {
    scaffoldModule(tmpDir, 'config_mod', 'pkg', [
      'acl.ts',
      'setup.ts',
      'ce.ts',
      'data/extensions.ts',
      'data/fields.ts',
    ])
    const enabled: ModuleEntry[] = [
      { id: 'config_mod', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(output).toContain("id: 'config_mod'")
    expect(output).toContain('features:')
    expect(output).toContain('entityExtensions:')
    expect(output).toContain('customFieldSets:')
    expect(output).toContain('setup:')
  })

  it('generates correct output when full module is later disabled', async () => {
    // First: generate with two modules
    scaffoldModule(tmpDir, 'mod_a', 'pkg', [
      'backend/page.tsx',
      'subscribers/on-created.ts',
      'acl.ts',
    ])
    scaffoldModule(tmpDir, 'mod_b', 'pkg', [
      'backend/page.tsx',
      'widgets/dashboard/chart/widget.tsx',
      'acl.ts',
    ])

    const allEnabled: ModuleEntry[] = [
      { id: 'mod_a', from: '@open-mercato/core' },
      { id: 'mod_b', from: '@open-mercato/core' },
    ]
    const resolverAll = createMockResolver(tmpDir, allEnabled)
    const resultAll = await generateModuleRegistry({ resolver: resolverAll, quiet: true })
    expect(resultAll.errors).toEqual([])

    const outputAll = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(outputAll).toContain("id: 'mod_a'")
    expect(outputAll).toContain("id: 'mod_b'")

    // Second: regenerate with mod_b disabled (only mod_a)
    const subsetEnabled: ModuleEntry[] = [
      { id: 'mod_a', from: '@open-mercato/core' },
    ]
    const resolverSubset = createMockResolver(tmpDir, subsetEnabled)
    const resultSubset = await generateModuleRegistry({
      resolver: resolverSubset,
      quiet: true,
    })
    expect(resultSubset.errors).toEqual([])

    const outputSubset = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(outputSubset).toContain("id: 'mod_a'")
    expect(outputSubset).not.toContain("id: 'mod_b'")

    // Widgets file should no longer reference mod_b
    const widgetsSubset = readGenerated(tmpDir, 'dashboard-widgets.generated.ts')!
    expect(widgetsSubset).not.toContain('mod_b')
  })

  it('handles @app module that only exists in app dir (no pkg counterpart)', async () => {
    scaffoldModule(tmpDir, 'custom_app', 'app', [
      'backend/page.tsx',
      'subscribers/my-handler.ts',
      'widgets/dashboard/my-widget/widget.tsx',
      'acl.ts',
    ])
    const enabled: ModuleEntry[] = [{ id: 'custom_app', from: '@app' }]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistry({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(output).toContain("id: 'custom_app'")
    expect(output).toContain('backendRoutes:')
    expect(output).toContain('subscribers:')
    expect(output).toContain('dashboardWidgets:')
    expect(output).toContain('features:')
  })

  it('mixed subset: core module + app module, then remove core module', async () => {
    scaffoldModule(tmpDir, 'core_mod', 'pkg', [
      'backend/page.tsx',
      'search.ts',
    ])
    scaffoldModule(tmpDir, 'app_mod', 'app', [
      'backend/page.tsx',
      'widgets/dashboard/info/widget.tsx',
    ])

    const both: ModuleEntry[] = [
      { id: 'core_mod', from: '@open-mercato/core' },
      { id: 'app_mod', from: '@app' },
    ]
    const resolverBoth = createMockResolver(tmpDir, both)
    const resultBoth = await generateModuleRegistry({ resolver: resolverBoth, quiet: true })
    expect(resultBoth.errors).toEqual([])

    const outputBoth = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(outputBoth).toContain("id: 'core_mod'")
    expect(outputBoth).toContain("id: 'app_mod'")

    const searchBoth = readGenerated(tmpDir, 'search.generated.ts')!
    expect(searchBoth).toContain('core_mod')

    // Now remove core_mod, only app_mod remains
    const appOnly: ModuleEntry[] = [{ id: 'app_mod', from: '@app' }]
    const resolverApp = createMockResolver(tmpDir, appOnly)
    const resultApp = await generateModuleRegistry({ resolver: resolverApp, quiet: true })
    expect(resultApp.errors).toEqual([])

    const outputApp = readGenerated(tmpDir, 'modules.generated.ts')!
    expect(outputApp).not.toContain("id: 'core_mod'")
    expect(outputApp).toContain("id: 'app_mod'")

    // Search should no longer reference core_mod
    const searchApp = readGenerated(tmpDir, 'search.generated.ts')!
    expect(searchApp).not.toContain('core_mod')
  })
})

describe('generateModuleRegistryCli with module subsets', () => {
  it('generates valid output with zero modules enabled', async () => {
    const resolver = createMockResolver(tmpDir, [])
    const result = await generateModuleRegistryCli({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.cli.generated.ts')
    expect(output).not.toBeNull()
    expect(output).toContain('export const modules: Module[] = [')
  })

  it('CLI output excludes pages and APIs even when module has them', async () => {
    scaffoldModule(tmpDir, 'full_mod', 'pkg', [
      'index.ts',
      'frontend/page.tsx',
      'backend/page.tsx',
      'api/route.ts',
      'subscribers/on-event.ts',
      'workers/process-job.ts',
      'widgets/dashboard/stats/widget.tsx',
      'acl.ts',
      'setup.ts',
    ])
    const enabled: ModuleEntry[] = [
      { id: 'full_mod', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    const result = await generateModuleRegistryCli({ resolver, quiet: true })

    expect(result.errors).toEqual([])
    const output = readGenerated(tmpDir, 'modules.cli.generated.ts')!
    expect(output).toContain("id: 'full_mod'")
    // CLI excludes these:
    expect(output).not.toContain('frontendRoutes:')
    expect(output).not.toContain('backendRoutes:')
    expect(output).not.toContain('apis:')
    // CLI includes these:
    expect(output).toContain('subscribers:')
    expect(output).toContain('features:')
    expect(output).toContain('setup:')
    expect(output).toContain('dashboardWidgets:')
  })

  it('handles disabling a module that was previously enabled', async () => {
    scaffoldModule(tmpDir, 'keep_mod', 'pkg', [
      'subscribers/handler.ts',
      'acl.ts',
    ])
    scaffoldModule(tmpDir, 'drop_mod', 'pkg', [
      'subscribers/handler.ts',
      'setup.ts',
    ])

    const all: ModuleEntry[] = [
      { id: 'keep_mod', from: '@open-mercato/core' },
      { id: 'drop_mod', from: '@open-mercato/core' },
    ]
    const resolverAll = createMockResolver(tmpDir, all)
    const resultAll = await generateModuleRegistryCli({ resolver: resolverAll, quiet: true })
    expect(resultAll.errors).toEqual([])
    const outputAll = readGenerated(tmpDir, 'modules.cli.generated.ts')!
    expect(outputAll).toContain("id: 'keep_mod'")
    expect(outputAll).toContain("id: 'drop_mod'")

    // Disable drop_mod
    const subset: ModuleEntry[] = [
      { id: 'keep_mod', from: '@open-mercato/core' },
    ]
    const resolverSubset = createMockResolver(tmpDir, subset)
    const resultSubset = await generateModuleRegistryCli({
      resolver: resolverSubset,
      quiet: true,
    })
    expect(resultSubset.errors).toEqual([])
    const outputSubset = readGenerated(tmpDir, 'modules.cli.generated.ts')!
    expect(outputSubset).toContain("id: 'keep_mod'")
    expect(outputSubset).not.toContain("id: 'drop_mod'")
  })
})

describe('all generated files are valid with varying subsets', () => {
  it('produces all 9 generated files even when no modules have matching content', async () => {
    scaffoldModule(tmpDir, 'bare_mod', 'pkg', ['acl.ts'])
    const enabled: ModuleEntry[] = [
      { id: 'bare_mod', from: '@open-mercato/core' },
    ]
    const resolver = createMockResolver(tmpDir, enabled)
    await generateModuleRegistry({ resolver, quiet: true })

    const expectedFiles = [
      'modules.generated.ts',
      'dashboard-widgets.generated.ts',
      'injection-widgets.generated.ts',
      'injection-tables.generated.ts',
      'search.generated.ts',
      'notifications.generated.ts',
      'ai-tools.generated.ts',
      'events.generated.ts',
      'analytics.generated.ts',
    ]
    for (const file of expectedFiles) {
      const content = readGenerated(tmpDir, file)
      expect(content).not.toBeNull()
      expect(content).toContain('AUTO-GENERATED')
    }
  })

  it('search.generated.ts has empty entries when no module provides search.ts', async () => {
    scaffoldModule(tmpDir, 'no_search', 'pkg', ['acl.ts'])
    const resolver = createMockResolver(tmpDir, [
      { id: 'no_search', from: '@open-mercato/core' },
    ])
    await generateModuleRegistry({ resolver, quiet: true })

    const search = readGenerated(tmpDir, 'search.generated.ts')!
    expect(search).toContain('const entriesRaw: SearchConfigEntry[] = [\n]')
  })

  it('events.generated.ts has empty entries when no module provides events.ts', async () => {
    scaffoldModule(tmpDir, 'no_events', 'pkg', ['acl.ts'])
    const resolver = createMockResolver(tmpDir, [
      { id: 'no_events', from: '@open-mercato/core' },
    ])
    await generateModuleRegistry({ resolver, quiet: true })

    const events = readGenerated(tmpDir, 'events.generated.ts')!
    expect(events).toContain('const entriesRaw: EventConfigEntry[] = [\n]')
  })

  it('ai-tools.generated.ts is empty when no module provides ai-tools.ts', async () => {
    scaffoldModule(tmpDir, 'no_ai', 'pkg', ['setup.ts'])
    const resolver = createMockResolver(tmpDir, [
      { id: 'no_ai', from: '@open-mercato/core' },
    ])
    await generateModuleRegistry({ resolver, quiet: true })

    const aiTools = readGenerated(tmpDir, 'ai-tools.generated.ts')!
    expect(aiTools).toContain('export const aiToolConfigEntries')
    expect(aiTools).not.toContain('no_ai')
  })
})
