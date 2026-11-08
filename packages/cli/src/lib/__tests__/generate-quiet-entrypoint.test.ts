import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

it('keeps quiet generation stdout empty without hiding diagnostics at the CLI entrypoint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-quiet-'))
  const cliRoot = path.resolve(__dirname, '../../..')
  const coreRoot = path.join(directory, 'node_modules/@open-mercato/core')
  const moduleRoot = path.join(directory, 'src/modules/probe')
  const env = { ...process.env }
  delete env.OM_CLI_QUIET
  delete env.DOTENV_CONFIG_QUIET
  try {
    // A real directory, not the workspace core symlink: the production resolver
    // must identify this as a standalone app and never generate into the repo.
    fs.mkdirSync(path.join(coreRoot, 'dist/modules'), { recursive: true })
    fs.writeFileSync(path.join(coreRoot, 'package.json'), JSON.stringify({
      name: '@open-mercato/core', version: '0.0.0', type: 'module',
    }))
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'quiet-generation-fixture', type: 'module' }))
    fs.writeFileSync(path.join(directory, '.env'), 'GENERATOR_QUIET_FIXTURE=loaded\n')
    fs.mkdirSync(path.join(moduleRoot, 'api/items'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'src/modules.ts'), `export const enabledModules = [{ id: 'probe', from: '@app' }]`)
    fs.writeFileSync(path.join(moduleRoot, 'index.js'), `export const metadata = { name: 'Probe' }`)
    // Missing route metadata is a real generator warning, not a logging mock.
    fs.writeFileSync(path.join(moduleRoot, 'api/items/route.js'), `export async function GET() { return new Response('ok') }`)

    const args = ['--import', require.resolve('tsx'), path.join(cliRoot, 'src/bin.ts'), 'generate', 'all']
    const options = { cwd: directory, env, encoding: 'utf8' as const, maxBuffer: 4 * 1024 * 1024 }
    const quiet = await execute(process.execPath, [...args, '--quiet'], options)
    expect(quiet.stdout.trim()).toBe('')
    expect(quiet.stderr.trim().length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(directory, '.mercato/generated/modules.runtime.generated.ts'))).toBe(true)

    const normal = await execute(process.execPath, args, options)
    expect(normal.stdout.trim().length).toBeGreaterThan(0)

    fs.writeFileSync(path.join(moduleRoot, 'index.js'), `export const metadata = { requires: ['missing_dependency'] }`)
    await expect(execute(process.execPath, [...args, '-q'], options)).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringMatching(/\S/),
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}, 120_000)
