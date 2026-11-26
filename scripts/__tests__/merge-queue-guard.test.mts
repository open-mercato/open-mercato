import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALWAYS_BLOCKING_LABELS,
  blockingLabels,
  decide,
  formatComment,
  run,
  type GuardContext,
  type GuardGithub,
} from '../ci/merge-queue-guard.mts'

test('each always-blocking label added to a queued PR removes merge-queue', () => {
  for (const label of ALWAYS_BLOCKING_LABELS) {
    const decision = decide({ action: 'labeled', label, labels: ['merge-queue', 'bug', label] })
    assert.deepEqual(decision, { remove: true, reason: `\`${label}\` was added` }, label)
  }
})

test('needs-human-qa added without qa-approved removes merge-queue', () => {
  const decision = decide({ action: 'labeled', label: 'needs-human-qa', labels: ['merge-queue', 'needs-human-qa'] })
  assert.deepEqual(decision, { remove: true, reason: '`needs-human-qa` without `qa-approved` was added' })
})

test('needs-human-qa added next to qa-approved keeps merge-queue', () => {
  const decision = decide({
    action: 'labeled',
    label: 'needs-human-qa',
    labels: ['merge-queue', 'needs-human-qa', 'qa-approved'],
  })
  assert.deepEqual(decision, { remove: false })
})

test('qa-approved removed while needs-human-qa is present removes merge-queue', () => {
  const decision = decide({ action: 'unlabeled', label: 'qa-approved', labels: ['merge-queue', 'needs-human-qa'] })
  assert.deepEqual(decision, {
    remove: true,
    reason: '`qa-approved` was removed while `needs-human-qa` is present',
  })
})

test('qa-approved removed from a PR without needs-human-qa keeps merge-queue', () => {
  assert.deepEqual(decide({ action: 'unlabeled', label: 'qa-approved', labels: ['merge-queue'] }), { remove: false })
})

test('merge-queue added while a blocker is present is taken off at once', () => {
  const decision = decide({
    action: 'labeled',
    label: 'merge-queue',
    labels: ['merge-queue', 'do-not-merge', 'needs-human-qa'],
  })
  assert.deepEqual(decision, {
    remove: true,
    reason: 'the PR already carries a blocking label (`do-not-merge`, `needs-human-qa` without `qa-approved`)',
  })
})

test('merge-queue added to a clean PR stays', () => {
  const labels = ['merge-queue', 'needs-human-qa', 'qa-approved', 'needs-qa', 'qa-batch-check']
  assert.deepEqual(decide({ action: 'labeled', label: 'merge-queue', labels }), { remove: false })
})

test('nothing happens when merge-queue is absent', () => {
  assert.deepEqual(decide({ action: 'labeled', label: 'blocked', labels: ['blocked'] }), { remove: false })
  assert.deepEqual(decide({ action: 'unlabeled', label: 'qa-approved', labels: ['needs-human-qa'] }), { remove: false })
})

test('a blocking label that is gone again by the time the guard runs keeps merge-queue', () => {
  assert.deepEqual(decide({ action: 'labeled', label: 'blocked', labels: ['merge-queue'] }), { remove: false })
})

test('unrelated label events keep merge-queue even next to an existing blocker', () => {
  const labels = ['merge-queue', 'blocked', 'bug']
  assert.deepEqual(decide({ action: 'labeled', label: 'bug', labels }), { remove: false })
  assert.deepEqual(decide({ action: 'unlabeled', label: 'review', labels }), { remove: false })
  assert.deepEqual(decide({ action: 'unlabeled', label: 'blocked', labels: ['merge-queue'] }), { remove: false })
})

test('blockingLabels lists only labels that break the merge-ready rule', () => {
  assert.deepEqual(blockingLabels(['needs-qa', 'review', 'qa-batch-check']), [])
  assert.deepEqual(blockingLabels(['needs-human-qa', 'qa-approved']), [])
  assert.deepEqual(blockingLabels(['blocked', 'needs-human-qa', 'qa-failed']), ['qa-failed', 'blocked', 'needs-human-qa'])
})

test('the comment is a single line naming merge-queue and the reason', () => {
  const comment = formatComment('`blocked` was added')
  assert.equal(comment.includes('\n'), false)
  assert.match(comment, /^Removed `merge-queue`: `blocked` was added, /)
})

type Call = { method: string; params: Record<string, unknown> }

function fakeGithub(labels: string[], { removeStatus }: { removeStatus?: number } = {}) {
  const calls: Call[] = []
  const github: GuardGithub = {
    rest: {
      issues: {
        listLabelsOnIssue: async (params) => {
          calls.push({ method: 'listLabelsOnIssue', params })
          return { data: labels.map((name) => ({ name })) }
        },
        removeLabel: async (params) => {
          calls.push({ method: 'removeLabel', params })
          if (removeStatus) throw Object.assign(new Error('fail'), { status: removeStatus })
          return {}
        },
        createComment: async (params) => {
          calls.push({ method: 'createComment', params })
          return {}
        },
      },
    },
  }
  return { github, calls }
}

function fakeContext(action: string, label: string): GuardContext {
  return { repo: { owner: 'o', repo: 'r' }, payload: { action, label: { name: label }, pull_request: { number: 7 } } }
}

const core = { info: () => {} }

test('run removes only merge-queue and comments once, reading fresh labels', async () => {
  const { github, calls } = fakeGithub(['merge-queue', 'qa-failed'])
  const decision = await run({ github, context: fakeContext('labeled', 'qa-failed'), core })
  assert.equal(decision.remove, true)
  assert.deepEqual(
    calls.map((call) => call.method),
    ['listLabelsOnIssue', 'removeLabel', 'createComment'],
  )
  assert.deepEqual(calls[1].params, { owner: 'o', repo: 'r', issue_number: 7, name: 'merge-queue' })
  assert.equal(calls[2].params.body, formatComment('`qa-failed` was added'))
})

test('run leaves labels alone when the rule holds', async () => {
  const { github, calls } = fakeGithub(['merge-queue', 'needs-human-qa', 'qa-approved'])
  await run({ github, context: fakeContext('labeled', 'merge-queue'), core })
  assert.deepEqual(calls.map((call) => call.method), ['listLabelsOnIssue'])
})

test('run skips the comment when merge-queue was already removed concurrently', async () => {
  const { github, calls } = fakeGithub(['merge-queue', 'blocked'], { removeStatus: 404 })
  const decision = await run({ github, context: fakeContext('labeled', 'blocked'), core })
  assert.deepEqual(decision, { remove: false })
  assert.deepEqual(calls.map((call) => call.method), ['listLabelsOnIssue', 'removeLabel'])
})

test('run rethrows unexpected API errors', async () => {
  const { github } = fakeGithub(['merge-queue', 'blocked'], { removeStatus: 500 })
  await assert.rejects(run({ github, context: fakeContext('labeled', 'blocked'), core }), /fail/)
})

test('run ignores events that are not pull request label changes', async () => {
  const { github, calls } = fakeGithub(['merge-queue', 'blocked'])
  await run({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened' } }, core })
  assert.deepEqual(calls, [])
})
