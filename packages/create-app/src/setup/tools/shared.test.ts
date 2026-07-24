import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finalizeHarnessManifest, generateShared } from './shared.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Standalone apps generated from this template declare `"type": "module"` in
// their package.json (see `packages/create-app/template/package.json.template`),
// and `generateShared()` copies these template files into them verbatim. Any
// `.ts` template that references CommonJS-only globals like `__dirname` or
// `__filename` will crash with `ReferenceError` the moment a Node ESM loader
// touches it (e.g. Playwright loading the integration config). These tests
// pin the contract: the templates must be ESM-safe.
const AGENTIC_SHARED_DIR = join(__dirname, '..', '..', '..', 'agentic', 'shared')

const ESM_INCOMPATIBLE_PATTERNS = [
  // bare CommonJS globals; ok only when paired with the polyfill below
  /\b__dirname\b/,
  /\b__filename\b/,
  // bare CJS dynamic require — also undefined under ESM
  /\brequire\s*\(/,
]

const POLYFILL_PATTERNS = {
  __dirname: /path\.dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)/,
  __filename: /fileURLToPath\s*\(\s*import\.meta\.url\s*\)/,
  require: /createRequire\s*\(\s*import\.meta\.url\s*\)/,
}

// Tracked .ts templates copied into ESM consumers. When new templates are
// added to `generateShared()`, register them here so this test catches a
// regression at PR time instead of at customer install time.
const TRACKED_TEMPLATES = ['ai/qa/tests/playwright.config.ts']

for (const relativePath of TRACKED_TEMPLATES) {
  test(`agentic/shared template "${relativePath}" is ESM-safe`, () => {
    const fullPath = join(AGENTIC_SHARED_DIR, relativePath)
    const source = readFileSync(fullPath, 'utf8')

    if (ESM_INCOMPATIBLE_PATTERNS[0].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.__dirname,
        `${relativePath} references __dirname but does not reconstruct it from import.meta.url. ` +
          `Standalone apps generated from this template are "type": "module"; bare __dirname is undefined under ESM.`,
      )
    }
    if (ESM_INCOMPATIBLE_PATTERNS[1].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.__filename,
        `${relativePath} references __filename but does not reconstruct it from import.meta.url.`,
      )
    }
    if (ESM_INCOMPATIBLE_PATTERNS[2].test(source)) {
      assert.match(
        source,
        POLYFILL_PATTERNS.require,
        `${relativePath} uses require() but does not initialize it via createRequire(import.meta.url).`,
      )
    }
  })
}

test('recursive shared emission produces a complete hash-owned standalone harness', () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'om-shared-harness-'))
  mkdirSync(join(targetDir, 'src'), { recursive: true })
  writeFileSync(join(targetDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')

  const config = { projectName: 'harness-fixture', targetDir }
  generateShared(config)
  finalizeHarnessManifest(config, [])

  for (const relativePath of [
    'AGENTS.md',
    '.ai/harness/cases.json',
    '.ai/skills/om-evolve-harness/SKILL.md',
    'scripts/evaluate-agent-harness.mjs',
    'scripts/framework-context.mjs',
    'scripts/install-skills.mjs',
  ]) {
    assert.equal(existsSync(join(targetDir, relativePath)), true, `${relativePath} must be emitted recursively`)
  }

  const manifest = JSON.parse(readFileSync(join(targetDir, '.ai', 'harness', 'manifest.json'), 'utf8')) as {
    generator: string
    files: Array<{ path: string; sha256: string; source: string }>
  }
  assert.match(manifest.generator, /^open-mercato-agentic@(?:unknown|\d+\.\d+\.\d+(?:[-+].+)?)$/)
  assert.ok(manifest.files.length > 80, 'the ownership manifest must cover the complete emitted tree')
  for (const entry of manifest.files) {
    const emittedPath = join(targetDir, entry.path)
    assert.equal(existsSync(emittedPath), true, `${entry.path} must exist`)
    assert.equal(createHash('sha256').update(readFileSync(emittedPath)).digest('hex'), entry.sha256)
  }
  assert.equal(
    manifest.files.find((entry) => entry.path === '.ai/skills/om-auto-create-pr/SKILL.md')?.source,
    'external-override',
  )
  assert.equal(
    manifest.files.find((entry) => entry.path === '.ai/skills/om-module-scaffold/SKILL.md')?.source,
    'local-skill',
  )
  assert.doesNotMatch(readFileSync(join(targetDir, 'AGENTS.md'), 'utf8'), /\{\{PROJECT_NAME\}\}/)
})
