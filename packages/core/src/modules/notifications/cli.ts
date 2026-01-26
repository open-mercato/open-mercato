import type { Command } from '@open-mercato/shared/lib/commands/types'
import { createQueue } from '@open-mercato/queue'
import type { CleanupExpiredJob } from './workers/create-notification.worker'

const cleanupCommand: Command = {
  name: 'cleanup-expired',
  description: 'Clean up expired notifications',
  async execute() {
    const queue = createQueue('notifications', 'async')

    await queue.enqueue<CleanupExpiredJob>({
      type: 'cleanup-expired',
    })

    console.log('✓ Cleanup job enqueued')
  },
}

export default {
  commands: [cleanupCommand],
}
