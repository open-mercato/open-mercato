import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  TEMPLATE_CONTENT_TRANSFORMS,
  TEMPLATE_ONLY_RELATIVE_FILES,
} from '../../../../scripts/template-sync.ts'

// The canonical example module is the reference surface agents read in a scaffolded
// app, so the copy shipped in the create-app template must be a byte-for-byte mirror
// of apps/mercato's tree — same files, same bytes, no per-file exceptions. A silent
// divergence would make the app's documented surface map wrong for every scaffold.
// This is a release gate: failures name the exact offending relative paths.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const EXAMPLE_MODULE_REL = 'modules/example'
const APP_EXAMPLE_ROOT = path.join(REPO_ROOT, 'apps', 'mercato', 'src', EXAMPLE_MODULE_REL)
const TEMPLATE_EXAMPLE_ROOT = path.join(
  REPO_ROOT,
  'packages',
  'create-app',
  'template',
  'src',
  EXAMPLE_MODULE_REL,
)

const IGNORED_BASENAMES = new Set(['.DS_Store'])

function collectRelativeFiles(root: string): string[] {
  const collected: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_BASENAMES.has(entry.name)) continue
      if (entry.name === 'node_modules') continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      collected.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  walk(root)
  return collected.sort()
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function isExampleModulePath(rel: string): boolean {
  return rel === EXAMPLE_MODULE_REL || rel.startsWith(`${EXAMPLE_MODULE_REL}/`)
}

test('example module tree exists on both sides of the mirror', () => {
  assert.ok(
    fs.existsSync(APP_EXAMPLE_ROOT),
    `Missing canonical example module at apps/mercato/src/${EXAMPLE_MODULE_REL}`,
  )
  assert.ok(
    fs.existsSync(TEMPLATE_EXAMPLE_ROOT),
    `Missing template mirror at packages/create-app/template/src/${EXAMPLE_MODULE_REL}`,
  )
})

test('example module file lists are identical in app and template', () => {
  const appFiles = collectRelativeFiles(APP_EXAMPLE_ROOT)
  const templateFiles = collectRelativeFiles(TEMPLATE_EXAMPLE_ROOT)
  const templateSet = new Set(templateFiles)
  const appSet = new Set(appFiles)

  const missingInTemplate = appFiles.filter((rel) => !templateSet.has(rel))
  const extraInTemplate = templateFiles.filter((rel) => !appSet.has(rel))

  const problems: string[] = []
  if (missingInTemplate.length > 0) {
    problems.push(
      `Missing in packages/create-app/template/src/${EXAMPLE_MODULE_REL}:\n  ${missingInTemplate.join('\n  ')}`,
    )
  }
  if (extraInTemplate.length > 0) {
    problems.push(
      `Present only in packages/create-app/template/src/${EXAMPLE_MODULE_REL}:\n  ${extraInTemplate.join('\n  ')}`,
    )
  }

  assert.equal(
    problems.length,
    0,
    `Canonical example module tree drifted from its template mirror — run \`yarn template:sync:fix\`.\n${problems.join('\n')}`,
  )
  assert.ok(appFiles.length > 0, 'Canonical example module tree is empty')
})

test('example module file contents are byte-identical in app and template', () => {
  const appFiles = collectRelativeFiles(APP_EXAMPLE_ROOT)
  const mismatched: string[] = []
  for (const rel of appFiles) {
    const templateFile = path.join(TEMPLATE_EXAMPLE_ROOT, rel)
    if (!fs.existsSync(templateFile)) continue
    const appHash = hashFile(path.join(APP_EXAMPLE_ROOT, rel))
    const templateHash = hashFile(templateFile)
    if (appHash !== templateHash) {
      mismatched.push(`${EXAMPLE_MODULE_REL}/${rel} (app ${appHash.slice(0, 12)} vs template ${templateHash.slice(0, 12)})`)
    }
  }
  assert.equal(
    mismatched.length,
    0,
    `Canonical example module content drifted from its template mirror — run \`yarn template:sync:fix\`.\nMismatched files:\n  ${mismatched.join('\n  ')}`,
  )
})

test('template-sync declares no per-file exception under the example module', () => {
  const templateOnly = [...TEMPLATE_ONLY_RELATIVE_FILES].filter(isExampleModulePath)
  assert.deepEqual(
    templateOnly,
    [],
    `TEMPLATE_ONLY_RELATIVE_FILES in scripts/template-sync.ts must not exempt example module files — the mirror is byte-exact.\nOffending entries:\n  ${templateOnly.join('\n  ')}`,
  )

  const transformed = Object.keys(TEMPLATE_CONTENT_TRANSFORMS).filter(isExampleModulePath)
  assert.deepEqual(
    transformed,
    [],
    `TEMPLATE_CONTENT_TRANSFORMS in scripts/template-sync.ts must not rewrite example module files — the mirror is byte-exact.\nOffending keys:\n  ${transformed.join('\n  ')}`,
  )
})
