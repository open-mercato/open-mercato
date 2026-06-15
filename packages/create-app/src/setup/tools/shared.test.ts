import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillPackageManifest } from './skill-packages.js'

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

// Skill packages: generateShared() copies skills from packages.json. The
// manifest must stay in lockstep with the skill folders on disk, or a
// `create-mercato-app` user gets an orphaned (never-installed) or dangling
// (listed-but-missing) skill. These guards catch drift at PR time.
const SKILLS_DIR = join(AGENTIC_SHARED_DIR, 'ai', 'skills')
const MANIFEST = JSON.parse(readFileSync(join(SKILLS_DIR, 'packages.json'), 'utf8')) as SkillPackageManifest

function skillFoldersOnDisk(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
}

test('every skill folder on disk is assigned to exactly one package', () => {
  const assignment = new Map<string, string[]>()
  for (const [pkgName, pkg] of Object.entries(MANIFEST.packages)) {
    for (const skill of pkg.skills) {
      assignment.set(skill, [...(assignment.get(skill) ?? []), pkgName])
    }
  }
  for (const skill of skillFoldersOnDisk()) {
    const owners = assignment.get(skill) ?? []
    assert.equal(owners.length, 1, `${skill} is in ${owners.length} packages (${owners.join(', ') || 'none'}); expected exactly 1.`)
  }
})

test('every skill listed in the manifest exists on disk', () => {
  const onDisk = new Set(skillFoldersOnDisk())
  for (const pkg of Object.values(MANIFEST.packages)) {
    for (const skill of pkg.skills) {
      assert.ok(onDisk.has(skill), `manifest lists "${skill}" but it has no folder with SKILL.md on disk.`)
    }
  }
})

test('every default entry names a defined package', () => {
  for (const name of MANIFEST.default) {
    assert.ok(MANIFEST.packages[name], `default lists "${name}" which is not a defined package.`)
  }
})

test('every extraFiles path exists on disk', () => {
  for (const pkg of Object.values(MANIFEST.packages)) {
    for (const extra of pkg.extraFiles ?? []) {
      assert.ok(existsSync(join(SKILLS_DIR, ...extra.split('/'))), `extraFiles path "${extra}" does not exist on disk.`)
    }
  }
})

test('creative package owns the ideation skills and the proposal-intake fragment', () => {
  const creative = MANIFEST.packages.creative
  assert.ok(creative, 'creative package is missing from the manifest.')
  assert.ok(creative.skills.includes('om-proposal') && creative.skills.includes('om-brainstorm'))
  assert.ok((creative.extraFiles ?? []).includes('om-spec-writing/references/proposal-intake.md'))
  assert.ok(!MANIFEST.default.includes('creative'), 'creative must stay opt-in (not in default).')
})

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
