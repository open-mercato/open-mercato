import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { createSpinner, statusLine } from '../ui.mjs'
import { createSetupLogs } from '../setup-logs.mjs'
import { llmProviderStep, runSteps } from '../steps.mjs'

test('stage headings restore the original prefix and style only Expected:', () => {
  const script = `Object.defineProperty(process.stdout, 'isTTY', {value:true}); const {stepHeader}=await import(${JSON.stringify(new URL('../ui.mjs', import.meta.url).href)}); stepHeader(9,9,'Database','migrations + seed')`
  const env = { ...process.env, TERM: 'xterm' }
  delete env.NO_COLOR
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout.replace(/\u001b\[[0-9;]*m/g, ''), /\n   ── Step 9\/9 Database\n   Expected:/)
  assert.doesNotMatch(result.stdout, /🧭/)
  assert.match(result.stdout, /\x1b\[1m\x1b\[33mExpected:\x1b\[0m\x1b\[0m migrations \+ seed/)
})

test('status lines leave a visible gap after variation-selector emojis', () => {
  const lines = []
  for (const kind of ['ok', 'warn', 'fail', 'info']) statusLine(kind, 'message', { log: (line) => lines.push(line.replace(/\u001b\[[0-9;]*m/g, '')) })
  assert.deepEqual(lines, ['   ✅ message', '   ⚠️  message', '   ❌ message', '   ℹ️  message'])
})

test('working spinner animates with elapsed time, pauses, and is replaced on completion', () => {
  const output = []
  const statuses = []
  let tick
  let elapsed = 0
  let cleared = 0
  const spinner = createSpinner('working…', {
    output: { isTTY: true, columns: 80, write: (chunk) => output.push(chunk) },
    env: {}, log: (line) => statuses.push(line), frames: ['⠋', '⠙'], now: () => elapsed,
    setIntervalImpl: (callback) => { tick = callback; return 1 }, clearIntervalImpl: () => { cleared += 1 },
  })
  assert.match(output.join(''), /⠋ working….*\(0s\)/)
  elapsed = 12000
  tick()
  assert.match(output.join(''), /⠙ working….*\(12s\)/)
  spinner.pause()
  assert.equal(cleared, 1)
  spinner.resume()
  spinner.stop('ok', 'done in 48s')
  const length = output.length
  spinner.resume()
  assert.equal(output.length, length, 'stopped activity never restarts')
  assert.match(statuses.join(''), /✅ done in 48s/)
})

test('raw-log toggles pause working output and resume it only after folding', () => {
  const input = new EventEmitter()
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode() {}, resume() {}, pause() {} })
  const events = []
  const logs = createSetupLogs({ input, output: { isTTY: true, write() {} }, env: {} })
  logs.start()
  logs.setActivity({ pause: () => events.push('pause'), resume: () => events.push('resume'), stop: () => events.push('stop') })
  input.emit('data', 'd')
  logs.resumeActivity()
  assert.deepEqual(events, ['resume', 'pause'], 'progress does not resume while raw logs are visible')
  input.emit('data', 'd')
  assert.deepEqual(events, ['resume', 'pause', 'resume'])
  logs.stop()
  assert.ok(events.includes('stop'))
})

test('stage activity stops on success, skip and failure and never starts over a prompt', async () => {
  for (const mode of ['success', 'skip', 'failure', 'prompt']) {
    const events = []
    const logs = {
      interactive: true, start() {}, stop() {}, suspend() {}, resume() {}, record() {}, log() {}, show() { events.push('reveal') },
      setActivity(activity) { if (activity) { events.push('attach'); activity.resume() } }, resumeActivity() {},
    }
    const ctx = { flags: {}, logs, log: (line) => events.push(String(line)), createSpinnerImpl(label) {
      assert.equal(label, '⚙️  working…')
      events.push('create')
      return { pause() { events.push('pause') }, resume() { events.push('resume') }, stop() { events.push('stop') } }
    } }
    await runSteps([{ id: mode, title: 'Stage', interactive: mode === 'prompt',
      async check() { return { ok: mode === 'skip' } },
      async apply() { if (mode === 'failure') throw new Error('failed') },
    }], ctx)
    if (mode === 'prompt') assert.ok(!events.includes('create'))
    else {
      assert.ok(events.includes('create'))
      assert.ok(events.includes('stop'))
      if (mode === 'failure') assert.ok(events.indexOf('stop') < events.indexOf('reveal'))
    }
  }
})


test('CI and redirected output use plain progress without a timer', () => {
  for (const options of [{ output: { isTTY: false }, env: {} }, { output: { isTTY: true }, env: { CI: 'true' } }, { output: { isTTY: true }, env: { TERM: 'dumb' } }]) {
    const lines = []
    const spinner = createSpinner('working…', { ...options, log: (line) => lines.push(line), setIntervalImpl() { assert.fail('no animation in noninteractive output') } })
    spinner.stop('ok', 'done in 1s')
    assert.deepEqual(lines, ['   ... working…', '   ✅ done in 1s'])
  }
})


test('a log-file warning clears the working spinner before printing and then resumes', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-warning-'))
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }))
  const input = new EventEmitter()
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode() {}, resume() {}, pause() {} })
  const events = []
  const logs = createSetupLogs({ repoRoot, input, env: {}, output: { isTTY: true, write(line) { if (String(line).includes('Could not save')) events.push('warning') } } })
  logs.start()
  logs.setActivity({ pause: () => events.push('pause'), resume: () => events.push('resume'), stop() {} })
  events.length = 0
  fs.unlinkSync(logs.logFile)
  fs.mkdirSync(logs.logFile)
  logs.log('compiler output')
  assert.deepEqual(events, ['pause', 'warning', 'resume'])
  logs.stop()
})


test('provider instructions, choices and input prompts share the stage content margin', async () => {
  const source = fs.readFileSync(new URL('../providers.mjs', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('export async function ensureLlmProvider')).replace(/^export /, '')
  const lines = [], questions = []
  let closed = false
  const result = vm.runInNewContext(`${fn}\nensureLlmProvider('/tmp/prompt-format-test')`, {
    normalizeEnvTargets: () => ({ rootEnv: '/tmp/prompt-format-test' }), readEnvValue: () => null,
    LLM_PROVIDERS: [{ label: 'Local', keyEnv: 'LOCAL_TEST_KEY' }],
    process: { env: {}, stdin: { isTTY: true }, stdout: {} },
    console: { log: (line) => lines.push(line), warn() {} },
    readline: { createInterface: () => ({ question(question) { questions.push(question); throw new Error('stop at prompt') }, close() { closed = true } }) },
  })
  await assert.rejects(result, /stop at prompt/)
  assert.ok(lines.filter(Boolean).every((line) => line.startsWith('   ')))
  assert.ok(lines.some((line) => line === '   [ 1] Local'))
  assert.equal(questions[0], '   Choose a provider [0-1] (default 0): ')
  assert.equal(closed, true)
})


test('provider confirmations and synced values use the same margin as prompts', async (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-margin-'))
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(repoRoot, 'apps', 'mercato'), { recursive: true })
  fs.writeFileSync(path.join(repoRoot, '.env'), 'OM_AI_PROVIDER=openai\nOM_AI_MODEL=test-model\n')
  fs.writeFileSync(path.join(repoRoot, 'apps', 'mercato', '.env'), '')
  const lines = []
  await llmProviderStep.apply({ repoRoot, flags: {}, log: (line) => lines.push(line) })
  assert.ok(lines.some((line) => line.includes('synced')))
  assert.ok(lines.every((line) => /^ {3}\S/.test(line)), lines.join('\n'))
})
