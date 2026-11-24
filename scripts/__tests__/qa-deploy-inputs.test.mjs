import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseDocument } from 'yaml'

const source = readFileSync(new URL('../../.github/workflows/qa-deploy.yml', import.meta.url), 'utf8')
const steps = parseDocument(source).toJS().jobs.deploy.steps

test('QA deployment evaluates inputs as environment data and preserves the checkout input', () => {
  assert.equal(steps.find((step) => step.name === 'Checkout selected branch').with.ref, '${{ github.event.inputs.branch }}')
  assert.equal(steps.find((step) => step.name === 'Validate PR number (optional)').env.PR_NUMBER, '${{ inputs.pr_number }}')
  assert.equal(steps.find((step) => step.name === 'Comment on PR with QA marker').env.QA_BRANCH, '${{ inputs.branch }}')
  for (const step of steps) {
    assert.doesNotMatch(step.run ?? '', /\$\{\{/)
    assert.doesNotMatch(step.with?.script ?? '', /\$\{\{/)
  }
})

const bashAvailable = spawnSync('bash', ['--version'], { timeout: 5000 }).status === 0
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function runShellStep(name, env) {
  const step = steps.find((candidate) => candidate.name === name)
  return spawnSync('bash', ['--noprofile', '--norc', '-c', step.run], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    encoding: 'utf8',
    timeout: 5000,
  })
}

test('QA workflow validates the PR number and sends the resolved slot and image to PR bookkeeping', { skip: !bashAvailable }, async () => {
  const accepted = runShellStep('Validate PR number (optional)', { PR_NUMBER: '1234' })
  assert.equal(accepted.status, 0, accepted.error?.message ?? accepted.stderr)

  const refused = runShellStep('Validate PR number (optional)', { PR_NUMBER: 'invalid' })
  assert.equal(refused.status, 1)
  assert.match(refused.stdout, /pr_number must be a positive integer/)

  const directory = mkdtempSync(join(tmpdir(), 'om-qa-workflow-'))
  const output = join(directory, 'github-output')
  try {
    const metadata = runShellStep('Compute image metadata', {
      SLOT: 'qa2',
      GITHUB_SHA: '123456789abcdef',
      REGISTRY: 'ghcr.io',
      IMAGE_NAME: 'example/fixture',
      GITHUB_OUTPUT: output,
    })
    assert.equal(metadata.status, 0, metadata.error?.message ?? metadata.stderr)
    const values = Object.fromEntries(
      readFileSync(output, 'utf8').trimEnd().split('\n').map(line => line.split('=')),
    )
    assert.equal(values.image_full, 'ghcr.io/example/fixture:qa2-1234567')

    const recorded = []
    const github = {
      rest: { issues: {
        addLabels: async (payload) => { recorded.push(['labels', payload]) },
        createComment: async (payload) => { recorded.push(['comment', payload]) },
      } },
    }
    const repo = { owner: 'example', repo: 'fixture' }
    const env = {
      PR_NUMBER: '1234',
      QA_SLOT: values.slot,
      QA_IMAGE: values.image_full,
      QA_BRANCH: 'release/example',
    }

    for (const name of ['Add QA label to PR', 'Comment on PR with QA marker']) {
      const step = steps.find((candidate) => candidate.name === name)
      const run = new AsyncFunction('process', 'github', 'context', step.with.script)
      await run({ env }, github, { repo })
    }

    assert.deepEqual(recorded, [
      ['labels', { ...repo, issue_number: 1234, labels: ['qa:qa2'] }],
      ['comment', {
        ...repo,
        issue_number: 1234,
        body: [
          '<!-- dokploy-qa slot=qa2 image=ghcr.io/example/fixture:qa2-1234567 -->',
          '🚀 Deployed to **qa2**',
          '',
          '- Image: `ghcr.io/example/fixture:qa2-1234567`',
          '- Branch: `release/example`',
        ].join('\n'),
      }],
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
