import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AGENT_TOOL_IDS,
  parseAgentsValue,
  promptSelection,
  resolveExperimentalHooksValidator,
} from './wizard.js'
import type { AskFn } from './wizard.js'

const wizardPath = fileURLToPath(new URL('./wizard.ts', import.meta.url))

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

test('resolveExperimentalHooksValidator: stays disabled by default', () => {
  assert.equal(resolveExperimentalHooksValidator(undefined, {}), false)
})

test('resolveExperimentalHooksValidator: accepts explicit setup and environment opt-ins', () => {
  assert.equal(resolveExperimentalHooksValidator(true, {}), true)
  assert.equal(resolveExperimentalHooksValidator(undefined, {
    OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR: 'yes',
  }), true)
})

test('resolveExperimentalHooksValidator: explicit setup value overrides the environment default', () => {
  assert.equal(resolveExperimentalHooksValidator(false, {
    OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR: '1',
  }), false)
})

test('resolveExperimentalHooksValidator: rejects ambiguous environment values', () => {
  assert.throws(
    () => resolveExperimentalHooksValidator(undefined, {
      OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR: 'sometimes',
    }),
    /must be one of/,
  )
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

test('runAgenticSetup: embeds skill installer output at the wizard margin', () => {
  const targetDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-wizard-indent-')))
  const script = `
    import { runAgenticSetup } from ${JSON.stringify(pathToFileURL(wizardPath).href)}
    await runAgenticSetup(${JSON.stringify(targetDir)}, async () => '', { tool: 'test-output' })
  `

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      {
        cwd: path.dirname(wizardPath),
        encoding: 'utf8',
        env: { ...process.env, OM_SKIP_EXTERNAL_SKILLS: '1' },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^   Installed \d+ local skills/m)
    assert.match(result.stdout, /^   External skills:/m)
    assert.match(result.stdout, /^   Layout:/m)
    assert.match(result.stdout, /^   Tip:/m)
    assert.doesNotMatch(result.stdout, /^(?:Installed \d+ local skills|External skills:|Layout:|Tip:)/m)
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
})
