import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workflowPath = path.resolve('.github/workflows/community-labels.yml')

test('community label commands retain PR write permission and safety guards', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /^permissions:\n(?:  .+\n)*  pull-requests: write$/m)
  assert.match(workflow, /github\.event\.issue\.pull_request/)
  assert.match(workflow, /startsWith\(github\.event\.comment\.body, '\/label '\)/)
  assert.match(workflow, /const allowedLabels = new Set\(\[\s*'partner-request',\s*\]\)/)
  assert.doesNotMatch(workflow, /actions\/checkout@/)
})
