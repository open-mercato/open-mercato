import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerMessagesEmailRetrySchedule } from './lib/emailRetrySchedule'

const logger = createLogger('messages')

async function ensureEmailRetrySchedule(ctx: {
  container: import('awilix').AwilixContainer
  tenantId: string
  organizationId: string
}): Promise<void> {
  try {
    await registerMessagesEmailRetrySchedule(ctx.container, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  } catch (error) {
    logger.warn('Failed to register the email retry schedule', { err: error })
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['messages.*'],
    admin: ['messages.*'],
    employee: ['messages.*'],
  },

  async seedDefaults({ container, tenantId, organizationId }) {
    await ensureEmailRetrySchedule({ container, tenantId, organizationId })
  },

  async onOrganizationCreated({ container, tenantId, organizationId }) {
    await ensureEmailRetrySchedule({ container, tenantId, organizationId })
  },
}

export default setup
