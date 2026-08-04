import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const workflowPath = `${repositoryRoot}.github/workflows/mutation-tests.yml`
const workflow = parse(fs.readFileSync(workflowPath, 'utf8'))

test('is a standalone workflow, separate from ci.yml', () => {
  assert.ok(fs.existsSync(workflowPath))
  assert.equal(workflow.name, 'Mutation tests')

  const ciWorkflow = fs.readFileSync(`${repositoryRoot}.github/workflows/ci.yml`, 'utf8')
  assert.ok(
    !ciWorkflow.includes('mutation'),
    'ci.yml must not reference mutation testing — rollback is deleting one file',
  )
})

test('runs on pull requests to the long-lived branches only', () => {
  const on = workflow.on ?? workflow[true]
  assert.deepEqual(on.pull_request.branches, ['main', 'develop'])
  assert.equal(on.push, undefined, 'a push trigger would score merges, not changes')
})

test('the mutate job is advisory unless MUTATION_ENFORCE is explicitly true', () => {
  const continueOnError = String(workflow.jobs.mutate['continue-on-error'])

  assert.match(continueOnError, /MUTATION_ENFORCE/)
  assert.match(continueOnError, /!= 'true'/)
})

test('MUTATION_ENFORCE defaults to false, so the gate ships dormant', () => {
  assert.match(String(workflow.env.MUTATION_ENFORCE), /\|\|\s*'false'/)
})

test('skips entirely when the diff contains nothing in scope', () => {
  assert.equal(workflow.jobs.mutate.if, "needs.scope.outputs.has_work == 'true'")
})

test('one slow package never hides another, and a run is time-bounded', () => {
  assert.equal(workflow.jobs.mutate.strategy['fail-fast'], false)
  assert.equal(workflow.jobs.mutate['timeout-minutes'], 20)
})

test('fans out over the matrix the scope job computed', () => {
  assert.equal(workflow.jobs.mutate.strategy.matrix, '${{ fromJson(needs.scope.outputs.matrix) }}')
  assert.deepEqual(workflow.jobs.mutate.needs, 'scope')
})

test('requests no write permissions — it must work on fork pull requests', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' })
})

test('builds packages before mutating, because suites resolve siblings via dist/', () => {
  const steps = workflow.jobs.mutate.steps.map((step) => step.name)
  const buildIndex = steps.indexOf('Build packages')
  const runIndex = steps.indexOf('Run mutation testing')

  assert.ok(buildIndex >= 0, 'the mutate job must build packages')
  assert.ok(buildIndex < runIndex, 'the build must precede the mutation run')
})

test('checks out full history so the base ref is resolvable for the diff', () => {
  const checkout = workflow.jobs.scope.steps.find((step) => step.name === 'Checkout repository')

  assert.equal(checkout.with['fetch-depth'], 0)
})
