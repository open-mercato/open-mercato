import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'ecommerce.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'ecommerce.errors.organization_required', fallback: 'Organization context is required' },
  },
})

export { withScopedPayload, parseScopedCommandInput }
