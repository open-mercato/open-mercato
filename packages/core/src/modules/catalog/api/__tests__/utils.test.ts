const helperStubs = {
  withScopedPayload: jest.fn(),
  parseScopedCommandInput: jest.fn(),
  requireRecordId: jest.fn(),
  resolveCrudRecordId: jest.fn(),
}

const createScopedApiHelpers = jest.fn().mockReturnValue(helperStubs)

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  createScopedApiHelpers,
}))

describe('catalog api utils', () => {
  beforeEach(() => {
    jest.resetModules()
    createScopedApiHelpers.mockClear()
  })

  it('configures scoped helpers with catalog-specific message keys', () => {
    jest.isolateModules(() => {
      const utils = require('../utils')
      expect(createScopedApiHelpers).toHaveBeenCalledWith({
        messages: {
          tenantRequired: { key: 'catalog.errors.tenant_required', fallback: 'Tenant context is required.' },
          organizationRequired: { key: 'catalog.errors.organization_required', fallback: 'Organization context is required.' },
          idRequired: { key: 'catalog.errors.id_required', fallback: 'Record identifier is required.' },
        },
      })
      expect(utils.withScopedPayload).toBe(helperStubs.withScopedPayload)
      expect(utils.parseScopedCommandInput).toBe(helperStubs.parseScopedCommandInput)
      expect(utils.requireRecordId).toBe(helperStubs.requireRecordId)
      expect(utils.resolveCrudRecordId).toBe(helperStubs.resolveCrudRecordId)
    })
  })
})
