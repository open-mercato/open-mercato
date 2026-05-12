import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workflowPath = path.resolve('.github/workflows/release.yml')

function extractNamedRunStep(workflow, stepName) {
  const marker = `- name: ${stepName}`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `Expected workflow to contain step "${stepName}"`)

  const nextStep = workflow.indexOf('\n      - name:', start + marker.length)
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep)
}

test('release existing mode skips committing version changes', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8')
  const commitStep = extractNamedRunStep(workflow, 'Commit version changes')

  const existingGuardIndex = commitStep.indexOf('if [ "${{ inputs.bump }}" = "existing" ]; then')
  const gitAddIndex = commitStep.indexOf('git add -A')

  assert.notEqual(existingGuardIndex, -1, 'Commit step should guard existing releases')
  assert.notEqual(gitAddIndex, -1, 'Commit step should keep staging version changes for bump releases')
  assert.ok(existingGuardIndex < gitAddIndex, 'Existing release guard must run before staging files')
  assert.match(commitStep, /Existing release mode uses committed versions as-is; skipping version commit/)
  assert.match(commitStep, /exit 0/)
})
