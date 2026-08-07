import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('example').child({ interceptor: 'audit-logging' })

/**
 * Example command interceptor: audit logging for customer commands.
 *
 * Demonstrates the command interceptor contract (m4): beforeExecute stores
 * a timestamp in metadata, afterExecute logs the duration.
 */
const auditLoggingInterceptor: CommandInterceptor = {
  id: 'example.audit-logging',
  targetCommand: 'customers.*',
  priority: 50,

  async beforeExecute(_input, _context) {
    return {
      ok: true,
      metadata: { auditStartedAt: Date.now() },
    }
  },

  async afterExecute(_input, _result, context) {
    const startedAt = context.metadata?.auditStartedAt as number | undefined
    if (startedAt) {
      logger.info('Command completed', {
        commandId: context.commandId,
        durationMs: Date.now() - startedAt,
      })
    }
  },
}

export const interceptors: CommandInterceptor[] = [auditLoggingInterceptor]
