import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { generateModuleRegistry, generateModuleRegistryApp, generateModuleRegistryCli } from '../module-registry'

/**
 * The generator's output, not its helpers.
 *
 * A worker declaring `metadata.onJobAbandoned` makes the registry emit
 * `createLazyModuleWorkerAbandonHook(...)`, and the import for it used to be opted into per render
 * site. Forgetting it at one of the six sites produced a file referencing an undeclared name, which
 * type-checks nowhere and surfaces only at `build:app` — every unit test stayed green because no
 * fixture declared such a worker.
 *
 * These assertions are driven off the files the generators actually wrote, so a renderer added later
 * is covered without anyone remembering to extend this test.
 */

let tmpDir: string

function touchFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createMockResolver(dir: string, enabled: ModuleEntry[]): PackageResolver {
  const outputDir = path.join(dir, 'output', 'generated')
  fs.mkdirSync(outputDir, { recursive: true })
  return {
    isMonorepo: () => true,
    getRootDir: () => dir,
    getAppDir: () => path.join(dir, 'app'),
    getOutputDir: () => outputDir,
    getModulesConfigPath: () => path.join(dir, 'app', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(dir, 'app', 'src', 'modules', entry.id),
      pkgBase: path.join(dir, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => outputDir,
    getPackageRoot: () => path.join(dir, 'packages', 'core'),
  }
}

function scaffoldWorkerModule(dir: string, modId: string, workerSource: string): void {
  touchFile(path.join(dir, 'packages', 'core', 'src', 'modules', modId, 'workers', 'sync.ts'), workerSource)
}

function generatedFiles(dir: string): Array<{ name: string; content: string }> {
  const outputDir = path.join(dir, 'output', 'generated')
  if (!fs.existsSync(outputDir)) return []
  return fs.readdirSync(outputDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, content: fs.readFileSync(path.join(outputDir, name), 'utf8') }))
}

const ABANDON_HOOK_FACTORY = 'createLazyModuleWorkerAbandonHook'

const WORKER_WITH_HOOK = `
import { failAbandonedRun } from '../lib/abandoned-run'
export const metadata = {
  queue: 'demo-queue',
  id: 'demo:worker',
  concurrency: 2,
  onJobAbandoned: failAbandonedRun,
}
export default async function handle() {}
`

const WORKER_WITHOUT_HOOK = `
export const metadata = {
  queue: 'demo-queue',
  id: 'demo:worker',
  concurrency: 2,
}
export default async function handle() {}
`

async function generateAll(resolver: PackageResolver): Promise<void> {
  await generateModuleRegistry({ resolver, quiet: true })
  await generateModuleRegistryApp({ resolver, quiet: true })
  await generateModuleRegistryCli({ resolver, quiet: true })
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-registry-imports-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generated registries — emitted identifiers are imported', () => {
  it('imports the abandon-hook helper in every file that calls it', async () => {
    scaffoldWorkerModule(tmpDir, 'demo', WORKER_WITH_HOOK)
    const resolver = createMockResolver(tmpDir, [{ id: 'demo', from: 'pkg' } as ModuleEntry])

    await generateAll(resolver)

    const files = generatedFiles(tmpDir)
    const callers = files.filter(({ content }) => content.includes(`${ABANDON_HOOK_FACTORY}(`))
    // The fixture must actually exercise the path, or this test passes vacuously — which is exactly
    // how the missing import survived every existing suite.
    expect(callers.length).toBeGreaterThan(0)

    for (const { name, content } of callers) {
      expect(`${name}: ${content.includes(`import { `) && new RegExp(`import \\{[^}]*\\b${ABANDON_HOOK_FACTORY}\\b[^}]*\\} from`, 's').test(content)}`)
        .toBe(`${name}: true`)
    }
  })

  it('leaves output untouched for a module set whose workers declare no hook', async () => {
    scaffoldWorkerModule(tmpDir, 'demo', WORKER_WITHOUT_HOOK)
    const resolver = createMockResolver(tmpDir, [{ id: 'demo', from: 'pkg' } as ModuleEntry])

    await generateAll(resolver)

    for (const { name, content } of generatedFiles(tmpDir)) {
      expect(`${name}: ${content.includes(ABANDON_HOOK_FACTORY)}`).toBe(`${name}: false`)
    }
  })
})
