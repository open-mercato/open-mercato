import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

/**
 * Module-scoped wrappers around shared API helpers. Mirrors customers/api/utils.ts.
 * Centralizes the i18n message keys used when tenant or organization context is missing.
 */
const { withScopedPayload, parseScopedCommandInput } = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'materials.errors.tenant_required', fallback: 'Tenant context is required' },
    organizationRequired: { key: 'materials.errors.organization_required', fallback: 'Organization context is required' },
  },
})

export { withScopedPayload, parseScopedCommandInput }
