import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const {
  withScopedPayload,
  parseScopedCommandInput,
  requireRecordId,
  resolveCrudRecordId,
} = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'fms_quotes.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'fms_quotes.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'fms_quotes.errors.id_required', fallback: 'Record identifier is required.' },
  },
})

export { withScopedPayload, parseScopedCommandInput, requireRecordId, resolveCrudRecordId }
