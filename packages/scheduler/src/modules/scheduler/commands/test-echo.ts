import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'

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

    console.log(`[scheduler:test-echo] Received args at ${timestamp}:`)
    console.log(JSON.stringify(input, null, 2))

    return { echoed: input, timestamp }
  },
}

registerCommand(testEchoCommand)
