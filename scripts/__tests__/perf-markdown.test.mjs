import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeCell } from '../../perf/scripts/lib/markdown.mjs'

test('escapeCell escapes backslashes before pipes', () => {
  assert.equal(escapeCell('a|b'), 'a\\|b')
  assert.equal(escapeCell('a\\|b'), 'a\\\\\\|b')
  assert.equal(escapeCell('line\nbreak'), 'line break')
  assert.equal(escapeCell(''), '–')
})
