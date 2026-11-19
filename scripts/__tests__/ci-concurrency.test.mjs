import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))

function cancelsInProgress(eventName) {
  const expression = String(workflow.concurrency['cancel-in-progress'])
  const match = /^\$\{\{\s*github\.event_name\s*==\s*'([\w-]+)'\s*\}\}$/.exec(expression)
  assert.ok(match, `cancel-in-progress must compare github.event_name, got ${expression}`)
  return eventName === match[1]
}

test('CI runs share one concurrency group per ref', () => {
  assert.equal(workflow.concurrency.group, 'ci-${{ github.ref }}')
})

test('a new PR push cancels the in-progress PR run', () => {
  assert.equal(cancelsInProgress('pull_request'), true)
})

test('a branch push never cancels the running suite on main or a release line', () => {
  assert.equal(cancelsInProgress('push'), false)
})
