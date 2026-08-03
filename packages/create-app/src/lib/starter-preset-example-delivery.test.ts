import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readEnabledModuleIds } from '../setup/tools/shared.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..', '..')
const CLI_ENTRY = join(PACKAGE_ROOT, 'src', 'index.ts')
const TEMPLATE_EXAMPLE_DIR = join(PACKAGE_ROOT, 'template', 'src', 'modules', 'example')
const CLI_SCAFFOLD_TIMEOUT_MS = 120_000
const SKIPPED_MODULE_DIRS = new Set(['__tests__', '__integration__'])
const PRESET_IDS = ['classic', 'empty', 'crm'] as const

function collectEmittableRelativeFiles(root: string, prefix = ''): string[] {
  return readdirSync(root).flatMap((entry) => {
    const absolutePath = join(root, entry)
    if (statSync(absolutePath).isDirectory()) {
      if (SKIPPED_MODULE_DIRS.has(entry)) return []
      return collectEmittableRelativeFiles(absolutePath, `${prefix}${entry}/`)
    }
    return [`${prefix}${entry.replace(/\.template$/, '')}`]
  })
}

function scaffoldPreset(presetId: string): { targetRoot: string; targetDir: string } {
  const targetRoot = mkdtempSync(join(tmpdir(), `create-mercato-app-preset-${presetId}-`))
  const targetDir = join(targetRoot, `${presetId}-app`)
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', CLI_ENTRY, targetDir, '--skip-agentic-setup', '--preset', presetId],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: CLI_SCAFFOLD_TIMEOUT_MS,
    },
  )

  assert.equal(
    result.status,
    0,
    `expected CLI scaffold with --preset ${presetId} to succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )

  return { targetRoot, targetDir }
}

for (const presetId of PRESET_IDS) {
  test(`starter preset ${presetId} ships the example source runtime-disabled`, async () => {
    const { targetRoot, targetDir } = scaffoldPreset(presetId)

    try {
      const exampleDir = join(targetDir, 'src', 'modules', 'example')
      assert.ok(existsSync(exampleDir), `preset ${presetId} must ship src/modules/example`)

      const expectedFiles = collectEmittableRelativeFiles(TEMPLATE_EXAMPLE_DIR)
      assert.ok(expectedFiles.length > 0, 'template example module must contain emittable files')
      for (const relativePath of expectedFiles) {
        assert.ok(
          existsSync(join(exampleDir, relativePath)),
          `preset ${presetId} is missing src/modules/example/${relativePath}`,
        )
      }
      assert.equal(existsSync(join(exampleDir, '__tests__')), false)
      assert.equal(existsSync(join(exampleDir, '__integration__')), false)

      const modulesTsPath = join(targetDir, 'src', 'modules.ts')
      const enabledIds = readEnabledModuleIds(modulesTsPath)
      assert.ok(enabledIds.length > 0, `preset ${presetId} must parse a non-empty enabled module list`)
      assert.ok(!enabledIds.includes('example'), `preset ${presetId} must not enable the example module`)
      assert.ok(
        !enabledIds.includes('example_customers_sync'),
        `preset ${presetId} must not enable example_customers_sync`,
      )
      assert.ok(
        !enabledIds.includes('design_system'),
        `preset ${presetId} must not enable the design_system module`,
      )

      const modulesTs = readFileSync(modulesTsPath, 'utf8')
      assert.doesNotMatch(modulesTs, /id: 'design_system'/)
      assert.doesNotMatch(modulesTs, /id: 'example',/)

      // The spec-first gate must reach every preset, and it must point at a README this
      // very scaffold emitted — a routed entrypoint that does not exist is a dead link.
      const rootInstructions = readFileSync(join(targetDir, 'AGENTS.md'), 'utf8')
      assert.equal(
        (rootInstructions.match(/Spec gate before code:/g) ?? []).length,
        1,
        `preset ${presetId} must emit the spec-first gate exactly once`,
      )
      assert.match(rootInstructions, /-> spec first \(`spec-first`\)/)
      assert.match(rootInstructions, /-> proceed \(`direct`\)/)
      assert.match(rootInstructions, /\(`reuse-spec`\)/)
      assert.match(rootInstructions, /ask once \(`ask`\)/)
      assert.match(rootInstructions, /Then `om-module-scaffold` starts at `src\/modules\/example\/README\.md`/)
      assert.ok(
        existsSync(join(exampleDir, 'README.md')),
        `preset ${presetId} routes the spec gate at src/modules/example/README.md, which must exist`,
      )
      assert.ok(
        existsSync(join(exampleDir, 'references', 'surface-inventory.json')),
        `preset ${presetId} must emit the capability inventory om-module-scaffold resolves against`,
      )

      const quickLinksUrl = pathToFileURL(join(targetDir, 'src', 'lib', 'homeQuickLinks.ts')).href
      const { buildHomeQuickLinks } = (await import(quickLinksUrl)) as {
        buildHomeQuickLinks: (modules: readonly { id: string }[]) => { href: string }[]
      }
      const quickLinks = buildHomeQuickLinks(enabledIds.map((id) => ({ id })))
      assert.deepEqual(quickLinks.map((link) => link.href), ['/login'])
      for (const link of quickLinks) {
        assert.ok(!link.href.includes('example'), `preset ${presetId} generated a dead example link`)
        assert.ok(!link.href.includes('design-system'), `preset ${presetId} generated a dead DS link`)
      }
    } finally {
      rmSync(targetRoot, { recursive: true, force: true })
    }
  })
}

test('design_system gallery source stays available in the installed core artifact', () => {
  const galleryPage = resolve(
    PACKAGE_ROOT,
    '..',
    'core',
    'src',
    'modules',
    'design_system',
    'backend',
    'design-system',
    'page.tsx',
  )
  assert.ok(existsSync(galleryPage), 'core must keep shipping the design-system gallery source')
})
