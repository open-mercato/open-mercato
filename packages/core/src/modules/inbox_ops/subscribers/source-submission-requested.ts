import type { EntityManager } from '@mikro-orm/postgresql'
import { parseSourceSubmissionRequested } from '../lib/source-submission-request'
import { submitSourceSubmission } from '../lib/source-submission-service'

export const metadata = {
  event: 'inbox_ops.source_submission.requested',
  persistent: true,
  id: 'inbox_ops:source-submission-requested',
}

type SourceSubmissionRequestedContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  payload: unknown,
  ctx: SourceSubmissionRequestedContext,
): Promise<void> {
  const request = parseSourceSubmissionRequested(payload)
  const em = (ctx.resolve('em') as EntityManager).fork()

  await submitSourceSubmission(em, request)
}
