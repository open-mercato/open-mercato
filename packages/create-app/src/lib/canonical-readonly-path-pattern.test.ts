import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
  id: string
  forbiddenPatterns: string[]
}>
const ids = ['OMH-219', 'OMH-220', 'OMH-221', 'OMH-222', 'OMH-225', 'OMH-226', 'OMH-227']

test('canonical reference paths may contain edit folders without declaring a mutation', () => {
  for (const id of ids) {
    const record = records.find(record => record.id === id)
    assert.ok(record)
    const expression = record.forbiddenPatterns.find(pattern => pattern.includes('src/modules/example'))
    assert.ok(expression, id)
    const pattern = new RegExp(expression, 'i')
    for (const file of [
      'src/modules/example/backend/todos/[id]/edit/page.tsx',
      'src/modules/example/backend/todos/[id]/edit/page.meta.ts',
    ]) {
      assert.ok(fs.statSync(new URL(`../../template/${file}`, import.meta.url)).isFile())
      assert.equal(pattern.test(JSON.stringify({ selectedContext: [file], decisions: ['example-root-read-only'] })), false, `${id}: ${file}`)
    }
  }
})

test('canonical reference mutation declarations stay forbidden in either action order', () => {
  for (const id of ids) {
    const record = records.find(record => record.id === id)
    assert.ok(record)
    const expression = record.forbiddenPatterns.find(pattern => pattern.includes('src/modules/example'))
    assert.ok(expression, id)
    const pattern = new RegExp(expression, 'i')
    for (const intent of [
      'src/modules/example: write',
      'src/modules/example/file.ts edited',
      'src/modules/example must patch files',
      'edit src/modules/example/backend/todos/[id]/edit/page.tsx',
      'write src/modules/example/data/entities.ts',
      'patch src/modules/example/commands/todos.ts',
    ]) {
      assert.equal(pattern.test(JSON.stringify({ selectedContext: [], decisions: [intent] })), true, `${id}: ${intent}`)
    }
  }
})
