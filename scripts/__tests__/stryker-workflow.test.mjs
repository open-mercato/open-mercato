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
  assert.equal(workflow.jobs.mutate['timeout-minutes'], 60)
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

test('reports the survivor list even when the mutation step failed', () => {
  const reportStep = workflow.jobs.mutate.steps.find(
    (step) => step.name === 'Write the survivor report to the job summary',
  )

  assert.equal(reportStep.if, 'always()')
  assert.match(reportStep.run, /scripts\/stryker\/report\.mjs/)
  assert.match(reportStep.run, /--package/)
})

test('passes --enforced to the report only when enforcement is on', () => {
  const reportStep = workflow.jobs.mutate.steps.find(
    (step) => step.name === 'Write the survivor report to the job summary',
  )

  // The conditional moved into env: so no GitHub expression is expanded into the
  // run: script; the flag it resolves to is unchanged.
  assert.match(reportStep.env.ENFORCED, /MUTATION_ENFORCE == 'true' && '--enforced'/)
  assert.match(reportStep.run, /\$\{ENFORCED\}/)
})

test('uploads the mutation report as an artifact, tolerating an absent report', () => {
  const uploadStep = workflow.jobs.mutate.steps.find(
    (step) => step.name === 'Upload the mutation report',
  )

  assert.equal(uploadStep.if, 'always()')
  assert.match(uploadStep.uses, /actions\/upload-artifact/)
  assert.equal(uploadStep.with['if-no-files-found'], 'ignore')
  assert.match(uploadStep.with.name, /mutation-report-/)
})

test('the PR comment job is fork-guarded — fork runs get no write token', () => {
  const condition = workflow.jobs.comment.if

  assert.match(condition, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
})

test('only the comment job may write, and the mutate job stays read-only', () => {
  assert.deepEqual(workflow.jobs.comment.permissions, {
    contents: 'read',
    'pull-requests': 'write',
  })
  assert.equal(workflow.jobs.mutate.permissions, undefined)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
})

test('the comment is idempotent — it updates its marker comment instead of appending', () => {
  const step = workflow.jobs.comment.steps.find(
    (candidate) => candidate.name === 'Post or update the mutation comment',
  )

  assert.match(step.run, /om:mutation-testing-report/)
  assert.match(step.run, /--method PATCH/)
  assert.match(step.run, /--method POST/)
  assert.match(step.run, /select\(\.body \| contains/)
})

test('the comment job still runs when the mutation job failed', () => {
  assert.match(workflow.jobs.comment.if, /always\(\)/)
  assert.deepEqual(workflow.jobs.comment.needs, ['scope', 'mutate'])
})

test('the comment job is skipped when nothing was in scope', () => {
  assert.match(workflow.jobs.comment.if, /needs\.scope\.outputs\.has_work == 'true'/)
})

test('the enforcement step runs and is fed MUTATION_ENFORCE, defaulting to false', () => {
  const step = workflow.jobs.mutate.steps.find(
    (candidate) => candidate.name === 'Enforce the mutation threshold',
  )

  assert.equal(step.if, 'always()')
  assert.match(step.run, /scripts\/stryker\/enforce\.mjs/)
  assert.match(String(step.env.MUTATION_ENFORCE), /\|\|\s*'false'/)
})

test('never interpolates a GitHub expression into a run: script', () => {
  const offenders = []

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string') continue
      if (!step.run.includes('${{')) continue
      offenders.push(`${jobName} → ${step.name ?? step.id ?? 'unnamed step'}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a ${{ }} expression inside run: is expanded as shell source before bash parses ' +
      'it, so an untrusted value becomes code — pass it through env: instead. ' +
      `Offending steps: ${offenders.join(', ')}`,
  )
})

test('passes the diff-derived mutate list through the environment, quoted', () => {
  const mutateStep = workflow.jobs.mutate.steps.find((step) => step.id === 'mutate')

  assert.equal(mutateStep.env.MUTATE_LIST, '${{ matrix.mutate }}')
  assert.match(mutateStep.run, /--mutate "\$MUTATE_LIST"/)
})

test('exposes a workflow_dispatch trigger so the mutate job can be proven on demand', () => {
  const dispatch = (workflow.on ?? workflow[true]).workflow_dispatch

  assert.ok(dispatch, 'workflow_dispatch is what makes the runner path executable on demand')
  assert.ok(dispatch.inputs.package, 'a dispatch must be able to name the package')
  assert.ok(dispatch.inputs.mutate, 'a dispatch must be able to name the files to mutate')
})

test('the scope job routes a dispatch selection through scope.mjs rather than trusting it', () => {
  const scopeStep = workflow.jobs.scope.steps.find((step) => step.id === 'scope')

  assert.equal(scopeStep.env.DISPATCH_PACKAGE, '${{ inputs.package }}')
  assert.equal(scopeStep.env.DISPATCH_MUTATE, '${{ inputs.mutate }}')
  assert.match(scopeStep.run, /scope\.mjs --package "\$\{DISPATCH_PACKAGE\}"/)
})

test('the scope job branches on the event, not on whether dispatch inputs are populated', () => {
  const scopeStep = workflow.jobs.scope.steps.find((step) => step.id === 'scope')

  // A dispatch with cleared inputs must skip cleanly rather than diff against an
  // empty base ref and redden the one job allowed to go red.
  assert.equal(scopeStep.env.IS_DISPATCH, "${{ github.event_name == 'workflow_dispatch' }}")
  assert.match(scopeStep.run, /if \[ "\$\{IS_DISPATCH\}" = "true" \]/)
})

test('the advisory comment job cannot turn an infrastructure hiccup into a merge blocker', () => {
  assert.equal(workflow.jobs.comment['continue-on-error'], true)
})

test('the scope job stays loud, so a misconfigured gate cannot silently no-op', () => {
  assert.equal(workflow.jobs.scope['continue-on-error'], undefined)
})
