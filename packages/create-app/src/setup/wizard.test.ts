import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TOOL_IDS, parseAgentsValue, promptSelection } from './wizard.js'
import type { AskFn } from './wizard.js'

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

test('parseAgentsValue: github-copilot is a recognised tool id', () => {
  assert.ok(AGENT_TOOL_IDS.includes('github-copilot'))
  assert.deepEqual(parseAgentsValue('github-copilot'), { skip: false, tools: ['github-copilot'] })
})

async function withTty(stdin: boolean, stdout: boolean, run: () => Promise<void>): Promise<void> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const log = console.log
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
    console.log = () => {}
    await run()
  } finally {
    console.log = log
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
    if (stdoutDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
  }
}

test('promptSelection: piped stdin takes the advertised default without prompting', async () => {
  await withTty(false, true, async () => {
    const refuse: AskFn = () => Promise.reject(new Error('prompted in a non-interactive shell'))
    assert.deepEqual(await promptSelection(refuse), ['claude-code'])
  })
})

test('promptSelection: piped stdout still accepts a selection from interactive stdin', async () => {
  await withTty(true, false, async () => {
    assert.deepEqual(await promptSelection(() => Promise.resolve('5')), ['skip'])
  })
})

test('promptSelection: an interactive shell still honors the answer', async () => {
  await withTty(true, true, async () => {
    assert.deepEqual(await promptSelection(() => Promise.resolve('2')), ['codex'])
    assert.deepEqual(await promptSelection(() => Promise.resolve('')), ['claude-code'])
    assert.deepEqual(await promptSelection(() => Promise.resolve('5')), ['skip'])
  })
})
