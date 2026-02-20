import { createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'

const {
  parseScopedCommandInput,
  resolveCrudRecordId,
} = createScopedApiHelpers({
  messages: {
    tenantRequired: { key: 'wms.errors.tenant_required', fallback: 'Tenant context is required.' },
    organizationRequired: { key: 'wms.errors.organization_required', fallback: 'Organization context is required.' },
    idRequired: { key: 'wms.errors.id_required', fallback: 'Record identifier is required.' },
  },
})

export { parseScopedCommandInput, resolveCrudRecordId }
