// Takes `merge-queue` off a pull request whose labels break the merge-ready rule
// (.ai/specs/2026-11-25-batch-merge-and-green-tag-release-process.md § Merge-ready rule).
// Wired up by .github/workflows/merge-queue-guard.yml. `decide()` is the pure rule that
// scripts/__tests__/merge-queue-guard.test.ts exercises; `run()` is the only part that
// talks to the GitHub API. It never adds labels and never removes a blocking one.

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
  payload: {
    action?: string
    label?: { name?: string }
    pull_request?: { number: number }
  }
}

export type GuardCore = { info(message: string): void }

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404
}

export async function run({ github, context, core }: { github: GuardGithub; context: GuardContext; core: GuardCore }): Promise<GuardDecision> {
  const { action, label, pull_request: pullRequest } = context.payload
  if ((action !== 'labeled' && action !== 'unlabeled') || !label?.name || !pullRequest) {
    core.info('Not a pull request label event; nothing to do.')
    return { remove: false }
  }

  const issue: IssueParams = { ...context.repo, issue_number: pullRequest.number }
  const { data } = await github.rest.issues.listLabelsOnIssue({ ...issue, per_page: 100 })
  const decision = decide({ action, label: label.name, labels: data.map((entry) => entry.name) })
  if (!decision.remove) {
    core.info(`#${pullRequest.number}: ${action} ${label.name}; ${MERGE_QUEUE_LABEL} stays.`)
    return decision
  }

  try {
    await github.rest.issues.removeLabel({ ...issue, name: MERGE_QUEUE_LABEL })
  } catch (error) {
    if (!isNotFound(error)) throw error
    core.info(`#${pullRequest.number}: ${MERGE_QUEUE_LABEL} was already gone.`)
    return { remove: false }
  }
  await github.rest.issues.createComment({ ...issue, body: formatComment(decision.reason) })
  core.info(`#${pullRequest.number}: removed ${MERGE_QUEUE_LABEL} (${decision.reason}).`)
  return decision
}
