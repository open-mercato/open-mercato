import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const config = JSON.parse(fs.readFileSync(new URL('../../.ai/agentic.config.json', import.meta.url), 'utf8'))
const coreTeam = JSON.parse(fs.readFileSync(new URL('../../.github/core-team.json', import.meta.url), 'utf8'))

const hardBlocks = ['qa-failed', 'changes-requested', 'blocked', 'do-not-merge']
const reservedLabels = [
  'review', 'changes-requested', 'qa', 'blocked', 'do-not-merge', 'merge-queue',
  'qa-approved', 'qa-failed', 'qa-self-verified', 'in-progress', 'claim-reset', 'ci-monitoring',
  'needs-qa', 'skip-qa', 'automerge', 'automerge-now', 'automerge-force', 'automerge-prepare',
  'automerge-blocked', 'automerge-signal-1-cr', 'automerge-signal-2-qa', 'automerge-signal-3-ci',
  'automerge-signal-3-passes-local-ci-checks',
  ...config.labels.pipeline, ...config.labels.priority, ...config.labels.risk,
]
const labelPattern = /^[A-Za-z0-9._:/-]+$/
const branchPrefixPattern = /^[A-Za-z0-9._-]+\/$/

test('a missing qa-approved never blocks a merge: the per-PR QA gate is off', () => {
  assert.equal(config.qaGate, false)
})

test('qaGateLabel stays a non-empty string, as the om-review-pr loader requires', () => {
  assert.equal(typeof config.qaGateLabel, 'string')
  assert.ok(config.qaGateLabel.length > 0)
  assert.equal(config.qaReadyLabel, null)
})

test('hard blocks stay pipeline labels and stay excluded from automerge', () => {
  for (const label of ['qa-failed', 'blocked', 'do-not-merge']) {
    assert.ok(config.labels.pipeline.includes(label), label)
    assert.ok(config.automerge.eligibility.excludeLabels.includes(label), label)
  }
  assert.ok(config.labels.pipeline.includes('changes-requested'))
  assert.ok(hardBlocks.every((label) => config.labels.pipeline.includes(label)))
})

test('humanQaPolicy has the shape the QA triage loaders accept', () => {
  const policy = config.humanQaPolicy
  assert.equal(typeof policy, 'object')
  assert.equal(policy.batchCheckLabel, 'qa-batch-check')
  assert.ok(![...reservedLabels, config.qaGateLabel].includes(policy.batchCheckLabel))
  if ('whenUnsure' in policy) assert.ok(['human', 'auto', 'batch'].includes(policy.whenUnsure))
})

test('qaBatch matches the batch branch and tag conventions and reuses no reserved label', () => {
  const batch = config.qaBatch
  assert.equal(batch.branchPrefix, 'stabilize/')
  assert.equal(batch.greenTagPrefix, 'green/')
  assert.match(batch.branchPrefix, branchPrefixPattern)
  assert.match(batch.greenTagPrefix, branchPrefixPattern)
  assert.ok(Array.isArray(batch.bugLabels) && batch.bugLabels.length > 0)
  const batchLabels = [batch.inProgressLabel, batch.blockerLabel, ...batch.bugLabels]
  for (const label of batchLabels) {
    assert.equal(typeof label, 'string')
    assert.ok(label.length > 0)
    assert.ok(![...reservedLabels, config.qaGateLabel, config.humanQaPolicy.batchCheckLabel].includes(label), label)
  }
})

test('prTriage.acceptanceLabel is a valid label that is not a pipeline or QA label', () => {
  const label = config.prTriage.acceptanceLabel
  assert.equal(label, 'needs-triage')
  assert.match(label, labelPattern)
  const forbidden = ['qa-approved', 'qa-failed', 'merge-queue', 'review', 'changes-requested', 'blocked', 'do-not-merge', 'in-progress', 'needs-qa', 'skip-qa']
  assert.ok(!forbidden.includes(label))
})

test('the core-team list is a non-empty list of unique GitHub logins', () => {
  assert.ok(Array.isArray(coreTeam.logins) && coreTeam.logins.length > 0)
  for (const login of coreTeam.logins) assert.match(login, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
  const lowered = coreTeam.logins.map((login) => login.toLowerCase())
  assert.equal(new Set(lowered).size, lowered.length)
})
