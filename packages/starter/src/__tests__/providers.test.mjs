import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LLM_PROVIDERS } from '../providers.mjs'

const providerModule = new URL('../providers.mjs', import.meta.url).href
const stepsModule = new URL('../steps.mjs', import.meta.url).href

async function runProvider({ interactive = false, options = {}, answers = [], rootContents = 'EXISTING=keep\n', appContents = 'APP_EXISTING=keep\n', ambient = {}, step = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-starter-provider-'))
  const rootEnv = path.join(root, '.env')
  const appEnv = path.join(root, 'apps', 'mercato', '.env')
  fs.mkdirSync(path.dirname(appEnv), { recursive: true })
  fs.writeFileSync(rootEnv, rootContents)
  fs.writeFileSync(appEnv, appContents)
  const env = { ...process.env }
  for (const entry of LLM_PROVIDERS) {
    delete env[entry.keyEnv]
    if (entry.baseUrlEnv) delete env[entry.baseUrlEnv]
  }
  Object.assign(env, ambient, {
    OM_TEST_PROVIDER_INPUT: JSON.stringify({ providerModule, stepsModule, interactive, files: { rootEnv, appEnv }, options, step, repoRoot: root }),
  })
  const script = `
    const input = JSON.parse(process.env.OM_TEST_PROVIDER_INPUT)
    const { ensureLlmProvider } = await import(input.providerModule)
    const { llmProviderStep, runSteps } = await import(input.stepsModule)
    Object.defineProperty(process.stdin, 'isTTY', { value: input.interactive })
    const outcome = input.step
      ? await runSteps([llmProviderStep, { id: 'next', title: 'Next step', apply: async () => console.log('NEXT_STEP_REACHED') }], { repoRoot: input.repoRoot, flags: { nonInteractive: true }, log: console.log })
      : await ensureLlmProvider(input.files, input.options)
    console.log('PROVIDER_RESULT=' + JSON.stringify(outcome))
  `
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['pipe', 'pipe', 'pipe'] })
      let combined = ''
      let promptOutput = ''
      let nextAnswer = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Provider prompt did not finish: ${combined}`))
      }, 5000)
      child.stdout.on('data', (chunk) => {
        combined += chunk
        promptOutput += chunk
        const pending = answers[nextAnswer]
        if (pending && promptOutput.includes(pending.prompt)) {
          promptOutput = ''
          nextAnswer += 1
          child.stdin.write(`${pending.answer}\n`)
        }
      })
      child.stderr.on('data', (chunk) => { combined += chunk })
      child.on('error', (error) => { clearTimeout(timeout); reject(error) })
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) reject(new Error(`Provider child exited ${code}: ${combined}`))
        else resolve(combined)
      })
    })
    const match = output.match(/PROVIDER_RESULT=(.*)/)
    assert.ok(match, output)
    return {
      outcome: JSON.parse(match[1]),
      output,
      rootContents: fs.readFileSync(rootEnv, 'utf8'),
      appContents: fs.readFileSync(appEnv, 'utf8'),
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

for (const scenario of [
  { name: 'non-interactive flag', options: { nonInteractive: true } },
  { name: 'non-TTY input', options: {} },
  { name: 'explicit skip flag', options: { skipPrompt: true }, interactive: true },
]) {
  test(`optional provider setup continues without credentials with ${scenario.name}`, async () => {
    const result = await runProvider(scenario)
    assert.equal(result.outcome, 'skipped')
    assert.equal(result.rootContents, 'EXISTING=keep\n')
    assert.equal(result.appContents, 'APP_EXISTING=keep\n')
    assert.match(result.output, /continuing without AI/i)
    assert.doesNotMatch(result.output, /Choose a provider/)
  })
}

for (const answer of ['', '0']) {
  test(`interactive provider selection ${JSON.stringify(answer)} skips without changing environment files`, async () => {
    const result = await runProvider({ interactive: true, answers: [{ prompt: 'Choose a provider', answer }] })
    assert.equal(result.outcome, 'skipped')
    assert.match(result.output, /\[ 0\] Skip for now/)
    assert.equal(result.rootContents, 'EXISTING=keep\n')
    assert.equal(result.appContents, 'APP_EXISTING=keep\n')
  })
}

test('an empty required API key skips AI instead of trapping setup in the provider menu', async () => {
  const result = await runProvider({
    interactive: true,
    answers: [{ prompt: 'Choose a provider', answer: '1' }, { prompt: 'Paste your OpenAI API key', answer: '' }],
  })
  assert.equal(result.outcome, 'skipped')
  assert.equal(result.rootContents, 'EXISTING=keep\n')
  assert.equal(result.appContents, 'APP_EXISTING=keep\n')
  assert.doesNotMatch(result.output, /Try again/)
})

test('configured provider still synchronizes the app environment when prompting is skipped', async () => {
  const result = await runProvider({
    options: { skipPrompt: true },
    rootContents: 'OM_AI_PROVIDER=azure\nOM_AI_MODEL=fixture-deployment\nAZURE_OPENAI_API_KEY=fixture-key\n',
    appContents: 'OM_AI_PROVIDER=openai\nAZURE_OPENAI_API_KEY=\n',
  })
  assert.equal(result.outcome, 'configured')
  assert.match(result.appContents, /OM_AI_PROVIDER=azure/)
  assert.match(result.appContents, /AZURE_OPENAI_API_KEY=fixture-key/)
  assert.doesNotMatch(result.output, /fixture-key/)
})

test('optional AI setup lets the following startup step run without credentials', async () => {
  const result = await runProvider({ step: true })
  assert.equal(result.outcome.ok, true)
  assert.match(result.output, /NEXT_STEP_REACHED/)
  assert.equal(result.rootContents, 'EXISTING=keep\n')
})


test('a user can still configure a provider interactively and synchronize the app environment', async () => {
  const result = await runProvider({
    interactive: true,
    answers: [
      { prompt: 'Choose a provider', answer: '1' },
      { prompt: 'Paste your OpenAI API key', answer: 'fixture-interactive-key' },
      { prompt: 'OpenAI base URL', answer: '' },
      { prompt: 'OpenAI model', answer: '' },
    ],
  })
  assert.equal(result.outcome, 'configured')
  assert.match(result.rootContents, /OPENAI_API_KEY=fixture-interactive-key/)
  assert.match(result.appContents, /OM_AI_PROVIDER=openai/)
  assert.match(result.appContents, /OPENAI_API_KEY=fixture-interactive-key/)
  assert.doesNotMatch(result.output, /fixture-interactive-key/)
})


test('optional AI skip output separates its warning with a blank line and wide-glyph spacing', async () => {
  const result = await runProvider({ step: true })
  assert.match(result.output, /\n[ \t]*\n[ \t]*❗ Continuing without AI/)
})
