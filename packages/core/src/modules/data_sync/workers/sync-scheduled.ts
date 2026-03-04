import type { WorkerMeta } from '@open-mercato/queue'

export const metadata: WorkerMeta = {
  queue: 'data-sync-scheduled',
  id: 'data-sync:scheduled',
  concurrency: 3,
}

export default async function handle(): Promise<void> {
  return
}
