import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

function readWorkflow(name) {
  return parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))
}

const workflow = readWorkflow('qa-deploy')
const steps = workflow.jobs.deploy.steps
const getStep = (name) => {
  const step = steps.find((candidate) => candidate.name === name)
  assert.ok(step, `Missing deploy step: ${name}`)
  return step
}
const validate = getStep('Validate PR number (optional)')
const label = getStep('Add QA label to PR')
const comment = getStep('Comment on PR with QA marker')
const rawPr = '${{ github.event.inputs.pr_number }}'
const normalizedPr = '${{ steps.validate_pr.outputs.pr_number }}'
const slotOutput = '${{ steps.meta.outputs.slot }}'
const imageOutput = '${{ steps.meta.outputs.image_full }}'
const branchInput = '${{ github.event.inputs.branch }}'

test('QA dispatch passes inputs as data and keeps PR association optional', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.on.workflow_dispatch.inputs.pr_number.required, false)
  for (const step of [validate, label, comment]) {
    assert.equal(step.if, "${{ github.event.inputs.pr_number != '' }}")
  }
  assert.equal(validate.id, 'validate_pr')
  assert.equal(validate.shell, 'bash')
  assert.deepEqual(validate.env, { PR_NUMBER: rawPr })
  assert.deepEqual(getStep('Compute image metadata').env, { SLOT: '${{ github.event.inputs.slot }}' })
  assert.deepEqual(getStep('Resolve Dokploy applicationId').env, { SLOT: slotOutput })
  assert.equal(getStep('Checkout selected branch').with.ref, branchInput)
  assert.deepEqual(label.env, { PR_NUMBER: normalizedPr, SLOT: slotOutput })
  assert.deepEqual(comment.env, { PR_NUMBER: normalizedPr, SLOT: slotOutput, IMAGE: imageOutput, BRANCH: branchInput })
  for (const step of [label, comment]) {
    assert.match(step.with.script, /Number\(process\.env\.PR_NUMBER\)/)
    assert.doesNotMatch(step.with.script, /\$\{\{/)
  }
  for (const step of steps) {
    assert.doesNotMatch(step.run ?? '', /\$\{\{\s*(?:github\.event\.inputs\.|steps\.(?:meta|validate_pr)\.outputs\.)/)
  }
  for (const name of ['Login to GHCR', 'Build and push Docker image', 'Update image in Dokploy', 'Trigger Dokploy deploy']) {
    assert.ok(steps.indexOf(validate) < steps.indexOf(getStep(name)))
    assert.equal(getStep(name).if, undefined)
  }
  assert.equal(workflow.concurrency.group, 'dokploy-${{ github.event.inputs.slot }}')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.deepEqual(workflow.permissions, {
    contents: 'read', packages: 'write', 'pull-requests': 'write', issues: 'write', actions: 'read',
  })
  const dokployEnv = {
    DOKPLOY_URL: '${{ secrets.DOKPLOY_URL }}',
    DOKPLOY_API_KEY: '${{ secrets.DOKPLOY_API_KEY }}',
    APP_ID: '${{ steps.app.outputs.application_id }}',
  }
  assert.deepEqual(getStep('Trigger Dokploy deploy').env, dokployEnv)
  assert.deepEqual(getStep('Update image in Dokploy').env, {
    ...dokployEnv,
    DOCKER_IMAGE: imageOutput,
    GHCR_USERNAME: '${{ secrets.GHCR_USERNAME }}',
    GHCR_TOKEN: '${{ secrets.GHCR_TOKEN }}',
  })
})

test('QA validates and normalizes positive safe-integer PR numbers', (t) => {
  assert.doesNotMatch(validate.run, /\$\{\{/)
  const directory = mkdtempSync(join(tmpdir(), 'qa-dispatch-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const output = join(directory, 'output')
  const cases = [
    ['123', '123'],
    ['000123', '123'],
    ['0009007199254740991', '9007199254740991'],
    ['0', null],
    ['000', null],
    ['-1', null],
    ['1.5', null],
    ['12x', null],
    ['12\n34', null],
    ['9007199254740992', null],
    ['10000000000000000', null],
  ]
  for (const [input, expected] of cases) {
    writeFileSync(output, '')
    const result = spawnSync('bash', ['-c', validate.run], {
      env: { PATH: process.env.PATH, PR_NUMBER: input, GITHUB_OUTPUT: output },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.ifError(result.error)
    const description = `PR input ${JSON.stringify(input)}`
    assert.equal(result.status, expected === null ? 1 : 0, description)
    assert.equal(readFileSync(output, 'utf8'), expected === null ? '' : `pr_number=${expected}\n`, description)
  }
})

test('QA labels and comments use literal values and the cleanup workflow reads the marker', async () => {
  const context = { repo: { owner: 'example', repo: 'mercato' }, payload: { pull_request: { number: 123 } } }
  const env = { PR_NUMBER: '123', SLOT: 'qa2', IMAGE: 'ghcr.io/example/mercato:qa2-abcdef0', BRANCH: 'qa/quotes-"and-\x27$&' }
  const labels = []
  const comments = []
  const issues = {
    addLabels: async (payload) => labels.push(payload),
    createComment: async (payload) => comments.push(payload),
    listComments: async () => comments,
  }
  const github = { rest: { issues }, paginate: async (listComments) => listComments() }
  for (const step of [label, comment]) {
    await vm.runInNewContext(`(async () => { ${step.with.script} })()`, { context, github, process: { env } })
  }
  const expectedTarget = { ...context.repo, issue_number: 123 }
  assert.deepEqual(JSON.parse(JSON.stringify(labels)), [{ ...expectedTarget, labels: ['qa:qa2'] }])
  assert.deepEqual({ ...comments[0] }, {
    ...expectedTarget,
    body: [
      `<!-- dokploy-qa slot=qa2 image=${env.IMAGE} -->`,
      '🚀 Deployed to **qa2**',
      '',
      `- Image: \`${env.IMAGE}\``,
      `- Branch: \`${env.BRANCH}\``,
    ].join('\n'),
  })
  assert.equal(comments.length, 1)

  const cleanup = Object.values(readWorkflow('qa-stop-on-merge').jobs)
    .flatMap((job) => job.steps)
    .find((step) => step.id === 'expected')
  assert.ok(cleanup)
  const outputs = new Map()
  const core = { info() {}, setOutput: (key, value) => outputs.set(key, value) }
  const cleanupScript = cleanup.with.script.replace('${{ steps.slot.outputs.slot }}', env.SLOT)
  await vm.runInNewContext(`(async () => { ${cleanupScript} })()`, { context, github, core })
  assert.deepEqual([...outputs], [['image', env.IMAGE]])
})
