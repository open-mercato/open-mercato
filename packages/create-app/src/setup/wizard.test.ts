import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TOOL_IDS, parseAgentsValue } from './wizard.js'

test('parseAgentsValue: single tool', () => {
  assert.deepEqual(parseAgentsValue('claude-code'), { skip: false, tools: ['claude-code'] })
})

test('parseAgentsValue: comma-separated list (trim + lowercase + dedupe)', () => {
  assert.deepEqual(parseAgentsValue(' Claude-Code , codex ,codex'), {
    skip: false,
    tools: ['claude-code', 'codex'],
  })
})

test('parseAgentsValue: all expands to every selectable tool', () => {
  assert.deepEqual(parseAgentsValue('all'), { skip: false, tools: [...AGENT_TOOL_IDS] })
})

test('parseAgentsValue: none / skip request a skip', () => {
  assert.deepEqual(parseAgentsValue('none'), { skip: true, tools: [] })
  assert.deepEqual(parseAgentsValue('skip'), { skip: true, tools: [] })
})

test('parseAgentsValue: unknown id throws with the valid set', () => {
  assert.throws(() => parseAgentsValue('claude-code,foo'), /Unknown agent "foo"\. Valid: .*all, none/)
})

test('parseAgentsValue: empty value throws', () => {
  assert.throws(() => parseAgentsValue('   '), /requires at least one value/)
})

test('parseAgentsValue: none cannot combine with a tool', () => {
  assert.throws(() => parseAgentsValue('none,codex'), /cannot be combined/)
})

test('parseAgentsValue: all cannot combine with a tool', () => {
  assert.throws(() => parseAgentsValue('all,codex'), /cannot be combined with individual agents/)
})
