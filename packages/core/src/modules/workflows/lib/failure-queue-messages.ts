type Translate = (key: string, fallback: string) => string

export type BulkReplayAction = 'retry' | 'cancel'

/**
 * Bulk replay is only tracked in the top bar when the progress module handed back a job
 * (#9217); without one the confirmation must not tell the user to look there.
 */
export function resolveBulkReplayStartedMessage(
  action: BulkReplayAction,
  progressJobId: string | null | undefined,
  t: Translate,
): string {
  if (progressJobId) {
    return action === 'retry'
      ? t('workflows.failureQueue.messages.retryStarted', 'Replay started. Track progress in the top bar.')
      : t('workflows.failureQueue.messages.cancelStarted', 'Cancellation started. Track progress in the top bar.')
  }
  return action === 'retry'
    ? t('workflows.failureQueue.messages.retryQueued', 'Replay queued.')
    : t('workflows.failureQueue.messages.cancelQueued', 'Cancellation queued.')
}
