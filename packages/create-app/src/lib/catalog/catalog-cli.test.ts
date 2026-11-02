import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main, maybeRunCatalogStep, parseArgs, type CatalogStepRunner } from '../../index.ts'
import { CATALOG_SELECTION_FILE } from './selection.js'
import type { CatalogStepOptions } from './catalog-step.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageVersion: string = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')).version
const KSEF = 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party'
const scratchDirs: string[] = []
const scratchDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'om-catalog-cli-'))
  scratchDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

/** picker.json with the KSeF module verified on the catalog line of this create-mercato-app version. */
function catalogForThisVersion(): unknown {
  const [major, minor] = packageVersion.split('.')
  const line = `${Number(major)}.${Number(minor)}`
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-28T00:00:00.000Z',
    lines: [line],
    modules: [
      {
        id: 'integration_ksef_direct',
        from: '@fastwhitecat/integration-ksef-direct',
        title: 'KSeF Integration',
        description: 'Sends and receives Polish structured e-invoices through the KSeF API v2.',
        requires: ['integrations'],
        source: 'third-party',
        locator: 'npm:@fastwhitecat/integration-ksef-direct',
        license: { spdx: 'MIT', kind: 'osi' },
        tier: 'verified',
        verifiedOn: [line],
        install: KSEF,
        installByLine: { [line]: KSEF },
      },
    ],
  }
}

/** Runs `main` in a fresh directory with a stubbed fetch, capturing its output and every catalog request. */
async function runMain(argv: string[], catalog: () => unknown = catalogForThisVersion) {
  const cwd = scratchDir()
  const requests: string[] = []
  const output: string[] = []
  const originalCwd = process.cwd()
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  const originalUrl = process.env.OM_MODULES_PICKER_URL
  delete process.env.OM_MODULES_PICKER_URL
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url))
    return new Response(JSON.stringify(catalog()), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' ').replace(/\u001b\[[0-9;]*m/g, ''))
  }
  process.chdir(cwd)
  try {
    await main(argv)
  } finally {
    process.chdir(originalCwd)
    globalThis.fetch = originalFetch
    console.log = originalLog
    if (originalUrl === undefined) delete process.env.OM_MODULES_PICKER_URL
    else process.env.OM_MODULES_PICKER_URL = originalUrl
  }
  return { cwd, requests, output }
}

test('parseArgs reads --modules and --module-picker', () => {
  assert.equal(parseArgs(['my-app', '--modules', 'a,b']).options.modules, 'a,b')
  assert.equal(parseArgs(['my-app', '--module-picker']).options.modulePicker, true)
  const plain = parseArgs(['my-app'])
  assert.equal(plain.appName, 'my-app')
  assert.equal(plain.options.modules, undefined)
  assert.equal(plain.options.modulePicker, false)
})

test('parseArgs refuses --modules without a value', () => {
  assert.throws(() => parseArgs(['my-app', '--modules']), /Option --modules requires a value/)
  assert.throws(() => parseArgs(['my-app', '--modules', '--module-picker']), /Option --modules requires a value/)
})

test('main refuses the catalog flags with --app and --app-url before scaffolding', async () => {
  for (const argv of [
    ['my-prm', '--app', 'prm', '--modules', 'x'],
    ['my-marketplace', '--app-url', 'https://github.com/some-agency/ready-app-marketplace', '--module-picker'],
  ]) {
    const cwd = scratchDir()
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      await assert.rejects(main(argv), /--modules and --module-picker are not supported with --app\/--app-url/)
    } finally {
      process.chdir(originalCwd)
    }
    assert.equal(existsSync(join(cwd, argv[0] as string)), false)
  }
})

test('main never fetches the module catalog without --modules or --module-picker', async () => {
  const { cwd, requests, output } = await runMain(['plain-app', '--agents', 'none', '--no-init-git'])
  assert.deepEqual(requests, [])
  assert.ok(existsSync(join(cwd, 'plain-app', 'package.json')))
  assert.equal(existsSync(join(cwd, 'plain-app', CATALOG_SELECTION_FILE)), false)
  assert.ok(!output.some((line) => line.includes('Modules you planned from the catalog')))
})

test('main plans --modules from the catalog and prints their commands in the next steps', async () => {
  const { cwd, requests, output } = await runMain(['catalog-app', '--agents', 'none', '--no-init-git', '--modules', ' integration_ksef_direct , integration_ksef_direct'])
  assert.deepEqual(requests, ['https://modules.openmercato.com/picker.json'])
  const saved = JSON.parse(readFileSync(join(cwd, 'catalog-app', CATALOG_SELECTION_FILE), 'utf8'))
  assert.deepEqual(saved.commands, [KSEF])
  const heading = output.indexOf('Modules you planned from the catalog:')
  assert.ok(heading > 0)
  assert.ok(output.slice(heading).includes(`  ${KSEF}`))
})

test('maybeRunCatalogStep skips the step without flags and passes a preset other than classic', async () => {
  const calls: CatalogStepOptions[] = []
  const run: CatalogStepRunner = async (options) => {
    calls.push(options)
    return { commands: ['cmd'], selectionFile: null, commandWarnings: { cmd: 'careful' } }
  }
  assert.deepEqual(await maybeRunCatalogStep('/tmp/unused', 'crm', null, false, run), { commands: [], commandWarnings: {} })
  assert.equal(calls.length, 0)

  assert.deepEqual(await maybeRunCatalogStep('/tmp/app', 'crm', ['x'], false, run), {
    commands: ['cmd'],
    commandWarnings: { cmd: 'careful' },
  })
  const crm = calls[0] as CatalogStepOptions
  assert.equal(crm.targetDir, '/tmp/app')
  assert.deepEqual(crm.requested, ['x'])
  assert.equal(crm.version, packageVersion)
  assert.ok(crm.presetModuleIds?.includes('customers'))
  assert.ok(crm.presetModuleIds?.includes('ai_assistant'))
  assert.ok(crm.presetModules?.some((entry) => entry.id === 'search' && entry.from === '@open-mercato/search'))
  assert.equal(crm.ask, null)

  await maybeRunCatalogStep('/tmp/app', 'classic', null, true, run)
  const classic = calls[1] as CatalogStepOptions
  assert.equal(classic.presetModuleIds, null)
  assert.equal(classic.presetModules, null)
  assert.equal(classic.picker, true)
  assert.equal(classic.ask, null, 'a run without a terminal gets no prompt')
})
