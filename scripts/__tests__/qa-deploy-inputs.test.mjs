import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
