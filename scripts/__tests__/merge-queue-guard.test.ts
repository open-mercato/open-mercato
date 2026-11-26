import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import {
  ALWAYS_BLOCKING_LABELS,
  blockingLabels,
  decide,
  formatComment,
  formatLogLine,
  formatSummary,
  keepReason,
  run,
  type GuardContext,
  type GuardCore,
  type GuardGithub,
  type GuardReport,
} from '../ci/merge-queue-guard.mts'

test('the workflow never coalesces pending label events', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/merge-queue-guard.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /^\s*concurrency:/m)
})

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

function fakeContext(action: string, label: string, sender = 'alice'): GuardContext {
  return {
    repo: { owner: 'o', repo: 'r' },
    payload: { action, label: { name: label }, pull_request: { number: 7 }, sender: { login: sender } },
  }
}

function fakeCore() {
  const logs: string[] = []
  const summaries: string[] = []
  let written = 0
  const core: GuardCore = {
    info: (message) => logs.push(message),
    summary: {
      addRaw: (text) => summaries.push(text),
      write: async () => {
        written += 1
      },
    },
  }
  return { core, logs, summaries, written: () => written }
}

const core = fakeCore().core
const now = () => new Date('2026-11-26T10:00:00.000Z')

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

test('run rethrows unexpected API errors after writing a failure summary', async () => {
  const recorder = fakeCore()
  const { github } = fakeGithub(['merge-queue', 'blocked'], { removeStatus: 500 })
  await assert.rejects(run({ github, context: fakeContext('labeled', 'blocked'), core: recorder.core, now }), /fail/)
  assert.equal(recorder.summaries.length, 1)
  assert.equal(recorder.written(), 1)
  assert.match(recorder.summaries[0], /^## .*The guard failed on #7\n/)
  assert.match(recorder.summaries[0], /\| Decision \| \*\*guard failed\*\* \|/)
  assert.match(recorder.summaries[0], /the guard stopped with an error \(fail\)/)
  assert.match(recorder.logs[0], /^#7: guard failed/)
})

test('run ignores events that are not pull request label changes', async () => {
  const { github, calls } = fakeGithub(['merge-queue', 'blocked'])
  await run({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { action: 'opened' } }, core })
  assert.deepEqual(calls, [])
})

test('every run writes one job summary and one log line', async () => {
  const recorder = fakeCore()
  const { github } = fakeGithub(['merge-queue', 'qa-failed'])
  await run({ github, context: fakeContext('labeled', 'qa-failed'), core: recorder.core, now })
  assert.equal(recorder.summaries.length, 1)
  assert.equal(recorder.written(), 1)
  assert.equal(recorder.logs.length, 1)
  assert.match(recorder.summaries[0], /^## .*Removed `merge-queue` from #7\n/)
  assert.match(recorder.summaries[0], /\| Pull request \| \[#7\]\(https:\/\/github\.com\/o\/r\/pull\/7\) \|/)
  assert.match(recorder.summaries[0], /\| Event \| labeled `qa-failed` by alice \|/)
  assert.match(recorder.summaries[0], /\| Decision \| \*\*removed `merge-queue`\*\* \|/)
  assert.match(recorder.logs[0], /^#7: removed merge-queue \(qa-failed was added\)/)
})

test('a run that keeps merge-queue says so and why in the summary', async () => {
  const recorder = fakeCore()
  const { github } = fakeGithub(['merge-queue', 'blocked', 'bug'])
  await run({ github, context: fakeContext('labeled', 'bug'), core: recorder.core, now })
  assert.match(recorder.summaries[0], /`merge-queue` stays on #7/)
  assert.match(recorder.summaries[0], /labeled `bug` is not a trigger for removal \(blocking labels present: `blocked`\)/)
})

test('a concurrent removal is reported as already gone', async () => {
  const recorder = fakeCore()
  const { github } = fakeGithub(['merge-queue', 'blocked'], { removeStatus: 404 })
  await run({ github, context: fakeContext('labeled', 'blocked'), core: recorder.core, now })
  assert.match(recorder.summaries[0], /\*\*`merge-queue` was already gone\*\*/)
})

test('merge-queue removed by someone else is recorded with who and when, never re-added or commented', async () => {
  const recorder = fakeCore()
  const { github, calls } = fakeGithub(['blocked'])
  const decision = await run({
    github,
    context: fakeContext('unlabeled', 'merge-queue', 'om-bot[bot]'),
    core: recorder.core,
    guardAppSlug: 'release-app',
    now,
  })
  assert.deepEqual(decision, { remove: false })
  assert.deepEqual(calls, [])
  assert.match(recorder.summaries[0], /`merge-queue` was removed from #7 by om-bot\[bot\]/)
  assert.match(recorder.summaries[0], /om-bot\[bot\] removed `merge-queue` \(event seen at 2026-11-26T10:00:00\.000Z\)/)
  assert.match(recorder.summaries[0], /\| Seen at \| 2026-11-26T10:00:00\.000Z \|/)
  assert.match(recorder.logs[0], /removed by someone else.*om-bot\[bot\] removed merge-queue \(event seen at 2026-11-26T10:00:00\.000Z\)/)
})

test("the guard's own merge-queue removal is not reported as someone else's", async () => {
  const recorder = fakeCore()
  const { github, calls } = fakeGithub([])
  await run({
    github,
    context: fakeContext('unlabeled', 'merge-queue', 'release-app[bot]'),
    core: recorder.core,
    guardAppSlug: 'release-app',
    now,
  })
  assert.deepEqual(calls, [])
  assert.match(recorder.summaries[0], /Nothing to do for #7/)
  assert.doesNotMatch(recorder.summaries[0], /someone else/)
})

test('keepReason separates not relevant from stays', () => {
  assert.equal(keepReason({ action: 'labeled', label: 'blocked', labels: ['blocked'] }).outcome, 'not-relevant')
  assert.deepEqual(keepReason({ action: 'labeled', label: 'merge-queue', labels: ['merge-queue'] }), {
    outcome: 'stays',
    reason: 'no blocking label is present',
  })
})

test('formatSummary escapes table pipes and works without a pull request', () => {
  const report: GuardReport = { at: 'now', outcome: 'not-relevant', reason: 'a | b\nc' }
  const summary = formatSummary(report)
  assert.match(summary, /\| Pull request \| n\/a \|/)
  assert.match(summary, /\| Event \| not a pull request label event \|/)
  assert.match(summary, /\| Reason \| a \\\| b c \|/)
  assert.equal(formatLogLine(report).includes('\n'), false)
})

test('formatSummary escapes backslashes before pipes so a cell cannot break out of the table', () => {
  const summary = formatSummary({ at: 'now', outcome: 'not-relevant', reason: 'a\\|b \\ c' })
  assert.ok(summary.includes('| Reason | a\\\\\\|b \\\\ c |'), summary)
})

type WorkflowStep = {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
type Workflow = {
  on: Record<string, { types?: string[] }>
  permissions: Record<string, string>
  jobs: Record<string, { if?: string; permissions?: unknown; steps: WorkflowStep[] }>
}

function readGuardWorkflow(): Workflow {
  return parse(readFileSync(new URL('../../.github/workflows/merge-queue-guard.yml', import.meta.url), 'utf8')) as Workflow
}

test('the workflow listens only to pull_request_target label changes', () => {
  const workflow = readGuardWorkflow()
  assert.deepEqual(Object.keys(workflow.on), ['pull_request_target'])
  assert.deepEqual(workflow.on.pull_request_target.types, ['labeled', 'unlabeled'])
})

test('GITHUB_TOKEN stays read-only and the app token is scoped to issues and pull requests', () => {
  const workflow = readGuardWorkflow()
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions, undefined)
  const tokenStep = workflow.jobs.guard.steps.find((step) => step.uses?.startsWith('actions/create-github-app-token@'))
  assert.ok(tokenStep, 'the job mints the release app token')
  assert.equal(tokenStep.with?.['permission-issues'], 'write')
  assert.equal(tokenStep.with?.['permission-pull-requests'], 'write')
  const scopes = Object.keys(tokenStep.with ?? {}).filter((key) => key.startsWith('permission-'))
  assert.deepEqual(scopes.sort(), ['permission-issues', 'permission-pull-requests'])
})

test('the job is skipped in forks, which have no app secrets', () => {
  assert.match(readGuardWorkflow().jobs.guard.if ?? '', /^\$\{\{ !github\.event\.repository\.fork &&/)
})

test('no pull request code is checked out or executed', () => {
  const steps = readGuardWorkflow().jobs.guard.steps
  assert.equal(steps.some((step) => step.run !== undefined), false, 'no shell steps')
  const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 1)
  assert.deepEqual(checkouts[0].with, {
    ref: '${{ github.event.repository.default_branch }}',
    'sparse-checkout': 'scripts/ci/merge-queue-guard.mts',
    'sparse-checkout-cone-mode': false,
    'persist-credentials': false,
    'fetch-depth': 1,
  })
})

test('the script never interpolates event data and token-holding actions are pinned by SHA', () => {
  const steps = readGuardWorkflow().jobs.guard.steps
  for (const step of steps) {
    if (step.uses?.startsWith('actions/checkout@')) continue
    assert.match(step.uses ?? '', /@[0-9a-f]{40}$/, `${step.name} must be pinned by SHA`)
  }
  const scriptStep = steps.find((step) => step.uses?.startsWith('actions/github-script@'))
  assert.ok(scriptStep)
  assert.equal(String(scriptStep.with?.script).includes('${{'), false)
  assert.equal(scriptStep.with?.['github-token'], '${{ steps.app-token.outputs.token }}')
})

test('the job also runs when merge-queue itself is removed, and tells the script which app it acts as', () => {
  const job = readGuardWorkflow().jobs.guard
  const condition = job.if ?? ''
  assert.doesNotMatch(condition, /github\.event\.action/)
  const allowList = condition.match(/contains\(fromJSON\('(\[[^\]]*\])'\), github\.event\.label\.name\)/)
  assert.ok(allowList, 'the job filters on a label allow-list')
  const labels = JSON.parse(allowList[1]) as string[]
  assert.ok(labels.includes('merge-queue'))
  for (const label of [...ALWAYS_BLOCKING_LABELS, 'needs-human-qa', 'qa-approved']) assert.ok(labels.includes(label), label)
  const scriptStep = job.steps.find((step) => step.uses?.startsWith('actions/github-script@'))
  assert.ok(scriptStep)
  assert.equal(scriptStep.name, 'Check merge-queue against blocking labels')
  assert.equal(scriptStep.env?.GUARD_APP_SLUG, '${{ steps.app-token.outputs.app-slug }}')
  assert.match(String(scriptStep.with?.script), /guardAppSlug: process\.env\.GUARD_APP_SLUG/)
})
