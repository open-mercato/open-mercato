import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const {
  withScopedPayload,
  parseScopedCommandInput,
  requireRecordId,
  resolveCrudRecordId,
} = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'sales.configuration.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'sales.configuration.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'sales.configuration.errors.id_required', fallback: 'Record identifier is required.' },
  },
})

export { withScopedPayload, parseScopedCommandInput, requireRecordId, resolveCrudRecordId }
