import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const cliDist = path.resolve(__dirname, '../../../../dist')
const registryModule = path.join(cliDist, 'lib/generators/module-registry.js')
const resolverModule = path.join(cliDist, 'lib/resolver.js')
const modes = [
  { mode: 'full', generator: 'generateModuleRegistry', registry: 'modules.generated.ts' },
  { mode: 'app', generator: 'generateModuleRegistryApp', registry: 'modules.app.generated.ts' },
  { mode: 'CLI', generator: 'generateModuleRegistryCli', registry: 'modules.cli.generated.ts' },
]
const missingDependencies = [
  { dependent: 'eudr', missing: 'catalog', enabled: ['eudr'] },
  { dependent: 'sync_excel', missing: 'customers', enabled: ['sync_excel', 'data_sync'] },
  { dependent: 'sync_excel', missing: 'data_sync', enabled: ['sync_excel', 'customers'] },
]

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function snapshotOutput(directory: string): unknown[] {
  return fs.readdirSync(directory).sort().map((name) => {
    const entry = path.join(directory, name)
    const stat = fs.statSync(entry)
    return stat.isDirectory()
      ? { name, entries: snapshotOutput(entry) }
      : { name, content: fs.readFileSync(entry), mtimeMs: stat.mtimeMs }
  })
}

beforeAll(() => {
  if (!fs.existsSync(registryModule) || !fs.existsSync(resolverModule)) {
    throw new Error('[internal] Build the CLI and its workspace dependencies before running the built-ESM tests: yarn turbo run build --filter=@open-mercato/cli')
  }
})

describe.each(modes)('$mode generator under native ESM', ({ generator, registry }) => {
  let root: string
  let output: string

  function writeModule(id: string, source: string): void {
    writeFile(path.join(root, 'node_modules/@open-mercato/core/dist/modules', id, 'index.js'), source)
  }

  function generate(enabled: string[]) {
    const entries = enabled.map((id) => `{ id: '${id}', from: '@open-mercato/core' }`)
    writeFile(path.join(root, 'src/modules.ts'), `export const enabledModules = [${entries.join(', ')}]\n`)
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { createResolver } from ${JSON.stringify(pathToFileURL(resolverModule).href)}
      import { ${generator} } from ${JSON.stringify(pathToFileURL(registryModule).href)}
      if (typeof require !== 'undefined') throw new Error('Expected native ESM without require')
      const result = await ${generator}({ resolver: createResolver() })
      if (result.errors.length) throw new Error(result.errors.join('\\n'))
    `], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      timeout: 10_000,
    })
    if (child.error) throw child.error
    return { status: child.status, stderr: child.stderr }
  }

  function expectRegistry(...moduleIds: string[]): void {
    const content = fs.readFileSync(path.join(output, registry), 'utf8')
    for (const id of moduleIds) expect(content).toContain(`@open-mercato/core/modules/${id}`)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-registry-esm-'))
    output = path.join(root, '.mercato/generated')
    writeFile(path.join(root, 'node_modules/@open-mercato/core/package.json'), '{"name":"@open-mercato/core","type":"module"}')
    writeModule('eudr', "export const metadata = { id: 'eudr', requires: ['catalog'] }")
    writeModule('sync_excel', "export const metadata = { id: 'sync_excel', requires: ['customers', 'data_sync'] }")
    for (const id of ['catalog', 'customers', 'data_sync']) writeModule(id, `export const metadata = { id: '${id}' }`)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each(missingDependencies)('refuses $dependent without $missing before changing any output', ({ dependent, missing, enabled }) => {
    writeFile(path.join(output, registry), 'existing registry\n')
    writeFile(path.join(output, 'nested/sentinel.txt'), 'keep this file\n')
    const before = snapshotOutput(output)

    const result = generate(enabled)

    expect(result).toEqual({
      status: 1,
      stderr: expect.stringContaining(`Module "${dependent}" requires: ${missing}\n`),
    })
    expect(snapshotOutput(output)).toEqual(before)
  })

  it('emits the registry when both dependency closures are satisfied', () => {
    const enabled = ['eudr', 'catalog', 'sync_excel', 'customers', 'data_sync']

    expect(generate(enabled)).toEqual({ status: 0, stderr: '' })
    expectRegistry(...enabled)
  })

  it('warns and emits the registry when requires is computed at runtime', () => {
    writeModule('eudr', `
      function dependencies() { return ['catalog'] }
      export const metadata = { id: 'eudr', requires: dependencies() }
    `)

    const result = generate(['eudr'])

    expect(result).toEqual({
      status: 0,
      stderr: expect.stringMatching(/Module "eudr" declares metadata\.requires that cannot be read statically .*; its dependency check is skipped\./),
    })
    expectRegistry('eudr')
  })
})
