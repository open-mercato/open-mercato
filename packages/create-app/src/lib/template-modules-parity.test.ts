import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { TEMPLATE_COMMENTED_MODULES, TEMPLATE_CONTENT_TRANSFORMS } from '../../../../scripts/template-sync.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const APP_MODULES_FILE = path.join(REPO_ROOT, 'apps', 'mercato', 'src', 'modules.ts')
const TEMPLATE_MODULES_FILE = path.join(REPO_ROOT, 'packages', 'create-app', 'template', 'src', 'modules.ts')

test('modules.ts transform output matches the committed template file byte-for-byte', () => {
  const appContent = fs.readFileSync(APP_MODULES_FILE, 'utf8')
  const templateContent = fs.readFileSync(TEMPLATE_MODULES_FILE, 'utf8')

  const transform = TEMPLATE_CONTENT_TRANSFORMS['modules.ts']
  assert.ok(transform, 'TEMPLATE_CONTENT_TRANSFORMS is missing a modules.ts transform')

  const transformed = transform(appContent)
  assert.equal(
    transformed,
    templateContent,
    'Transformed apps/mercato/src/modules.ts no longer matches packages/create-app/template/src/modules.ts — run `yarn template:sync:fix`.',
  )
})

test('modules.ts transform keeps every commented module commented out, not deleted', () => {
  const appContent = fs.readFileSync(APP_MODULES_FILE, 'utf8')
  const transform = TEMPLATE_CONTENT_TRANSFORMS['modules.ts']
  const transformed = transform(appContent)

  const moduleIds = Object.keys(TEMPLATE_COMMENTED_MODULES)
  assert.ok(moduleIds.length > 0, 'TEMPLATE_COMMENTED_MODULES must describe at least one module')

  for (const moduleId of moduleIds) {
    const registration = `{ id: '${moduleId}',`
    assert.match(
      transformed,
      new RegExp(`^\\s*// ${escapeForRegExp(registration)}`, 'm'),
      `${moduleId} must stay as a commented-out registration in the template, not be stripped entirely`,
    )
    assert.doesNotMatch(
      transformed,
      new RegExp(`^ {2}${escapeForRegExp(registration)}`, 'm'),
      `${moduleId} must not remain enabled in the template`,
    )
  }
})


test('optional Discord registration does not install its inactive provider', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'packages/create-app/template/package.json.template'),
    'utf8',
  )) as { dependencies: Record<string, string> }
  const source = fs.readFileSync(TEMPLATE_MODULES_FILE, 'utf8')

  assert.equal(Object.hasOwn(manifest.dependencies, '@open-mercato/channel-discord'), false)
  assert.match(source, /^\s*\/\/ \{ id: 'channel_discord', from: '@open-mercato\/channel-discord' \},/m)
  assert.doesNotMatch(source, /^\s*\{ id: 'channel_discord',/m)
})

test('Discord opt-in instructions include installation before registration', () => {
  const source = TEMPLATE_CONTENT_TRANSFORMS['modules.ts'](fs.readFileSync(APP_MODULES_FILE, 'utf8'))

  assert.match(source, /yarn add @open-mercato\/channel-discord/)
  assert.match(source, /uncomment the registration/)
})
