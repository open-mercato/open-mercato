import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { moduleId, packageName, renderGenerated, scanAvailable } from '../lib/official-modules.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('moduleId converts the package suffix to a snake_case module id', () => {
  assert.equal(moduleId('forms'), 'forms')
  assert.equal(moduleId('ai-assistant'), 'ai_assistant')
  assert.equal(moduleId('loyalty-program'), 'loyalty_program')
})

test('packageName scopes the suffix under @open-mercato', () => {
  assert.equal(packageName('forms'), '@open-mercato/forms')
})

test('renderGenerated emits a stable, sorted, deduped ModuleEntry list', () => {
  const content = renderGenerated(['sdk', 'forms', 'forms'])
  assert.match(content, /AUTO-GENERATED/)
  assert.match(content, /import type \{ ModuleEntry \} from '\.\/modules'/)
  assert.match(content, /\{ id: 'forms', from: '@open-mercato\/forms' \},\n {2}\{ id: 'sdk', from: '@open-mercato\/sdk' \},/)
})

test('renderGenerated produces an empty array when nothing is activated', () => {
  assert.equal(renderGenerated([]), renderGenerated([]))
  assert.match(renderGenerated([]), /export const officialModuleEntries: ModuleEntry\[\] = \[\n\]\n$/)
})

test('standalone template ships official-modules.generated.ts so scaffolded apps build', () => {
  const templateGenerated = path.join(
    REPO_ROOT,
    'packages',
    'create-app',
    'template',
    'src',
    'official-modules.generated.ts',
  )
  const templateModules = path.join(
    REPO_ROOT,
    'packages',
    'create-app',
    'template',
    'src',
    'modules.ts',
  )
  const modulesContent = fs.readFileSync(templateModules, 'utf8')
  if (modulesContent.includes("from './official-modules.generated'")) {
    assert.ok(
      fs.existsSync(templateGenerated),
      'template src/modules.ts imports ./official-modules.generated — the file must ship with the scaffold or Turbopack build fails',
    )
    const generated = fs.readFileSync(templateGenerated, 'utf8')
    assert.match(generated, /officialModuleEntries: ModuleEntry\[\]/)
  }
})

test('scanAvailable lists package directories that contain a package.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-modules-scan-'))
  try {
    const packagesDir = path.join(root, 'packages')
    fs.mkdirSync(path.join(packagesDir, 'forms'), { recursive: true })
    fs.writeFileSync(path.join(packagesDir, 'forms', 'package.json'), '{"name":"@open-mercato/forms"}')
    fs.mkdirSync(path.join(packagesDir, 'sdk'), { recursive: true })
    fs.writeFileSync(path.join(packagesDir, 'sdk', 'package.json'), '{"name":"@open-mercato/sdk"}')
    fs.mkdirSync(path.join(packagesDir, 'not-a-package'), { recursive: true })
    assert.deepEqual(scanAvailable(root), ['forms', 'sdk'])
    assert.deepEqual(scanAvailable(path.join(root, 'missing')), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
