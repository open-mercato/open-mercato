import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { enableNdaReviewWorkflowCommands, seedNdaReviewWorkflowDefinition } from './lib/seeds'

const logger = createLogger('legal_review').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['legal_review.*'],
    admin: ['legal_review.matters.view', 'legal_review.matters.manage'],
    employee: ['legal_review.matters.view'],
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedNdaReviewWorkflowDefinition(ctx.em, scope)
    try {
      await enableNdaReviewWorkflowCommands(ctx.container, ctx.tenantId)
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'legal_review',
        code: 'legal_review.seed_command_enablement_failed',
      })
      logger.warn('could not enable the NDA review workflow commands; enable them in Workflows settings', {
        tenantId: ctx.tenantId,
        err: error,
      })
    }
  },
}

export default setup
