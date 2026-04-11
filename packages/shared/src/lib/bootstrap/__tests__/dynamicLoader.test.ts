import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

interface AppFixture {
  appRoot: string
  generatedDir: string
}

interface ScriptResult {
  status: number | null
  stdout: string
  stderr: string
}

const packageRoot = path.resolve(__dirname, '../../../../')
const repoRoot = path.resolve(__dirname, '../../../../../../')
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx')
const dynamicLoaderUrl = pathToFileURL(path.join(packageRoot, 'src/lib/bootstrap/dynamicLoader.ts')).href

const createdDirs: string[] = []

function createAppFixture(): AppFixture {
  const baseDir = fs.mkdtempSync(path.join(packageRoot, '.tmp-dynamic-loader-'))
  createdDirs.push(baseDir)

  const appRoot = path.join(baseDir, 'app')
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })

  return { appRoot, generatedDir }
}

function createTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(packageRoot, name))
  createdDirs.push(dir)
  return dir
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

function writeGeneratedTs(fixture: AppFixture, fileName: string, contents: string): string {
  const filePath = path.join(fixture.generatedDir, fileName)
  writeFile(filePath, contents)
  return filePath
}

function writeGeneratedMjs(fixture: AppFixture, fileName: string, contents: string): string {
  const filePath = path.join(fixture.generatedDir, fileName)
  writeFile(filePath, contents)
  return filePath
}

function setMtime(filePath: string, timestampMs: number): void {
  const time = new Date(timestampMs)
  fs.utimesSync(filePath, time, time)
}

function runTsxScript(code: string, args: string[] = [], cwd = repoRoot): ScriptResult {
  const scriptDir = createTempDir('.tmp-dynamic-loader-script-')
  const scriptPath = path.join(scriptDir, 'script.ts')
  writeFile(scriptPath, code)

  const result = spawnSync(tsxBin, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  })

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

describe('dynamicLoader', () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads generated bootstrap data from an explicit app root and tolerates missing search config', () => {
    const fixture = createAppFixture()

    writeFile(
      path.join(fixture.appRoot, 'src', 'module-meta.json'),
      JSON.stringify({ id: 'cli-test-module', label: 'Loaded from JSON' }),
    )

    writeGeneratedTs(
      fixture,
      'entities.ids.generated.ts',
      `export const E = { customers: { person: 'customers:person' } }\n`,
    )
    writeGeneratedTs(
      fixture,
      'modules.cli.generated.ts',
      `import meta from '@/src/module-meta.json'\nexport const modules = [{ id: meta.id, label: meta.label }]\n`,
    )
    writeGeneratedTs(
      fixture,
      'entities.generated.ts',
      `export const entities = [{ name: 'EntityA' }]\n`,
    )
    writeGeneratedTs(
      fixture,
      'di.generated.ts',
      `export const diRegistrars = []\n`,
    )

    const result = runTsxScript(
      `
        const { loadBootstrapData } = await import(${JSON.stringify(dynamicLoaderUrl)})
        const data = await loadBootstrapData(process.argv[2])
        console.log(JSON.stringify(data))
      `,
      [fixture.appRoot],
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const data = JSON.parse(result.stdout) as Record<string, unknown>

    expect(data.modules).toEqual([{ id: 'cli-test-module', label: 'Loaded from JSON' }])
    expect(data.entities).toEqual([{ name: 'EntityA' }])
    expect(data.entityIds).toEqual({ customers: { person: 'customers:person' } })
    expect(data.searchModuleConfigs).toEqual([])
    expect(data.dashboardWidgetEntries).toEqual([])
    expect(data.injectionWidgetEntries).toEqual([])
    expect(data.injectionTables).toEqual([])
    expect(data.interceptorEntries).toEqual([])
    expect(data.componentOverrideEntries).toEqual([])

    expect(fs.existsSync(path.join(fixture.generatedDir, 'entities.ids.generated.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.generatedDir, 'modules.cli.generated.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.generatedDir, 'entities.generated.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(fixture.generatedDir, 'di.generated.mjs'))).toBe(true)
  })

  it('prefers a newer precompiled module over recompiling TypeScript', () => {
    const fixture = createAppFixture()
    const olderTs = Date.now() - 10_000
    const newerMjs = Date.now() - 1_000

    const idsTs = writeGeneratedTs(
      fixture,
      'entities.ids.generated.ts',
      `export const E = { stale: { entity: 'stale:entity' } }\n`,
    )
    const idsMjs = writeGeneratedMjs(
      fixture,
      'entities.ids.generated.mjs',
      `export const E = { fresh: { entity: 'fresh:entity' } }\n`,
    )
    const modulesTs = writeGeneratedTs(
      fixture,
      'modules.cli.generated.ts',
      `export const modules = [{ id: 'stale-module' }]\n`,
    )
    const modulesMjs = writeGeneratedMjs(
      fixture,
      'modules.cli.generated.mjs',
      `export const modules = [{ id: 'fresh-module' }]\n`,
    )
    const entitiesTs = writeGeneratedTs(
      fixture,
      'entities.generated.ts',
      `export const entities = [{ name: 'StaleEntity' }]\n`,
    )
    const entitiesMjs = writeGeneratedMjs(
      fixture,
      'entities.generated.mjs',
      `export const entities = [{ name: 'FreshEntity' }]\n`,
    )
    const diTs = writeGeneratedTs(
      fixture,
      'di.generated.ts',
      `export const diRegistrars = ['stale-registrar']\n`,
    )
    const diMjs = writeGeneratedMjs(
      fixture,
      'di.generated.mjs',
      `export const diRegistrars = ['fresh-registrar']\n`,
    )

    for (const filePath of [idsTs, modulesTs, entitiesTs, diTs]) {
      setMtime(filePath, olderTs)
    }
    for (const filePath of [idsMjs, modulesMjs, entitiesMjs, diMjs]) {
      setMtime(filePath, newerMjs)
    }

    const result = runTsxScript(
      `
        const { loadBootstrapData } = await import(${JSON.stringify(dynamicLoaderUrl)})
        const data = await loadBootstrapData(process.argv[2])
        console.log(JSON.stringify(data))
      `,
      [fixture.appRoot],
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const data = JSON.parse(result.stdout) as Record<string, unknown>

    expect(data.entityIds).toEqual({ fresh: { entity: 'fresh:entity' } })
    expect(data.modules).toEqual([{ id: 'fresh-module' }])
    expect(data.entities).toEqual([{ name: 'FreshEntity' }])
    expect(data.diRegistrars).toEqual(['fresh-registrar'])
  })

  it('throws when a required generated file is missing', () => {
    const fixture = createAppFixture()

    writeGeneratedTs(
      fixture,
      'modules.cli.generated.ts',
      `export const modules = []\n`,
    )
    writeGeneratedTs(
      fixture,
      'entities.generated.ts',
      `export const entities = []\n`,
    )
    writeGeneratedTs(
      fixture,
      'di.generated.ts',
      `export const diRegistrars = []\n`,
    )

    const result = runTsxScript(
      `
        const { loadBootstrapData } = await import(${JSON.stringify(dynamicLoaderUrl)})
        try {
          await loadBootstrapData(process.argv[2])
          console.log(JSON.stringify({ ok: true }))
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }))
        }
      `,
      [fixture.appRoot],
    )

    expect(result.status).toBe(0)

    const output = JSON.parse(result.stdout) as { ok: boolean; message?: string }

    expect(output.ok).toBe(false)
    expect(output.message).toBe(`Generated file not found: ${path.join(fixture.generatedDir, 'entities.ids.generated.ts')}`)
  })

  it('throws when no app root can be resolved', () => {
    const cwd = createTempDir('.tmp-dynamic-loader-cwd-')

    const result = runTsxScript(
      `
        const { loadBootstrapData } = await import(${JSON.stringify(dynamicLoaderUrl)})
        try {
          await loadBootstrapData()
          console.log(JSON.stringify({ ok: true }))
        } catch (error) {
          console.log(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }))
        }
      `,
      [],
      cwd,
    )

    expect(result.status).toBe(0)

    const output = JSON.parse(result.stdout) as { ok: boolean; message?: string }

    expect(output.ok).toBe(false)
    expect(output.message).toContain('Could not find app root with .mercato/generated directory.')
  })

  it('bootstraps loaded data through the shared factory', () => {
    const fixture = createAppFixture()

    writeGeneratedTs(
      fixture,
      'entities.ids.generated.ts',
      `export const E = { customers: { person: 'customers:person' } }\n`,
    )
    writeGeneratedTs(
      fixture,
      'modules.cli.generated.ts',
      `export const modules = [{ id: 'cli-module' }]\n`,
    )
    writeGeneratedTs(
      fixture,
      'entities.generated.ts',
      `export const entities = [{ name: 'CliEntity' }]\n`,
    )
    writeGeneratedTs(
      fixture,
      'di.generated.ts',
      `export const diRegistrars = [() => undefined]\n`,
    )

    const result = runTsxScript(
      `
        import path from 'node:path'
        import { pathToFileURL } from 'node:url'

        const { bootstrapFromAppRoot } = await import(${JSON.stringify(dynamicLoaderUrl)})
        const factory = await import(pathToFileURL(path.join(${JSON.stringify(packageRoot)}, 'src/lib/bootstrap/factory.ts')).href)
        const modulesRegistry = await import(pathToFileURL(path.join(${JSON.stringify(packageRoot)}, 'src/lib/modules/registry.ts')).href)
        const mikro = await import(pathToFileURL(path.join(${JSON.stringify(packageRoot)}, 'src/lib/db/mikro.ts')).href)
        const di = await import(pathToFileURL(path.join(${JSON.stringify(packageRoot)}, 'src/lib/di/container.ts')).href)
        const entityIds = await import(pathToFileURL(path.join(${JSON.stringify(packageRoot)}, 'src/lib/encryption/entityIds.ts')).href)
        const data = await bootstrapFromAppRoot(process.argv[2])

        console.log(JSON.stringify({
          returned: {
            modules: data.modules,
            entities: data.entities,
            entityIds: data.entityIds,
            searchModuleConfigs: data.searchModuleConfigs,
          },
          state: {
            bootstrapped: factory.isBootstrapped(),
            modules: modulesRegistry.getModules(),
            ormEntities: mikro.getOrmEntities(),
            diRegistrarsCount: di.getDiRegistrars().length,
            entityIds: entityIds.getEntityIds(),
          },
        }))
      `,
      [fixture.appRoot],
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const output = JSON.parse(result.stdout) as {
      returned: Record<string, unknown>
      state: Record<string, unknown>
    }

    expect(output.returned).toEqual({
      modules: [{ id: 'cli-module' }],
      entities: [{ name: 'CliEntity' }],
      entityIds: { customers: { person: 'customers:person' } },
      searchModuleConfigs: [],
    })
    expect(output.state).toEqual({
      bootstrapped: true,
      modules: [{ id: 'cli-module' }],
      ormEntities: [{ name: 'CliEntity' }],
      diRegistrarsCount: 1,
      entityIds: { customers: { person: 'customers:person' } },
    })
  })
})
