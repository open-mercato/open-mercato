import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const {
  withScopedPayload,
  parseScopedCommandInput,
  requireRecordId,
  resolveCrudRecordId,
} = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'catalog.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'catalog.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'catalog.errors.id_required', fallback: 'Record identifier is required.' },
  },
})

export { withScopedPayload, parseScopedCommandInput, requireRecordId, resolveCrudRecordId }
