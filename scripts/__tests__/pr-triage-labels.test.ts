import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  HUMAN_TRIAGE_ACCEPTED_LABEL,
  NEEDS_TRIAGE_LABEL,
  TRIAGED_LABEL,
  decide,
  formatUnauthorizedAcceptanceComment,
  parseCoreTeamLogins,
  parseTrustedBots,
  run,
  type TriageContext,
  type TriageCore,
  type TriageGithub,
  type TriagePullRequest,
} from '../ci/pr-triage-labels.mts'

const WORKFLOW_PATH = new URL('../../.github/workflows/pr-triage-labels.yml', import.meta.url)
const CORE_TEAM_PATH = new URL('../../.github/core-team.json', import.meta.url)
const AGENTIC_CONFIG_PATH = new URL('../../.ai/agentic.config.json', import.meta.url)

const REPO = { owner: 'open-mercato', repo: 'open-mercato' }
const CORE_TEAM = new Set(['pkarw', 'kapsik89', 'matgren', 'tkarwatka'])
const TRUSTED_BOTS = new Set([
  'open-mercato-maintenance[bot]',
  'open-mercato-assistant[bot]',
  'dependabot[bot]',
])

function makePr(overrides: Partial<TriagePullRequest> = {}): TriagePullRequest {
  return {
    number: 42,
    draft: false,
    user: { login: 'external-dev', type: 'User' },
    head: { ref: 'feat/something', repo: { full_name: 'external-dev/open-mercato' } },
    ...overrides,
  }
}

type ApiCall = { method: string; params: Record<string, unknown> }

function fakeGithub(labels: string[], { removeStatus }: { removeStatus?: number } = {}) {
  const calls: ApiCall[] = []
  const github: TriageGithub = {
    rest: {
      issues: {
        listLabelsOnIssue: async (params) => {
          calls.push({ method: 'listLabelsOnIssue', params })
          return { data: labels.map((name) => ({ name })) }
        },
        addLabels: async (params) => {
          calls.push({ method: 'addLabels', params })
          return {}
        },
        removeLabel: async (params) => {
          calls.push({ method: 'removeLabel', params })
          if (removeStatus) throw Object.assign(new Error('api error'), { status: removeStatus })
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

function fakeCore() {
  const logs: string[] = []
  const core: TriageCore = { info: (msg) => logs.push(msg) }
  return { core, logs }
}

test('parseCoreTeamLogins normalizes .github/core-team.json logins to lowercase', () => {
  const logins = parseCoreTeamLogins(readFileSync(CORE_TEAM_PATH, 'utf8'))
  assert.ok(logins.has('kapsik89'))
  assert.ok(logins.has('mstaniaszek1998'))
  assert.ok(logins.has('matgren'))
  assert.ok(logins.has('tkarwatka'))
  assert.equal(logins.has('ahksammich'), false)
})

test('external PR on opened, reopened, ready_for_review gets needs-triage unless already accepted', () => {
  for (const action of ['opened', 'reopened', 'ready_for_review']) {
    const decision = decide({
      action,
      pullRequest: makePr(),
      labels: ['bug'],
      coreTeam: CORE_TEAM,
      repo: REPO,
    })
    assert.equal(decision.kind, 'add-label', action)
    if (decision.kind === 'add-label') {
      assert.equal(decision.label, NEEDS_TRIAGE_LABEL)
    }

    const alreadyAccepted = decide({
      action,
      pullRequest: makePr(),
      labels: [HUMAN_TRIAGE_ACCEPTED_LABEL],
      coreTeam: CORE_TEAM,
      repo: REPO,
    })
    assert.equal(alreadyAccepted.kind, 'noop', `${action} with human-triage-accepted`)
  }
})

test('core-team PR skips needs-triage case-insensitively', () => {
  const decision = decide({
    action: 'opened',
    pullRequest: makePr({ user: { login: 'Kapsik89', type: 'User' } }),
    labels: [],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(decision.kind, 'noop')
})

test('draft PRs and same-repo stabilize/ branches are skipped, while fork stabilize/ branches are not', () => {
  const draft = decide({
    action: 'opened',
    pullRequest: makePr({ draft: true }),
    labels: [],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(draft.kind, 'skip')

  const sameRepoStabilize = decide({
    action: 'opened',
    pullRequest: makePr({
      head: { ref: 'stabilize/qa-2026-11-28', repo: { full_name: 'open-mercato/open-mercato' } },
    }),
    labels: [],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(sameRepoStabilize.kind, 'skip')

  const forkStabilize = decide({
    action: 'opened',
    pullRequest: makePr({
      head: { ref: 'stabilize/spoofed', repo: { full_name: 'external-dev/open-mercato' } },
    }),
    labels: [],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(forkStabilize.kind, 'add-label')
})

test('synchronize removes triaged when present and is a noop otherwise', () => {
  const withTriaged = decide({
    action: 'synchronize',
    pullRequest: makePr({ user: { login: 'pkarw', type: 'User' } }),
    labels: ['review', TRIAGED_LABEL],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(withTriaged.kind, 'remove-label')
  if (withTriaged.kind === 'remove-label') {
    assert.equal(withTriaged.label, TRIAGED_LABEL)
  }

  const withoutTriaged = decide({
    action: 'synchronize',
    pullRequest: makePr(),
    labels: ['review'],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(withoutTriaged.kind, 'noop')
})

test('labeled human-triage-accepted by a core-team human removes needs-triage', () => {
  const decision = decide({
    action: 'labeled',
    pullRequest: makePr(),
    labelName: HUMAN_TRIAGE_ACCEPTED_LABEL,
    sender: { login: 'Kapsik89', type: 'User' },
    labels: [NEEDS_TRIAGE_LABEL, HUMAN_TRIAGE_ACCEPTED_LABEL],
    coreTeam: CORE_TEAM,
    repo: REPO,
  })
  assert.equal(decision.kind, 'remove-label')
  if (decision.kind === 'remove-label') {
    assert.equal(decision.label, NEEDS_TRIAGE_LABEL)
  }
})

test('labeled human-triage-accepted by a non-core user or bot removes human-triage-accepted and comments', () => {
  for (const sender of [
    { login: 'external-triager', type: 'User' },
    { login: 'open-mercato-assistant[bot]', type: 'Bot' },
    { login: 'pkarw', type: 'Bot' },
  ]) {
    const decision = decide({
      action: 'labeled',
      pullRequest: makePr(),
      labelName: HUMAN_TRIAGE_ACCEPTED_LABEL,
      sender,
      labels: [NEEDS_TRIAGE_LABEL, HUMAN_TRIAGE_ACCEPTED_LABEL],
      coreTeam: CORE_TEAM,
      repo: REPO,
    })
    assert.equal(decision.kind, 'reject-accepted', sender.login)
    if (decision.kind === 'reject-accepted') {
      assert.equal(decision.label, HUMAN_TRIAGE_ACCEPTED_LABEL)
      assert.equal(decision.actor, sender.login)
    }
  }
})

test('run executes addLabels, removeLabel, and unauthorized-acceptance rejection with comment', async () => {
  // 1. External PR opened -> adds needs-triage
  {
    const { github, calls } = fakeGithub([])
    const { core } = fakeCore()
    const context: TriageContext = {
      repo: REPO,
      payload: { action: 'opened', pull_request: makePr() },
    }
    const decision = await run({ github, context, core, coreTeam: CORE_TEAM })
    assert.equal(decision.kind, 'add-label')
    assert.deepEqual(
      calls.map((c) => c.method),
      ['listLabelsOnIssue', 'addLabels'],
    )
    assert.deepEqual(calls[1].params, {
      owner: REPO.owner,
      repo: REPO.repo,
      issue_number: 42,
      labels: [NEEDS_TRIAGE_LABEL],
    })
  }

  // 2. Synchronize -> removes triaged
  {
    const { github, calls } = fakeGithub([TRIAGED_LABEL])
    const { core } = fakeCore()
    const context: TriageContext = {
      repo: REPO,
      payload: { action: 'synchronize', pull_request: makePr() },
    }
    const decision = await run({ github, context, core, coreTeam: CORE_TEAM })
    assert.equal(decision.kind, 'remove-label')
    assert.deepEqual(
      calls.map((c) => c.method),
      ['listLabelsOnIssue', 'removeLabel'],
    )
    assert.deepEqual(calls[1].params, {
      owner: REPO.owner,
      repo: REPO.repo,
      issue_number: 42,
      name: TRIAGED_LABEL,
    })
  }

  // 3. Unauthorized human-triage-accepted -> removes label and comments
  {
    const { github, calls } = fakeGithub([NEEDS_TRIAGE_LABEL, HUMAN_TRIAGE_ACCEPTED_LABEL])
    const { core } = fakeCore()
    const context: TriageContext = {
      repo: REPO,
      payload: {
        action: 'labeled',
        label: { name: HUMAN_TRIAGE_ACCEPTED_LABEL },
        pull_request: makePr(),
        sender: { login: 'open-mercato-maintenance[bot]', type: 'Bot' },
      },
    }
    const decision = await run({ github, context, core, coreTeam: CORE_TEAM })
    assert.equal(decision.kind, 'reject-accepted')
    assert.deepEqual(
      calls.map((c) => c.method),
      ['listLabelsOnIssue', 'removeLabel', 'createComment'],
    )
    assert.equal(calls[2].params.body, formatUnauthorizedAcceptanceComment('open-mercato-maintenance[bot]'))
  }

  // 4. Unauthorized human-triage-accepted already removed concurrently (404) -> skips comment
  {
    const { github, calls } = fakeGithub([HUMAN_TRIAGE_ACCEPTED_LABEL], { removeStatus: 404 })
    const { core } = fakeCore()
    const context: TriageContext = {
      repo: REPO,
      payload: {
        action: 'labeled',
        label: { name: HUMAN_TRIAGE_ACCEPTED_LABEL },
        pull_request: makePr(),
        sender: { login: 'some-bot[bot]', type: 'Bot' },
      },
    }
    const decision = await run({ github, context, core, coreTeam: CORE_TEAM })
    assert.equal(decision.kind, 'noop')
    assert.deepEqual(
      calls.map((c) => c.method),
      ['listLabelsOnIssue', 'removeLabel'],
    )
  }
})

test('parseTrustedBots normalizes prTriage.trustedBots from .ai/agentic.config.json', () => {
  const bots = parseTrustedBots(readFileSync(AGENTIC_CONFIG_PATH, 'utf8'))
  assert.ok(bots.has('open-mercato-maintenance[bot]'))
  assert.ok(bots.has('open-mercato-assistant[bot]'))
  assert.ok(bots.has('dependabot[bot]'))
})

test('trusted bots skip needs-triage case-insensitively, still lose triaged on synchronize, and cannot accept PRs', async () => {
  for (const action of ['opened', 'reopened', 'ready_for_review']) {
    const decision = decide({
      action,
      pullRequest: makePr({ user: { login: 'Open-Mercato-Maintenance[bot]', type: 'Bot' } }),
      labels: [],
      coreTeam: CORE_TEAM,
      trustedBots: TRUSTED_BOTS,
      repo: REPO,
    })
    assert.equal(decision.kind, 'noop', action)
  }

  // run() skips API calls when a trusted bot opens a PR
  {
    const { github, calls } = fakeGithub([])
    const { core } = fakeCore()
    const context: TriageContext = {
      repo: REPO,
      payload: {
        action: 'opened',
        pull_request: makePr({ user: { login: 'dependabot[bot]', type: 'Bot' } }),
      },
    }
    const decision = await run({ github, context, core, coreTeam: CORE_TEAM, trustedBots: TRUSTED_BOTS })
    assert.equal(decision.kind, 'noop')
    assert.deepEqual(calls, [])
  }

  // Trusted bots still need fresh triage on synchronize
  const syncDecision = decide({
    action: 'synchronize',
    pullRequest: makePr({ user: { login: 'open-mercato-assistant[bot]', type: 'Bot' } }),
    labels: [TRIAGED_LABEL],
    coreTeam: CORE_TEAM,
    trustedBots: TRUSTED_BOTS,
    repo: REPO,
  })
  assert.equal(syncDecision.kind, 'remove-label')
  if (syncDecision.kind === 'remove-label') {
    assert.equal(syncDecision.label, TRIAGED_LABEL)
  }

  // Trusted bots NEVER count as human acceptors
  const acceptDecision = decide({
    action: 'labeled',
    pullRequest: makePr(),
    labelName: HUMAN_TRIAGE_ACCEPTED_LABEL,
    sender: { login: 'open-mercato-maintenance[bot]', type: 'Bot' },
    labels: [NEEDS_TRIAGE_LABEL, HUMAN_TRIAGE_ACCEPTED_LABEL],
    coreTeam: CORE_TEAM,
    trustedBots: TRUSTED_BOTS,
    repo: REPO,
  })
  assert.equal(acceptDecision.kind, 'reject-accepted')
})

test('workflow security properties: pull_request_target, minimal permissions, default-branch sparse checkout, no PR code execution', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8')

  assert.match(workflow, /^\s*pull_request_target:/m)
  assert.match(workflow, /types:\s*\[opened,\s*reopened,\s*ready_for_review,\s*synchronize,\s*labeled\]/)
  assert.doesNotMatch(workflow, /^\s*concurrency:/m)

  // Minimal permissions
  assert.match(workflow, /contents:\s*read/)
  assert.match(workflow, /issues:\s*write/)
  assert.match(workflow, /pull-requests:\s*write/)
  assert.doesNotMatch(workflow, /contents:\s*write/)
  assert.doesNotMatch(workflow, /write-all/)

  // Sparse checkout pinned to default branch, credential-free, no PR head ref, no shell steps
  assert.match(workflow, /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/)
  assert.match(workflow, /persist-credentials:\s*false/)
  assert.match(workflow, /sparse-checkout-cone-mode:\s*false/)
  assert.match(workflow, /\.github\/core-team\.json/)
  assert.match(workflow, /\.ai\/agentic\.config\.json/)
  assert.match(workflow, /scripts\/ci\/pr-triage-labels\.mts/)
  assert.doesNotMatch(workflow, /pull_request\.head\.sha/)
  assert.doesNotMatch(workflow, /^\s*run:/m)

  // Skips drafts and same-repo stabilize/ branches
  assert.match(workflow, /!github\.event\.pull_request\.draft/)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /startsWith\(github\.event\.pull_request\.head\.ref,\s*'stabilize\/'\)/)

  // No ${{ interpolation inside the github-script body
  const scriptBlock = workflow.split(/script:\s*\|/)[1] ?? ''
  assert.ok(scriptBlock.length > 0, 'workflow must have a github-script block')
  assert.equal(scriptBlock.includes('${{'), false, 'script block must not interpolate GitHub expressions')
})
