import type { SyncRunStatus } from './syncRunStatus'

/**
 * What a retry of a given run would do, as far as the run row can tell.
 *
 * Both the runs list and the run detail page render from this, so the two
 * cannot drift into telling an operator two different stories about the same
 * run.
 */
export type ResumePoint =
  | { kind: 'none' }
  | { kind: 'noCommittedBatch' }
  | { kind: 'resumes'; batchesCompleted: number; cursor: string }

export type ResumePointRun = {
  status: SyncRunStatus | string
  cursor: string | null
  batchesCompleted: number
}

const RETRYABLE: Record<string, true> = { failed: true, cancelled: true }

/**
 * Note what this deliberately does NOT return: a `fromBeginning` kind.
 *
 * `api/runs/[id]/retry.ts` resolves a resumable retry's start position as
 * `previous.cursor ?? resolveStartCursor(...)`, and `resolveStartCursor` reads
 * the shared `sync_cursors` row — state this run row does not carry. A run that
 * died before committing a batch can therefore still resume at a cursor an
 * earlier run wrote, silently skipping everything before it.
 *
 * So a null cursor means only "this run committed nothing", never "a retry will
 * start from the beginning". Callers must not upgrade `noCommittedBatch` into a
 * positional claim, and must keep the from-scratch action available for it —
 * that action is the only one whose start position is knowable from here.
 */
export function resolveResumePoint(run: ResumePointRun): ResumePoint {
  if (!RETRYABLE[run.status]) return { kind: 'none' }
  if (!run.cursor) return { kind: 'noCommittedBatch' }
  return {
    kind: 'resumes',
    // A committed cursor with a zero batch count is possible for an adapter
    // that commits a cursor before its first batch lands; the count is reported
    // as-is rather than coerced upward, because it is what the run recorded.
    batchesCompleted: run.batchesCompleted,
    cursor: run.cursor,
  }
}

/**
 * Whether a run in this state can be retried at all. Kept beside the resolver
 * so the two cannot disagree about which statuses qualify — the retry endpoint
 * answers 409 for every other one.
 */
export function isRetryableRunStatus(status: SyncRunStatus | string): boolean {
  return Boolean(RETRYABLE[status])
}
