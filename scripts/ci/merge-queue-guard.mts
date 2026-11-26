// Takes `merge-queue` off a pull request whose labels break the merge-ready rule
// (.ai/specs/2026-11-25-batch-merge-and-green-tag-release-process.md § Merge-ready rule).
// Wired up by .github/workflows/merge-queue-guard.yml. `decide()` is the pure rule that
// scripts/__tests__/merge-queue-guard.test.ts exercises; `run()` is the only part that
// talks to the GitHub API. It never adds labels and never removes a blocking one. Every run
// writes a job summary (`formatSummary()`) with the PR, the event, the decision and the reason,
// and records when someone other than the guard removes `merge-queue`.

export const MERGE_QUEUE_LABEL = 'merge-queue'
export const HUMAN_QA_LABEL = 'needs-human-qa'
export const QA_APPROVED_LABEL = 'qa-approved'
export const ALWAYS_BLOCKING_LABELS: readonly string[] = [
  'qa-failed',
  'changes-requested',
  'blocked',
  'do-not-merge',
]

export type LabelAction = 'labeled' | 'unlabeled'

export type GuardEvent = {
  action: LabelAction
  label: string
  labels: readonly string[]
}

export type GuardDecision = { remove: false } | { remove: true; reason: string }

const code = (label: string) => `\`${label}\``

export function blockingLabels(labels: readonly string[]): string[] {
  const present = new Set(labels)
  const blockers = ALWAYS_BLOCKING_LABELS.filter((label) => present.has(label))
  if (present.has(HUMAN_QA_LABEL) && !present.has(QA_APPROVED_LABEL)) blockers.push(HUMAN_QA_LABEL)
  return blockers
}

function blockerReason(label: string): string {
  return label === HUMAN_QA_LABEL ? `${code(HUMAN_QA_LABEL)} without ${code(QA_APPROVED_LABEL)}` : code(label)
}

export function decide({ action, label, labels }: GuardEvent): GuardDecision {
  if (!labels.includes(MERGE_QUEUE_LABEL)) return { remove: false }
  const blockers = blockingLabels(labels)
  if (blockers.length === 0) return { remove: false }

  if (action === 'labeled' && label === MERGE_QUEUE_LABEL) {
    return {
      remove: true,
      reason: `the PR already carries a blocking label (${blockers.map(blockerReason).join(', ')})`,
    }
  }
  if (action === 'labeled' && blockers.includes(label)) {
    return { remove: true, reason: `${blockerReason(label)} was added` }
  }
  if (action === 'unlabeled' && label === QA_APPROVED_LABEL && blockers.includes(HUMAN_QA_LABEL)) {
    return { remove: true, reason: `${code(QA_APPROVED_LABEL)} was removed while ${code(HUMAN_QA_LABEL)} is present` }
  }
  return { remove: false }
}

export function formatComment(reason: string): string {
  return `Removed ${code(MERGE_QUEUE_LABEL)}: ${reason}, so this PR is not merge-ready (see the merge-ready rule in \`.ai/specs/2026-11-25-batch-merge-and-green-tag-release-process.md\`).`
}

export type GuardOutcome = 'removed' | 'stays' | 'already-gone' | 'not-relevant' | 'removed-by-someone-else'

export type GuardReport = {
  pullRequest?: { number: number; url: string }
  action?: string
  label?: string
  actor?: string
  at: string
  outcome: GuardOutcome
  reason: string
}

export function keepReason({ action, label, labels }: GuardEvent): { outcome: 'stays' | 'not-relevant'; reason: string } {
  if (!labels.includes(MERGE_QUEUE_LABEL)) {
    return { outcome: 'not-relevant', reason: `the PR does not carry ${code(MERGE_QUEUE_LABEL)}` }
  }
  const blockers = blockingLabels(labels)
  if (blockers.length === 0) return { outcome: 'stays', reason: 'no blocking label is present' }
  return {
    outcome: 'stays',
    reason: `${action} ${code(label)} is not a trigger for removal (blocking labels present: ${blockers.map(blockerReason).join(', ')})`,
  }
}

const DECISION_TEXT: Record<GuardOutcome, string> = {
  removed: `removed ${code(MERGE_QUEUE_LABEL)}`,
  stays: `${code(MERGE_QUEUE_LABEL)} stays`,
  'already-gone': `${code(MERGE_QUEUE_LABEL)} was already gone`,
  'not-relevant': 'not relevant',
  'removed-by-someone-else': `${code(MERGE_QUEUE_LABEL)} removed by someone else (recorded only)`,
}

function headline({ outcome, pullRequest, actor }: GuardReport): string {
  const target = pullRequest ? `#${pullRequest.number}` : 'this event'
  switch (outcome) {
    case 'removed':
      return `\u{1F6AB} Removed ${code(MERGE_QUEUE_LABEL)} from ${target}`
    case 'stays':
      return `\u2705 ${code(MERGE_QUEUE_LABEL)} stays on ${target}`
    case 'already-gone':
      return `\u2796 ${code(MERGE_QUEUE_LABEL)} was already gone from ${target}`
    case 'removed-by-someone-else':
      return `\u{1F464} ${code(MERGE_QUEUE_LABEL)} was removed from ${target} by ${actor ?? 'an unknown actor'}`
    case 'not-relevant':
      return `\u2796 Nothing to do for ${target}`
  }
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function formatSummary(report: GuardReport): string {
  const event = report.action
    ? `${report.action} ${report.label ? code(report.label) : '(no label)'} by ${report.actor ?? 'unknown'}`
    : 'not a pull request label event'
  const rows: Array<[string, string]> = [
    ['Pull request', report.pullRequest ? `[#${report.pullRequest.number}](${report.pullRequest.url})` : 'n/a'],
    ['Event', event],
    ['Decision', `**${DECISION_TEXT[report.outcome]}**`],
    ['Reason', report.reason],
    ['At', report.at],
  ]
  return [
    `## ${headline(report)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${field} | ${cell(value)} |`),
    '',
  ].join('\n')
}

export function formatLogLine(report: GuardReport): string {
  const target = report.pullRequest ? `#${report.pullRequest.number}` : '(no PR)'
  const event = report.action ? `${report.action} ${report.label ?? '(no label)'} by ${report.actor ?? 'unknown'}` : 'no label event'
  return `${target}: ${DECISION_TEXT[report.outcome].replace(/`/g, '')} (${report.reason.replace(/`/g, '')}) [event: ${event}, at ${report.at}]`
}

type IssueParams = { owner: string; repo: string; issue_number: number }

export type GuardGithub = {
  rest: {
    issues: {
      listLabelsOnIssue(params: IssueParams & { per_page: number }): Promise<{ data: Array<{ name: string }> }>
      removeLabel(params: IssueParams & { name: string }): Promise<unknown>
      createComment(params: IssueParams & { body: string }): Promise<unknown>
    }
  }
}

export type GuardContext = {
  repo: { owner: string; repo: string }
  serverUrl?: string
  payload: {
    action?: string
    label?: { name?: string }
    pull_request?: { number: number; html_url?: string }
    sender?: { login?: string }
  }
}

export type GuardCore = {
  info(message: string): void
  summary: { addRaw(text: string, addEOL?: boolean): unknown; write(): Promise<unknown> }
}

export type GuardRunOptions = {
  github: GuardGithub
  context: GuardContext
  core: GuardCore
  guardAppSlug?: string
  now?: () => Date
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
}

async function evaluate({ github, context, guardAppSlug, at }: GuardRunOptions & { at: string }): Promise<{ decision: GuardDecision; report: GuardReport }> {
  const { action, label, pull_request: pullRequest, sender } = context.payload
  const actor = sender?.login
  const base = { action, label: label?.name, actor, at }
  const keep: GuardDecision = { remove: false }
  if ((action !== 'labeled' && action !== 'unlabeled') || !label?.name || !pullRequest) {
    return { decision: keep, report: { ...base, outcome: 'not-relevant', reason: 'not a pull request label event' } }
  }

  const prUrl = pullRequest.html_url ?? `${context.serverUrl ?? 'https://github.com'}/${context.repo.owner}/${context.repo.repo}/pull/${pullRequest.number}`
  const report = { ...base, pullRequest: { number: pullRequest.number, url: prUrl } }

  if (action === 'unlabeled' && label.name === MERGE_QUEUE_LABEL) {
    if (guardAppSlug && actor === `${guardAppSlug}[bot]`) {
      return { decision: keep, report: { ...report, outcome: 'not-relevant', reason: 'the guard removed it itself; its own run records why' } }
    }
    return {
      decision: keep,
      report: {
        ...report,
        outcome: 'removed-by-someone-else',
        reason: `${actor ?? 'an unknown actor'} removed ${code(MERGE_QUEUE_LABEL)} at ${at}; the guard does not re-add it`,
      },
    }
  }

  const issue: IssueParams = { ...context.repo, issue_number: pullRequest.number }
  const { data } = await github.rest.issues.listLabelsOnIssue({ ...issue, per_page: 100 })
  const event: GuardEvent = { action, label: label.name, labels: data.map((entry) => entry.name) }
  const decision = decide(event)
  if (!decision.remove) return { decision, report: { ...report, ...keepReason(event) } }

  try {
    await github.rest.issues.removeLabel({ ...issue, name: MERGE_QUEUE_LABEL })
  } catch (error) {
    if (!isNotFound(error)) throw error
    return {
      decision: keep,
      report: { ...report, outcome: 'already-gone', reason: `it would have been removed because ${decision.reason}, but someone took it off first` },
    }
  }
  await github.rest.issues.createComment({ ...issue, body: formatComment(decision.reason) })
  return { decision, report: { ...report, outcome: 'removed', reason: decision.reason } }
}

export async function run(options: GuardRunOptions): Promise<GuardDecision> {
  const at = (options.now ?? (() => new Date()))().toISOString()
  const { decision, report } = await evaluate({ ...options, at })
  options.core.info(formatLogLine(report))
  options.core.summary.addRaw(formatSummary(report), true)
  await options.core.summary.write()
  return decision
}
