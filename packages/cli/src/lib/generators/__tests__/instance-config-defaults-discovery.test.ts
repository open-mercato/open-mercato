import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import {
  generateModuleRegistry,
  generateModuleRegistryApp,
  generateModuleRegistryCli,
} from '../module-registry'

let fileMtimeNonce = 0

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  const mtime = new Date(Date.now() + fileMtimeNonce)
  fileMtimeNonce += 1
  fs.utimesSync(filePath, mtime, mtime)
}

function createMonorepoResolver(tmpDir: string, enabled: ModuleEntry[]): PackageResolver {
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
    getModulePaths: (entry: ModuleEntry) => {
      const pkgDir = entry.from === '@open-mercato/search' ? 'search' : 'core'
      return {
        appBase: path.join(tmpDir, 'app', 'src', 'modules', entry.id),
        pkgBase: path.join(tmpDir, 'packages', pkgDir, 'src', 'modules', entry.id),
      }
    },
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `${entry.from ?? '@open-mercato/core'}/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'packages', 'core'),
  } as unknown as PackageResolver
}

function createStandalonePackedResolver(tmpDir: string, enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(tmpDir, '.mercato', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })

  return {
    isMonorepo: () => false,
    getRootDir: () => tmpDir,
    getAppDir: () => tmpDir,
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(tmpDir, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(tmpDir, 'src', 'modules', entry.id),
      pkgBase: path.join(tmpDir, 'node_modules', entry.from ?? '@open-mercato/core', 'dist', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `${entry.from ?? '@open-mercato/core'}/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(tmpDir, 'node_modules', '@open-mercato/core'),
  } as unknown as PackageResolver
}

describe('instanceConfigDefaults setup discovery and client-bundle isolation', () => {
  const createdDirs: string[] = []

  afterEach(() => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()!
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('discovers setup.ts for enabled app-local and workspace modules, omits disabled owners, and keeps client/metadata outputs isolated', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-defaults-monorepo-'))
    createdDirs.push(tmpDir)

    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'notifications', 'index.ts'),
      "export const metadata = { id: 'notifications' }\n",
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'notifications', 'setup.ts'),
      "export const setup = { instanceConfigDefaults: () => [{ name: 'delivery_strategies', value: { panelPath: '/backend/notifications' } }] }\nexport default setup\n",
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'notifications', 'backend', 'notifications', 'page.tsx'),
      'export default function NotificationsPage() { return null }\n',
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'notifications', 'api', 'notifications', 'route.ts'),
      "export const metadata = { GET: { requireAuth: true } }\nexport async function GET() { return new Response('ok') }\n",
    )
    touchFile(
      path.join(tmpDir, 'packages', 'core', 'src', 'modules', 'notifications', 'i18n', 'en.json'),
      JSON.stringify({ notifications: { title: 'Notifications' } }),
    )

    // Disabled workspace owner (not listed in enabled modules)
    touchFile(
      path.join(tmpDir, 'packages', 'search', 'src', 'modules', 'search', 'index.ts'),
      "export const metadata = { id: 'search' }\n",
    )
    touchFile(
      path.join(tmpDir, 'packages', 'search', 'src', 'modules', 'search', 'setup.ts'),
      "export const setup = { instanceConfigDefaults: () => [{ name: 'auto_index_enabled', value: true, legacyStorageNamespace: 'vector' }] }\nexport default setup\n",
    )

    // Enabled app-local owner
    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'custom_defaults', 'index.ts'),
      "export const metadata = { id: 'custom_defaults' }\n",
    )
    touchFile(
      path.join(tmpDir, 'app', 'src', 'modules', 'custom_defaults', 'setup.ts'),
      "export const setup = { instanceConfigDefaults: () => [{ name: 'feature_flag', value: true }] }\nexport default setup\n",
    )

    const resolver = createMonorepoResolver(tmpDir, [
      { id: 'notifications', from: '@open-mercato/core' },
      { id: 'custom_defaults', from: '@app' },
    ])

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleRegistryApp({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const outDir = resolver.getOutputDir()
    const serverRegistry = fs.readFileSync(path.join(outDir, 'modules.generated.ts'), 'utf8')
    const bootstrapRegistry = fs.readFileSync(path.join(outDir, 'modules.bootstrap.generated.ts'), 'utf8')
    const cliRegistry = fs.readFileSync(path.join(outDir, 'modules.cli.generated.ts'), 'utf8')

    for (const content of [serverRegistry, bootstrapRegistry, cliRegistry]) {
      expect(content).toContain('@open-mercato/core/modules/notifications/setup')
      expect(content).toContain('modules/custom_defaults/setup')
      expect(content).toContain('SETUP_custom_defaults_')
      expect(content).not.toContain('modules/search/setup')
    }

    // Client and route-metadata generated artifacts must never reach setup.ts providers.
    for (const isolatedArtifact of [
      'api-route-metadata.generated.ts',
      'backend-route-metadata.generated.ts',
      'modules.i18n.generated.ts',
      'dashboard-widgets.generated.ts',
      'injection-widgets.generated.ts',
      'injection-tables.generated.ts',
      'enabled-module-ids.generated.ts',
    ]) {
      const artifactPath = path.join(outDir, isolatedArtifact)
      if (!fs.existsSync(artifactPath)) continue
      const artifact = fs.readFileSync(artifactPath, 'utf8')
      expect(artifact).not.toContain('/setup')
      expect(artifact).not.toContain('instanceConfigDefaults')
    }
  })

  it('discovers compiled setup.js from packed node_modules packages in standalone apps', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-defaults-packed-'))
    createdDirs.push(tmpDir)

    touchFile(
      path.join(tmpDir, 'node_modules', '@open-mercato/search', 'dist', 'modules', 'search', 'index.js'),
      "export const metadata = { id: 'search' }\n",
    )
    touchFile(
      path.join(tmpDir, 'node_modules', '@open-mercato/search', 'dist', 'modules', 'search', 'setup.js'),
      "export const setup = { instanceConfigDefaults: () => [{ name: 'auto_index_enabled', value: true, legacyStorageNamespace: 'vector' }] }\nexport default setup\n",
    )

    const resolver = createStandalonePackedResolver(tmpDir, [
      { id: 'search', from: '@open-mercato/search' },
    ])

    await generateModuleRegistry({ resolver, quiet: true })
    await generateModuleRegistryCli({ resolver, quiet: true })

    const outDir = resolver.getOutputDir()
    const serverRegistry = fs.readFileSync(path.join(outDir, 'modules.generated.ts'), 'utf8')
    const cliRegistry = fs.readFileSync(path.join(outDir, 'modules.cli.generated.ts'), 'utf8')

    expect(serverRegistry).toContain('@open-mercato/search/modules/search/setup')
    expect(cliRegistry).toContain('@open-mercato/search/modules/search/setup')
  })
})
