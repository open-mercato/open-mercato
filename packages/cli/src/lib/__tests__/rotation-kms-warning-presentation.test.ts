import { runWithRotationKmsWarningPresentation } from '../rotation-kms-warning-presentation'
import { writeKmsWarning } from '@open-mercato/shared/lib/encryption/kms-warning-presentation'
const originalEnv = { ...process.env }
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks() })

test('exact rotation route captures warnings before bootstrap and after environment loads inside main', async () => {
  delete process.env.OM_ROTATION_PROGRESS
  process.env.NO_COLOR = ''
  const output = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  await runWithRotationKmsWarningPresentation(['node', 'mercato', 'entities', 'rotate-encryption-key'], async () => {
    writeKmsWarning(['normal before env'])
    process.env.OM_ROTATION_PROGRESS = 'json'
    writeKmsWarning(['🚨 bootstrap warning', 'Retain the previous root', 'Source: EXPLICIT_SETTING'])
    await Promise.resolve()
    writeKmsWarning(['handler warning'])
  })
  expect(output.mock.calls[0][0]).toBe('normal before env\n')
  for (const [chunk] of output.mock.calls.slice(1)) expect(JSON.parse(String(chunk))).toMatchObject({ schemaVersion: 1, type: 'phase.changed', runId: 'rotation', phase: 'rotation.kms.warning', rowsDone: '0', rowsTotal: '0', rowsTotalExact: false, bytesDone: '0', chunksDone: 0, at: expect.any(String) })
  expect(JSON.parse(String(output.mock.calls[1][0])).entity).toBe('bootstrap warning\nRetain the previous root\nSource: EXPLICIT_SETTING')
})

test.each([
  ['entities', 'rotate-encryption-key-extra'], ['other', 'rotate-encryption-key'], ['entities', 'list'],
])('unrelated route %s %s retains normal warning even with JSON rotation env', (module, command) => {
  process.env.OM_ROTATION_PROGRESS = 'json'; process.env.NO_COLOR = ''
  const output = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  runWithRotationKmsWarningPresentation(['node', 'mercato', module, command], () => writeKmsWarning(['visible normal warning']))
  expect(output).toHaveBeenCalledWith('visible normal warning\n')
})

// Execute the actual bin entry with a synthetic bootstrap graph, without an app,
// credentials, driver or network. Warnings fire during env load and bootstrap,
// before the command handler, so wrapping only run() cannot satisfy this test.
test.each([['entities', 'rotate-encryption-key', true], ['entities', 'list', false]])('actual bin scopes %s/%s before environment loading and bootstrap', async (module, command, structured) => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const { build } = await import('esbuild')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'om-bin-kms-warning-'))
  try {
    const warningImport = "import { writeKmsWarning } from '@open-mercato/shared/lib/encryption/kms-warning-presentation';"
    const fixtures: Record<string, string> = {
      '@open-mercato/telemetry': 'export const initTelemetry = async () => {}',
      './lib/dev-supervisor-manifest.js': 'export const canUseLightweightDevSupervisor=()=>false; export const loadDevSupervisorManifest=()=>null; export const registerDevSupervisorManifest=()=>{}',
      '@open-mercato/shared/lib/telemetry/runtime': 'export const isTelemetryBackendEnabled = () => false',
      '@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook': 'export const installNextSubpathResolveHook = () => {}',
      './lib/cli-bootstrap-mode.js': "export const resolveCliBootstrapMode = () => 'full'",
      './lib/flush-before-exit.js': 'export const flushBeforeExit = async () => {}',
      './lib/resolver.js': 'export const createResolver = () => ({getAppDir: () => "/fixture-app"})',
      './lib/load-env.js': warningImport + 'export const loadAppEnv = async () => { process.env.OM_ROTATION_PROGRESS="json"; writeKmsWarning(["environment custody warning"]) }',
      '@open-mercato/shared/lib/bootstrap/dynamicLoader': warningImport + 'export const bootstrapFromAppRoot = async () => { writeKmsWarning(["bootstrap custody warning"]); return {modules:[]} }',
      './mercato.js': warningImport + 'export const registerCliModules = () => {}; export const run = async () => { writeKmsWarning(["handler custody warning"]); return 0 }',
    }
    const output = path.join(directory, 'bin.mjs')
    await build({ entryPoints: [path.resolve(__dirname, '../../bin.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
      name: 'fixture-bootstrap', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.path in fixtures) return { path: args.path, namespace: 'fixture' }
          if (args.path === '@open-mercato/shared/lib/encryption/kms-warning-presentation') return { path: path.resolve(__dirname, '../../../../shared/src/lib/encryption/kms-warning-presentation.ts') }
          return undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }))
      },
    }] })
    const env = { ...process.env, NO_COLOR: '' }; delete env.OM_ROTATION_PROGRESS
    const child = spawnSync(process.execPath, [output, module, command], { env, encoding: 'utf8' })
    expect(child.status).toBe(0); expect(child.stdout).toBe('')
    const lines = child.stderr.trim().split('\n')
    if (structured) expect(lines.map(line => JSON.parse(line))).toEqual(['environment custody warning', 'bootstrap custody warning', 'handler custody warning'].map(entity => expect.objectContaining({ schemaVersion: 1, type: 'phase.changed', phase: 'rotation.kms.warning', entity })))
    else expect(lines).toEqual(['environment custody warning', 'bootstrap custody warning', 'handler custody warning'])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
