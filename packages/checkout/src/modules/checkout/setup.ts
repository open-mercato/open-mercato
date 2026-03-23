import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureCheckoutFieldsetsAndDefinitions } from './seed/customFields'
import { seedCheckoutExamples } from './seed/examples'
export { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from './lib/defaults'

export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    await ensureCheckoutFieldsetsAndDefinitions(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },

  defaultRoleFeatures: {
    superadmin: ['checkout.*'],
    admin: ['checkout.view', 'checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii', 'checkout.export'],
    employee: ['checkout.view'],
  },

  async seedExamples(ctx) {
    await seedCheckoutExamples(ctx)
  },
}

export default setup
