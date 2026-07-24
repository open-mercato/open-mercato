import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const TEMPLATE_DIR = new URL('../../template/', import.meta.url)
const PACKAGE_JSON_TEMPLATE = new URL('package.json.template', TEMPLATE_DIR)

function readScripts(): Record<string, string> {
  const raw = fs.readFileSync(PACKAGE_JSON_TEMPLATE, 'utf8')
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> }
  return parsed.scripts ?? {}
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
