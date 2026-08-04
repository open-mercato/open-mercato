import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const TEMPLATE_DIR = new URL('../../template/', import.meta.url)
const PACKAGE_JSON_TEMPLATE = new URL('package.json.template', TEMPLATE_DIR)
// Mirrors SKIP_DIRS in src/index.ts — directories create-mercato-app never copies.
const SCAFFOLD_SKIPPED_DIRS = new Set(['__tests__', '__integration__'])

function listScaffoldedTestFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SCAFFOLD_SKIPPED_DIRS.has(entry.name)) continue
      found.push(...listScaffoldedTestFiles(path.join(dir, entry.name)))
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      found.push(path.join(dir, entry.name))
    }
  }

  return found
}

function readScripts(): Record<string, string> {
  const raw = fs.readFileSync(PACKAGE_JSON_TEMPLATE, 'utf8')
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> }
  return parsed.scripts ?? {}
}

function readDevDependencies(): Record<string, string> {
  const raw = fs.readFileSync(PACKAGE_JSON_TEMPLATE, 'utf8')
  const parsed = JSON.parse(raw) as { devDependencies?: Record<string, string> }
  return parsed.devDependencies ?? {}
}

// #4328: `yarn test`, `yarn lint`, and `yarn install-skills` failed on a clean
// scaffold because the template's package.json pointed at files it did not ship
// (and at `next lint`, removed in Next 16). Keep those targets honest.
test('every file a template script references is shipped by the template', () => {
  const scripts = readScripts()
  const referenced: Array<{ script: string; file: string }> = []

  for (const [name, command] of Object.entries(scripts)) {
    const configMatch = command.match(/--config\s+([^\s]+)/)
    if (configMatch && !configMatch[1].startsWith('.ai/')) {
      referenced.push({ script: name, file: configMatch[1] })
    }
    const shMatch = command.match(/\b(?:sh|bash|node)\s+(\.\/)?(scripts\/[^\s]+)/)
    if (shMatch) referenced.push({ script: name, file: shMatch[2] })
  }

  assert.ok(referenced.length > 0, 'expected the template to reference at least one script file')

  for (const { script, file } of referenced) {
    assert.ok(
      fs.existsSync(new URL(file, TEMPLATE_DIR)),
      `template script "${script}" references ${file}, which the template does not ship`,
    )
  }
})

test('lint does not use `next lint` (removed in Next 16) and a flat config ships', () => {
  const scripts = readScripts()
  assert.ok(scripts.lint, 'template must define a lint script')
  assert.ok(
    !/\bnext\s+lint\b/.test(scripts.lint),
    '`next lint` was removed in Next 16 — the template must call the ESLint CLI instead',
  )
  assert.ok(
    fs.existsSync(new URL('eslint.config.mjs', TEMPLATE_DIR)),
    'template must ship an eslint.config.mjs so `yarn lint` works out of the box',
  )
})

test('Jest ships the environment required by jsdom-annotated template tests', () => {
  const devDependencies = readDevDependencies()
  assert.ok(
    devDependencies['jest-environment-jsdom'],
    'template tests use @jest-environment jsdom, so standalone apps must install jest-environment-jsdom',
  )
})

test('`yarn test` succeeds on a scaffold that ships no test files', () => {
  const scaffoldedTestFiles = listScaffoldedTestFiles(fileURLToPath(new URL('src/', TEMPLATE_DIR)))
  const jestConfig = createRequire(import.meta.url)(
    fileURLToPath(new URL('jest.config.cjs', TEMPLATE_DIR)),
  ) as { passWithNoTests?: boolean }

  assert.equal(
    scaffoldedTestFiles.length,
    0,
    'template test files live in __tests__/__integration__, which create-mercato-app skips',
  )
  assert.equal(
    jestConfig.passWithNoTests,
    true,
    'the scaffold copies no test files, so `yarn test` needs passWithNoTests to avoid exiting 1 on a clean app',
  )
})

test('install-skills is a successful no-op before agentic setup', () => {
  const result = spawnSync('sh', ['scripts/install-skills.sh'], {
    cwd: fileURLToPath(TEMPLATE_DIR),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /mercato agentic:init/)
})
