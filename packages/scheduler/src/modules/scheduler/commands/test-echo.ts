import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'test-echo' })

/**
 * A simple test command that prints its arguments and returns them.
 * Useful for verifying scheduler command-target execution end-to-end.
 *
 * Register a schedule with:
 *   targetType: 'command'
 *   targetCommand: 'scheduler.test.echo'
 *   targetPayload: { "message": "hello", "count": 42 }
 */
const testEchoCommand: CommandHandler<Record<string, unknown>, { echoed: Record<string, unknown>; timestamp: string }> = {
  id: 'scheduler.test.echo',

  async execute(input) {
    const timestamp = new Date().toISOString()

    logger.info('Echo command received', { timestamp, input })

    return { echoed: input, timestamp }
  },
}

registerCommand(testEchoCommand)
