import test from 'node:test'
import assert from 'node:assert/strict'

import { parseSelectionInput } from '../watch-select.mjs'

const packages = [
  { name: '@open-mercato/core', shortLabel: 'core' },
  { name: '@open-mercato/ui', shortLabel: 'ui' },
  { name: '@open-mercato/shared', shortLabel: 'shared' },
]

test('parseSelectionInput keeps all on empty / all / *', () => {
  assert.deepEqual(parseSelectionInput('', packages), ['core', 'ui', 'shared'])
  assert.deepEqual(parseSelectionInput('   ', packages), ['core', 'ui', 'shared'])
  assert.deepEqual(parseSelectionInput('all', packages), ['core', 'ui', 'shared'])
  assert.deepEqual(parseSelectionInput('*', packages), ['core', 'ui', 'shared'])
})

test('parseSelectionInput resolves 1-based indexes', () => {
  assert.deepEqual(parseSelectionInput('1,3', packages), ['core', 'shared'])
  assert.deepEqual(parseSelectionInput('2', packages), ['ui'])
})

test('parseSelectionInput resolves names case-insensitively', () => {
  assert.deepEqual(parseSelectionInput('UI core', packages), ['core', 'ui'])
})

test('parseSelectionInput mixes indexes and names, dedupes, ignores unknowns', () => {
  assert.deepEqual(parseSelectionInput('1, ui, 99, nope, core', packages), ['core', 'ui'])
})

test('parseSelectionInput returns results in package list order', () => {
  assert.deepEqual(parseSelectionInput('3,1,2', packages), ['core', 'ui', 'shared'])
})
