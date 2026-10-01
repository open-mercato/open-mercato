import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')

test('encrypted list-search guidance distinguishes engine rewrites from raw ORM filters', () => {
  const owner = read('../../agentic/shared/ai/skills/om-data-model-design/references/sensitive-data.md')
  assert.match(owner, /QueryEngine[^\n]*`\$ilike`/)
  assert.match(owner, /raw ORM[^\n]*tokenLookup/)
  assert.match(owner, /search_tokens[^\n]*tenant[^\n]*organization/)
  assert.match(owner, /no-search-tokens/)
  assert.match(owner, /independent[^\n]*`search.ts`/)
  assert.match(owner, /meta\.ciphertextSearchWarnings/)
  const api = read('../../agentic/shared/ai/skills/om-module-scaffold/references/api-and-domain.md')
  assert.match(api, /sensitive-data\.md#encrypted-list-search/)
  assert.doesNotMatch(api, /never `\$ilike`\s+a column an encryption map covers/)
})

test('ordinary encrypted search briefs route to query-index knowledge and the reference entrypoint', () => {
  const root = read('../../agentic/shared/AGENTS.md.template')
  assert.match(root, /encrypted[^;\n]*search box[^;\n]*filter by name[^;\n]*query_index/)
  const example = read('../../../../apps/mercato/src/modules/example/README.md')
  assert.match(example, /search[^\n]*encrypted[^\n]*surface-map\.md/i)
})
