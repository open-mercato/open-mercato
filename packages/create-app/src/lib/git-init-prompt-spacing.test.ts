import assert from 'node:assert/strict'
import test from 'node:test'
import { promptForGitInitialization } from '../index.ts'

const PROMPT_MARKER = 'ask> '

async function runGitInitPrompt(answers: string[]): Promise<{ result: boolean, output: string[] }> {
  const output: string[] = []
  const originalLog = console.log
  const queuedAnswers = [...answers]

  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' '))
  }

  try {
    const result = await promptForGitInitialization(async (question) => {
      output.push(`${PROMPT_MARKER}${question}`)
      return queuedAnswers.shift() ?? ''
    })

    return { result, output }
  } finally {
    console.log = originalLog
  }
}

test('accepting the Git prompt prints a blank line after the answer', async () => {
  const { result, output } = await runGitInitPrompt(['y'])

  assert.equal(result, true)
  assert.equal(output.at(-1), '')
  assert.ok(output.at(-2)?.startsWith(PROMPT_MARKER))
})

test('declining the Git prompt prints a blank line after the answer', async () => {
  const { result, output } = await runGitInitPrompt(['n'])

  assert.equal(result, false)
  assert.equal(output.at(-1), '')
  assert.ok(output.at(-2)?.startsWith(PROMPT_MARKER))
})

test('an unusable answer re-prompts and the blank line follows the accepted answer', async () => {
  const { result, output } = await runGitInitPrompt(['maybe', 'y'])

  assert.equal(result, true)
  assert.equal(output.filter((line) => line.startsWith(PROMPT_MARKER)).length, 2)
  assert.ok(output.some((line) => line.includes('Unknown answer "maybe"')))
  assert.equal(output.at(-1), '')
  assert.ok(output.at(-2)?.startsWith(PROMPT_MARKER))
})
