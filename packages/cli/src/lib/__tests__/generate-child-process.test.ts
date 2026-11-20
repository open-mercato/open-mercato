import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runGenerateChildProcess } from '../generate-child-process'

let directory: string

function write(relativePath: string, contents: string): string {
  const file = path.join(directory, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

function readResult() {
  return JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'))
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-child-'))
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

it('releases the evaluation realm after every changed and unchanged edit cycle', async () => {
  const binary = write('generate.mjs', `
    import fs from 'node:fs'
    import { metadata } from './reexport.mjs'
    fs.writeFileSync('result.json', JSON.stringify({
      pid: process.pid, cwd: process.cwd(), args: process.argv.slice(2),
      marker: process.env.GENERATION_MARKER, evaluations: globalThis.__generatorEvaluations,
      metadata: { ...metadata, onJobAbandoned: await metadata.onJobAbandoned() },
    }))
  `)
  write('reexport.mjs', `export { metadata } from './metadata.mjs'`)
  write('metadata.mjs', `
    import { revision } from './dependency.mjs'
    globalThis.__generatorEvaluations = (globalThis.__generatorEvaluations ?? 0) + 1
    export const metadata = {
      GET: { requireAuth: true }, queue: 'jobs-' + revision,
      onJobAbandoned: async () => revision,
    }
    metadata.GET.requireFeatures = ['feature-' + revision]
  `)
  for (let revision = 0; revision < 20; revision += 1) {
    // Only the dependency changes: a root-only cache bust would miss this edit.
    write('dependency.mjs', `export const revision = ${revision}`)
    await runGenerateChildProcess({
      mercatoBin: binary,
      cwd: directory,
      env: { ...process.env, GENERATION_MARKER: 'inherited' },
      quiet: true,
    })
    expect(readResult()).toMatchObject({
      cwd: fs.realpathSync(directory), args: ['generate', 'all', '--quiet'],
      marker: 'inherited', evaluations: 1,
      metadata: {
        GET: { requireAuth: true, requireFeatures: [`feature-${revision}`] },
        queue: `jobs-${revision}`, onJobAbandoned: revision,
      },
    })
    expect(readResult().pid).not.toBe(process.pid)
  }
  const before = readResult()
  await runGenerateChildProcess({
    mercatoBin: binary, cwd: directory,
    env: { ...process.env, GENERATION_MARKER: 'inherited' }, quiet: true,
  })
  expect(readResult().metadata).toEqual(before.metadata)
  expect(readResult().evaluations).toBe(1)
  expect((globalThis as Record<string, unknown>).__generatorEvaluations).toBeUndefined()
}, 30_000)

it('propagates nonzero exits and allows a subsequent corrected invocation', async () => {
  const binary = write('generate.mjs', 'process.exit(7)')
  await expect(runGenerateChildProcess({ mercatoBin: binary, cwd: directory }))
    .rejects.toThrow('Generator process exited with code 7')
  write('generate.mjs', 'process.exit(0)')
  await expect(runGenerateChildProcess({ mercatoBin: binary, cwd: directory })).resolves.toBeUndefined()
})

it('propagates spawn failures', async () => {
  const binary = write('generate.mjs', '')
  await expect(runGenerateChildProcess({ mercatoBin: binary, cwd: path.join(directory, 'missing') }))
    .rejects.toMatchObject({ code: 'ENOENT' })
})

it('propagates signal termination', async () => {
  const binary = write('generate.mjs', `process.kill(process.pid, 'SIGTERM')`)
  await expect(runGenerateChildProcess({ mercatoBin: binary, cwd: directory }))
    .rejects.toThrow('Generator process terminated by SIGTERM')
})

it('preserves real generated metadata, callbacks and plugins across dependency edits', async () => {
  // Use a native loader so this exercises real ESM evaluation rather than Jest's
  // CommonJS transformation or the static-extraction fallback.
  const cliRoot = path.resolve(__dirname, '../../..')
  fs.symlinkSync(path.resolve(cliRoot, '../../node_modules'), path.join(directory, 'node_modules'), 'junction')
  write('package.json', '{"type":"module"}')
  write('src/modules/probe/index.js', `export const metadata = { name: 'Probe' }`)
  write('src/modules/probe/api/items/route.js', `
    import { metadata } from '../../lib/policy.js'
    metadata.GET.requireRoles = ['manager']
    export { metadata }
    export async function GET() { return new Response('ok') }
  `)
  write('src/modules/probe/subscribers/event.js', `
    import { revision } from '../lib/policy.js'
    export const metadata = { event: 'probe.' + revision, persistent: true }
    export default async function handler() { return revision }
  `)
  write('src/modules/probe/workers/job.js', `
    export { workerMetadata as metadata } from '../lib/policy.js'
    export default async function handler() {}
  `)
  write('src/modules/probe/probe.items.ts', 'export const items = []')
  write('src/modules/probe/generators.ts', `
    export const generatorPlugins = [{
      id: 'probe.output', conventionFile: 'probe.items.ts', importPrefix: 'PROBE',
      outputFileName: 'probe.generated.ts', configExpr: () => '{}',
      buildOutput: () => 'export const value = ' + JSON.stringify(process.env.PROBE_VALUE) + '\\n',
    }]
  `)
  const binary = write('generate.mjs', `
    import fs from 'node:fs'
    import path from 'node:path'
    import { pathToFileURL } from 'node:url'
    const { generateModuleRegistries } = await import(process.env.GENERATOR_SOURCE)
    const root = process.cwd()
    const output = path.join(root, '.mercato/generated')
    const resolver = {
      isMonorepo: () => false, getRootDir: () => root, getAppDir: () => root,
      getOutputDir: () => output, getModulesConfigPath: () => path.join(root, 'src/modules.ts'),
      discoverPackages: () => [], loadEnabledModules: () => [{ id: 'probe', from: '@app' }],
      getModulePaths: () => ({ appBase: path.join(root, 'src/modules/probe'), pkgBase: '' }),
      getModuleImportBase: () => ({ appBase: '@/modules/probe', pkgBase: '' }),
      getPackageOutputDir: () => output, getPackageRoot: () => root,
    }
    await generateModuleRegistries({ resolver, quiet: true })
    const { modules: runtimeModules } = await import(pathToFileURL(path.join(output, 'modules.runtime.generated.ts')).href)
    const routes = runtimeModules[0].apis
    const { modules } = await import(pathToFileURL(path.join(output, 'modules.cli.generated.ts')).href)
    const { value: pluginValue } = await import(pathToFileURL(path.join(output, 'probe.generated.ts')).href)
    const worker = modules[0].workers[0]
    await worker.onJobAbandoned({ id: 'payload' }, { jobId: 'job', reason: 'expired' })
    fs.writeFileSync('result.json', JSON.stringify({
      routes, pluginValue, event: modules[0].subscribers[0].event,
      worker: { queue: worker.queue, concurrency: worker.concurrency,
        abandoned: globalThis.__abandoned },
    }))
  `)
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(require.resolve('tsx')).href}`,
    GENERATOR_SOURCE: pathToFileURL(path.join(cliRoot, 'src/lib/generators/module-registry.ts')).href,
  }
  for (const revision of [1, 1, 2]) {
    write('src/modules/probe/lib/policy.js', `
      export const revision = ${revision}
      export const metadata = { GET: { requireAuth: true, requireFeatures: ['probe.' + revision] } }
      export const workerMetadata = {
        queue: 'probe-' + revision, concurrency: revision,
        onJobAbandoned: async (payload, info) => { globalThis.__abandoned = { revision, payload, info } },
      }
    `)
    await runGenerateChildProcess({ mercatoBin: binary, cwd: directory, env: { ...env, PROBE_VALUE: String(revision) }, quiet: true })
    const result = readResult()
    expect(result.pluginValue).toBe(String(revision))
    expect(result.event).toBe(`probe.${revision}`)
    expect(result.worker).toEqual({
      queue: `probe-${revision}`, concurrency: revision,
      abandoned: { revision, payload: { id: 'payload' }, info: { jobId: 'job', reason: 'expired' } },
    })
    expect(result.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          GET: { requireAuth: true, requireFeatures: [`probe.${revision}`], requireRoles: ['manager'] },
        }),
      }),
    ]))
  }
}, 120_000)
