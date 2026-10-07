import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { TEMPLATE_COMMENTED_MODULES, TEMPLATE_CONTENT_TRANSFORMS } from '../../../../scripts/template-sync.ts'

// `packages/create-app/template/src/modules.ts` deliberately diverges from
// `apps/mercato/src/modules.ts`: design_system/example are stripped outright, while
// channel_discord stays commented out with a maintainer-facing byte-budget explanation
// (#5598). `TEMPLATE_CONTENT_TRANSFORMS['modules.ts']` is the only thing standing between
// the two files silently drifting apart again.

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
