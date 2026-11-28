// Manages the PR triage and external-acceptance lifecycle labels:
// - `needs-triage`: added when an external PR opens, reopens, or is marked ready
//   (unless it already carries `human-triage-accepted`).
// - `triaged`: removed on every new push (`synchronize`) so triage must re-run on the new head.
// - `human-triage-accepted`: when applied by a human listed in `.github/core-team.json`,
//   removes `needs-triage`; otherwise removes `human-triage-accepted` again and comments why.
//
// Wired up by `.github/workflows/pr-triage-labels.yml`. `decide()` is the pure rule exercised
// by `scripts/__tests__/pr-triage-labels.test.ts`; `run()` is the only part that calls the
// GitHub API.

export const NEEDS_TRIAGE_LABEL = 'needs-triage'
export const HUMAN_TRIAGE_ACCEPTED_LABEL = 'human-triage-accepted'
export const TRIAGED_LABEL = 'triaged'
export const STABILIZE_BRANCH_PREFIX = 'stabilize/'

export type TriageUser = {
  login?: string
  type?: string
}

export type TriagePullRequest = {
  number: number
  draft?: boolean
  user?: TriageUser | null
  head?: {
    ref?: string
    repo?: {
      full_name?: string
    } | null
  }
}

export type TriageRepo = {
  owner: string
  repo: string
}

export type TriageDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'noop'; reason: string }
  | { kind: 'add-label'; label: string; reason: string }
  | { kind: 'remove-label'; label: string; reason: string }
  | { kind: 'reject-accepted'; label: string; actor: string; reason: string }

export type DecideInput = {
  action?: string
  pullRequest?: TriagePullRequest
  labelName?: string
  sender?: TriageUser | null
  labels: readonly string[]
  coreTeam: ReadonlySet<string>
  repo: TriageRepo
}

export function parseCoreTeamLogins(raw: string): Set<string> {
  const parsed = JSON.parse(raw) as { logins?: unknown }
  if (!Array.isArray(parsed.logins)) {
    throw new Error('core-team.json must contain a logins array')
  }
  const logins = new Set<string>()
  for (const entry of parsed.logins) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error('core-team.json logins must be non-empty strings')
    }
    logins.add(entry.trim().toLowerCase())
  }
  return logins
}

export function isBotUser(user?: TriageUser | null): boolean {
  if (!user) return false
  if (user.type === 'Bot') return true
  return typeof user.login === 'string' && user.login.toLowerCase().endsWith('[bot]')
}

export function isCoreTeamLogin(login: string | undefined, coreTeam: ReadonlySet<string>): boolean {
  return typeof login === 'string' && login.length > 0 && coreTeam.has(login.toLowerCase())
}

export function isSameRepoStabilizeBranch(pullRequest: TriagePullRequest, repo: TriageRepo): boolean {
  const headRef = pullRequest.head?.ref ?? ''
  if (!headRef.startsWith(STABILIZE_BRANCH_PREFIX)) return false
  const headRepoFullName = pullRequest.head?.repo?.full_name?.toLowerCase()
  const baseRepoFullName = `${repo.owner}/${repo.repo}`.toLowerCase()
  return headRepoFullName === baseRepoFullName
}

export function formatUnauthorizedAcceptanceComment(actor: string): string {
  return `Removed \`${HUMAN_TRIAGE_ACCEPTED_LABEL}\` (added by @${actor}): only a human listed in \`.github/core-team.json\` may record the acceptance decision (see \`.ai/docs/pr-workflow.md\`).`
}

export function decide({
  action,
  pullRequest,
  labelName,
  sender,
  labels,
  coreTeam,
  repo,
}: DecideInput): TriageDecision {
  if (!pullRequest) {
    return { kind: 'skip', reason: 'not a pull request event' }
  }
  if (pullRequest.draft) {
    return { kind: 'skip', reason: 'pull request is a draft' }
  }
  if (isSameRepoStabilizeBranch(pullRequest, repo)) {
    return { kind: 'skip', reason: 'same-repository stabilize/ branch' }
  }

  if (action === 'opened' || action === 'reopened' || action === 'ready_for_review') {
    const author = pullRequest.user?.login
    if (isCoreTeamLogin(author, coreTeam)) {
      return { kind: 'noop', reason: `author @${author} is in .github/core-team.json` }
    }
    if (labels.includes(HUMAN_TRIAGE_ACCEPTED_LABEL)) {
      return { kind: 'noop', reason: `PR already carries ${HUMAN_TRIAGE_ACCEPTED_LABEL}` }
    }
    if (labels.includes(NEEDS_TRIAGE_LABEL)) {
      return { kind: 'noop', reason: `PR already carries ${NEEDS_TRIAGE_LABEL}` }
    }
    return {
      kind: 'add-label',
      label: NEEDS_TRIAGE_LABEL,
      reason: `external author @${author ?? 'unknown'} without ${HUMAN_TRIAGE_ACCEPTED_LABEL}`,
    }
  }

  if (action === 'synchronize') {
    if (!labels.includes(TRIAGED_LABEL)) {
      return { kind: 'noop', reason: `PR does not carry ${TRIAGED_LABEL}` }
    }
    return {
      kind: 'remove-label',
      label: TRIAGED_LABEL,
      reason: 'new commits pushed (synchronize)',
    }
  }

  if (action === 'labeled') {
    if (labelName !== HUMAN_TRIAGE_ACCEPTED_LABEL) {
      return { kind: 'noop', reason: `label ${labelName ?? '(unknown)'} is not ${HUMAN_TRIAGE_ACCEPTED_LABEL}` }
    }
    if (!isBotUser(sender) && isCoreTeamLogin(sender?.login, coreTeam)) {
      if (!labels.includes(NEEDS_TRIAGE_LABEL)) {
        return { kind: 'noop', reason: `${NEEDS_TRIAGE_LABEL} is not present` }
      }
      return {
        kind: 'remove-label',
        label: NEEDS_TRIAGE_LABEL,
        reason: `${HUMAN_TRIAGE_ACCEPTED_LABEL} applied by core-team member @${sender?.login}`,
      }
    }
    if (!labels.includes(HUMAN_TRIAGE_ACCEPTED_LABEL)) {
      return { kind: 'noop', reason: `${HUMAN_TRIAGE_ACCEPTED_LABEL} is already gone` }
    }
    return {
      kind: 'reject-accepted',
      label: HUMAN_TRIAGE_ACCEPTED_LABEL,
      actor: sender?.login ?? 'unknown',
      reason: `labeler @${sender?.login ?? 'unknown'} is not a human listed in .github/core-team.json`,
    }
  }

  return { kind: 'noop', reason: `unhandled action ${action ?? '(none)'}` }
}

type IssueParams = { owner: string; repo: string; issue_number: number }

export type TriageGithub = {
  rest: {
    issues: {
      listLabelsOnIssue(params: IssueParams & { per_page: number }): Promise<{ data: Array<{ name: string }> }>
      addLabels(params: IssueParams & { labels: string[] }): Promise<unknown>
      removeLabel(params: IssueParams & { name: string }): Promise<unknown>
      createComment(params: IssueParams & { body: string }): Promise<unknown>
    }
  }
}

export type TriageContext = {
  repo: TriageRepo
  payload: {
    action?: string
    label?: { name?: string }
    pull_request?: TriagePullRequest
    sender?: TriageUser | null
  }
}

export type TriageCore = {
  info(message: string): void
}

export type TriageRunOptions = {
  github: TriageGithub
  context: TriageContext
  core: TriageCore
  coreTeam: ReadonlySet<string>
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
}

export async function run({ github, context, core, coreTeam }: TriageRunOptions): Promise<TriageDecision> {
  const { action, label, pull_request: pullRequest, sender } = context.payload
  const repo = context.repo

  if (!pullRequest) {
    const decision: TriageDecision = { kind: 'skip', reason: 'not a pull request event' }
    core.info(`Skipping: ${decision.reason}`)
    return decision
  }
  if (pullRequest.draft) {
    const decision: TriageDecision = { kind: 'skip', reason: 'pull request is a draft' }
    core.info(`#${pullRequest.number}: skipping (${decision.reason})`)
    return decision
  }
  if (isSameRepoStabilizeBranch(pullRequest, repo)) {
    const decision: TriageDecision = { kind: 'skip', reason: 'same-repository stabilize/ branch' }
    core.info(`#${pullRequest.number}: skipping (${decision.reason})`)
    return decision
  }
  if (action === 'labeled' && label?.name !== HUMAN_TRIAGE_ACCEPTED_LABEL) {
    const decision: TriageDecision = {
      kind: 'noop',
      reason: `label ${label?.name ?? '(unknown)'} is not ${HUMAN_TRIAGE_ACCEPTED_LABEL}`,
    }
    core.info(`#${pullRequest.number}: noop (${decision.reason})`)
    return decision
  }
  if (
    (action === 'opened' || action === 'reopened' || action === 'ready_for_review') &&
    isCoreTeamLogin(pullRequest.user?.login, coreTeam)
  ) {
    const decision: TriageDecision = {
      kind: 'noop',
      reason: `author @${pullRequest.user?.login} is in .github/core-team.json`,
    }
    core.info(`#${pullRequest.number}: noop (${decision.reason})`)
    return decision
  }

  const issue: IssueParams = { ...repo, issue_number: pullRequest.number }
  const { data } = await github.rest.issues.listLabelsOnIssue({ ...issue, per_page: 100 })
  const labels = data.map((entry) => entry.name)

  const decision = decide({
    action,
    pullRequest,
    labelName: label?.name,
    sender,
    labels,
    coreTeam,
    repo,
  })

  if (decision.kind === 'add-label') {
    await github.rest.issues.addLabels({ ...issue, labels: [decision.label] })
    core.info(`#${pullRequest.number}: added ${decision.label} (${decision.reason})`)
    return decision
  }

  if (decision.kind === 'remove-label') {
    try {
      await github.rest.issues.removeLabel({ ...issue, name: decision.label })
      core.info(`#${pullRequest.number}: removed ${decision.label} (${decision.reason})`)
    } catch (error) {
      if (!isNotFound(error)) throw error
      core.info(`#${pullRequest.number}: ${decision.label} was already gone (${decision.reason})`)
    }
    return decision
  }

  if (decision.kind === 'reject-accepted') {
    try {
      await github.rest.issues.removeLabel({ ...issue, name: decision.label })
    } catch (error) {
      if (!isNotFound(error)) throw error
      core.info(`#${pullRequest.number}: ${decision.label} was already gone; skipping comment`)
      return { kind: 'noop', reason: `${decision.label} was already gone` }
    }
    await github.rest.issues.createComment({
      ...issue,
      body: formatUnauthorizedAcceptanceComment(decision.actor),
    })
    core.info(`#${pullRequest.number}: removed ${decision.label} and commented (${decision.reason})`)
    return decision
  }

  core.info(`#${pullRequest.number}: ${decision.kind} (${decision.reason})`)
  return decision
}
