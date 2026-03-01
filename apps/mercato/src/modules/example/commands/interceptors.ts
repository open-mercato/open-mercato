import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

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
      const duration = Date.now() - startedAt
      // eslint-disable-next-line no-console
      console.log(
        `[example:audit] Command ${context.commandId} completed in ${duration}ms`,
      )
    }
  },
}

export const interceptors: CommandInterceptor[] = [auditLoggingInterceptor]
