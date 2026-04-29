import {
  inboxOpsSourceSubmissionRequestedSchema,
  type InboxOpsSourceSubmissionRequested,
} from '@open-mercato/shared/modules/inbox-ops-sources'
import { emitInboxOpsEvent } from '../events'

export function parseSourceSubmissionRequested(
  payload: unknown,
): InboxOpsSourceSubmissionRequested {
  return inboxOpsSourceSubmissionRequestedSchema.parse(payload)
}

export async function emitSourceSubmissionRequested(
  payload: InboxOpsSourceSubmissionRequested,
): Promise<void> {
  const parsed = inboxOpsSourceSubmissionRequestedSchema.parse(payload)

  await emitInboxOpsEvent(
    'inbox_ops.source_submission.requested',
    parsed,
    {
      persistent: true,
    },
  )
}
