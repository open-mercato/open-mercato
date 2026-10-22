import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const roots = [
  new URL('../../agentic/shared/AGENTS.md.template', import.meta.url),
  new URL('../../template/AGENTS.md', import.meta.url),
]

test('custom-field ownership distinguishes app ce declarations from installed-host extensions', () => {
  const surfaces = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/references/module-surfaces.md', import.meta.url), 'utf8')
  const schema = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-data-model-design/references/schema-design.md', import.meta.url), 'utf8')
  const example = fs.readFileSync(new URL('../../template/src/modules/example/ce.ts', import.meta.url), 'utf8')
  assert.match(surfaces, /Custom fields\/entities \| In `ce\.ts`, use the generated-registry contract `export const entities/)
  assert.match(schema, /\[`ce\.ts`\].*custom entities and field kinds/)
  assert.match(example, /id: 'example:todo'/)
  assert.match(example, /export default entities/)
  for (const root of roots) {
    const text = fs.readFileSync(root, 'utf8')
    assert.match(text, /Installed-host custom fields\/entities = `umes` \+ `module-data` \+ `om-data-model-design`/)
    assert.doesNotMatch(text, /(?:^|\. )Custom fields\/entities = `umes`/m)
    const extension = text.split('\n').find(line => line.startsWith('| `umes` |') && line.includes('`om-system-extension`'))
    assert.ok(extension)
    assert.match(extension, /Installed-host fields\/extension entities; links\/enrichers\/injection\/interceptors\/guards\/subscribers\/DOM\/hosts\/widgets\/toggles\/overrides/)
    assert.match(text, /App-owned record design: entity\/link\/validator\/migration\/encryption\/lock\/transaction/)
    assert.match(text, /Business slice\/multi-seam domain\/API\/command fix \| MUST load `om-module-scaffold`/)
    assert.match(text, /scalar-ID\/snapshot fix to persisted records or commands linked to an installed record MUST use `module-data` \+ `umes`/)
    assert.match(text, /Editable records expose `updated_at`\/`updatedAt`/)
    assert.match(text, /custom update\/delete clients send the version and surface 409s/)
  }
})
