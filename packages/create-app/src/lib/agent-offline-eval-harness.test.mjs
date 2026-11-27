import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../../agentic/', import.meta.url)
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8')

test('offline eval routing delivers the native CI contract through one owner', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json'))
  const entry = cases.find((candidate) => candidate.id === 'OMH-242')
  assert.ok(entry, 'offline native eval CI requires its own routing regression case')
  assert.equal(entry.evaluationKind, 'routing')
  assert.equal(entry.owner.path, '.ai/skills/om-create-ai-agent/references/surface-selector.md')
  assert.deepEqual(entry.relatedCases, ['OMH-049', 'OMH-051'])
  assert.deepEqual(entry.requiredDecisions, [
    'installed-eval-cli-first', 'synthetic-record-before-offline-replay', 'replay-alone-live-model',
    'error-on-miss-no-live-fallback', 'tenant-org-eval-scope', 'per-case-per-trial-model-tools',
    'private-decrypted-fixtures', 'reject-opencode-offline', 'invalidate-schema-call-sequence',
    'runtime-proof-not-helper-only',
  ])
  const forbidden = entry.forbiddenPatterns.map((pattern) => new RegExp(pattern, 'i'))
  for (const unsafe of [
    'OM_AI_SCRIPTED_MODEL=true', '--on-fixture-miss live', 'edit node_modules',
    'use production credentials', 'helper-only checks proves full runtime correctness',
  ]) assert.ok(forbidden.some((pattern) => pattern.test(unsafe)), `must reject unsafe advice: ${unsafe}`)
  assert.ok(forbidden.every((pattern) => !pattern.test('--replay evals/fixtures --offline true --on-fixture-miss error')))

  const owner = read('shared/ai/skills/om-create-ai-agent/references/surface-selector.md')
  for (const required of [
    '--record', '--replay', '--offline true', '--on-fixture-miss error', '--tenant', '--org',
    '<caseKey>.<trialIndex>.model.json', '<caseKey>.tools.json', '<caseKey>.<trialIndex>.tools.json',
    'onMiss: error', 'schema', 'OpenCode', 'decrypted', 'synthetic', 'OM_AI_SCRIPTED_',
    'helper-only', 'still calls the live model', 'node_modules',
  ]) assert.ok(owner.includes(required), `offline eval owner must explain ${required}`)
  assert.match(owner, /installed.*CLI/i)
  assert.match(read('guides/ai-workflows.md'), /surface-selector\.md.*offline/i)
  assert.match(read('shared/ai/skills/om-create-ai-agent/SKILL.md'), /offline.*surface-selector\.md/i)
  const matrix = JSON.parse(read('shared/ai/harness/release-matrix.json'))
  assert.equal(matrix.routing.required.caseIds, 'all')
  assert.ok(!matrix.writable.some((item) => item.caseId === entry.id))
})
