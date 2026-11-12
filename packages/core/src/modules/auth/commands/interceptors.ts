import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

const integrationReplayFeatureInterceptor: CommandInterceptor = {
  id: 'auth.integration-replay-feature-lock',
  targetCommand: 'auth.users.update',
  priority: 1,
  features: ['directory.tenants.manage'],
  async beforeUndo({ logEntry }) {
    const entry = logEntry as { snapshotAfter?: Record<string, unknown> | null }
    if (entry.snapshotAfter?.name !== 'Feature replay after') return
    return {
      ok: false,
      status: 409,
      body: { error: '[internal] integration replay feature interceptor blocked undo' },
    }
  },
}

export const interceptors: CommandInterceptor[] = process.env.OM_TEST_MODE === '1'
  ? [integrationReplayFeatureInterceptor]
  : []

export default interceptors
