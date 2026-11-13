import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = new URL('../../', import.meta.url)
const lockfile = parse(readFileSync(new URL('yarn.lock', root), 'utf8'))
const ui = JSON.parse(readFileSync(new URL('packages/ui/package.json', root), 'utf8'))

function resolveDependency(name, range) {
  const descriptor = `${name}@${range.startsWith('npm:') ? range : `npm:${range}`}`
  const entry = Object.entries(lockfile).find(([descriptors]) => descriptors.split(', ').includes(descriptor))
  assert.ok(entry, `Missing lockfile descriptor: ${descriptor}`)
  return entry[1]
}

const editor = resolveDependency('@mdxeditor/editor', ui.dependencies['@mdxeditor/editor'])
const dialog = resolveDependency('@radix-ui/react-dialog', ui.dependencies['@radix-ui/react-dialog'])

for (const primitive of ['dialog', 'select', 'popover', 'tooltip']) {
  test(`Markdown editor and host ${primitive} share the same Radix dismissal runtime`, () => {
    const name = `@radix-ui/react-${primitive}`
    const nested = resolveDependency(name, editor.dependencies[name])
    const layerName = '@radix-ui/react-dismissable-layer'

    assert.equal(
      resolveDependency(layerName, nested.dependencies[layerName]).resolution,
      resolveDependency(layerName, dialog.dependencies[layerName]).resolution,
      'Independent layer stacks can dismiss the parent first and leave body pointer events disabled',
    )

    const scopeName = '@radix-ui/react-focus-scope'
    if (nested.dependencies[scopeName]) {
      assert.equal(
        resolveDependency(scopeName, nested.dependencies[scopeName]).resolution,
        resolveDependency(scopeName, dialog.dependencies[scopeName]).resolution,
        'Nested editor popups must pause the parent dialog focus trap',
      )
    }
  })
}
