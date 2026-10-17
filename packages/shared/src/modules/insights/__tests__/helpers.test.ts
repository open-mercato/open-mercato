const errorMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('../../../lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: errorMock }) }),
}))

jest.mock('../../../lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

import {
  flattenExplainCustomFields,
  isExplainRecordId,
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainNullableOrganizationWhere,
  resolveExplainOrganizationWhere,
  resolveExplainRecordIdPage,
  runExplainResolverSafely,
  toExplainTimestamp,
} from '../helpers'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

describe('insights explain helpers', () => {
  beforeEach(() => {
    errorMock.mockReset()
    reportErrorMock.mockReset()
  })

  describe('resolveExplainOrganizationWhere', () => {
    it('returns an empty filter for a tenant-wide scope', () => {
      expect(resolveExplainOrganizationWhere({ tenantId: TENANT_ID, organizationIds: null })).toEqual({})
    })

    it('denies an explicitly empty organization list', () => {
      expect(resolveExplainOrganizationWhere({ tenantId: TENANT_ID, organizationIds: [] })).toBeNull()
    })

    it('filters by the deduplicated organization list', () => {
      expect(
        resolveExplainOrganizationWhere({ tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B, ORG_A] }),
      ).toEqual({ organizationId: { $in: [ORG_A, ORG_B] } })
    })

    it('fails closed without a valid tenant', () => {
      expect(resolveExplainOrganizationWhere({ tenantId: '', organizationIds: null })).toBeNull()
    })
  })

  describe('resolveExplainNullableOrganizationWhere', () => {
    it('keeps shared rows visible next to the scoped organizations', () => {
      expect(resolveExplainNullableOrganizationWhere({ tenantId: TENANT_ID, organizationIds: [ORG_A] })).toEqual({
        $or: [{ organizationId: null }, { organizationId: { $in: [ORG_A] } }],
      })
    })

    it('mirrors the tenant-wide and deny semantics', () => {
      expect(resolveExplainNullableOrganizationWhere({ tenantId: TENANT_ID, organizationIds: null })).toEqual({})
      expect(resolveExplainNullableOrganizationWhere({ tenantId: TENANT_ID, organizationIds: [] })).toBeNull()
    })
  })

  it('uses a single organization as the decryption fallback only when unambiguous', () => {
    expect(resolveExplainDecryptionScope({ tenantId: TENANT_ID, organizationIds: [ORG_A] })).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_A,
    })
    expect(resolveExplainDecryptionScope({ tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B] })).toEqual({
      tenantId: TENANT_ID,
      organizationId: null,
    })
    expect(resolveExplainDecryptionScope({ tenantId: TENANT_ID, organizationIds: null })).toEqual({
      tenantId: TENANT_ID,
      organizationId: null,
    })
  })

  it('normalizes identifiers and optionally keeps only UUIDs', () => {
    expect(normalizeExplainIds([' a ', 'a', '', 7, null, 'b'])).toEqual(['a', 'b'])
    expect(normalizeExplainIds([ORG_A, 'not-a-uuid', ORG_A], { uuidOnly: true })).toEqual([ORG_A])
    expect(isExplainRecordId(ORG_A)).toBe(true)
    expect(isExplainRecordId('x')).toBe(false)
  })

  it('flattens custom field values under the cf: prefix', () => {
    expect(flattenExplainCustomFields({ priority: 1, cf_color: 'red', 'cf:size': 'L' })).toEqual({
      'cf:priority': 1,
      'cf:color': 'red',
      'cf:size': 'L',
    })
    expect(flattenExplainCustomFields(null)).toEqual({})
  })

  it('serializes timestamps defensively', () => {
    expect(toExplainTimestamp(new Date('2026-10-08T10:00:00.000Z'))).toBe('2026-10-08T10:00:00.000Z')
    expect(toExplainTimestamp(new Date('invalid'))).toBeNull()
    expect(toExplainTimestamp(null)).toBeNull()
  })

  describe('runExplainResolverSafely', () => {
    it('returns the resolver result', async () => {
      await expect(
        runExplainResolverSafely({ module: 'customers', code: 'customers.insights_reference_failed', kind: 'x' }, async () => [1, 2]),
      ).resolves.toEqual([1, 2])
      expect(reportErrorMock).not.toHaveBeenCalled()
    })

    it('logs, reports and returns an empty list on failure', async () => {
      const failure = new Error('boom')
      await expect(
        runExplainResolverSafely({ module: 'workflows', code: 'workflows.insights_cause_failed', kind: 'workflow' }, async () => {
          throw failure
        }),
      ).resolves.toEqual([])
      expect(errorMock).toHaveBeenCalledWith('[internal] insights explain resolver failed', { kind: 'workflow', err: failure })
      expect(reportErrorMock).toHaveBeenCalledWith(failure, {
        module: 'workflows',
        code: 'workflows.insights_cause_failed',
        attributes: { kind: 'workflow' },
      })
    })
  })
})

describe('resolveExplainRecordIdPage', () => {
  it('builds an ascending id keyset with a bounded limit', () => {
    expect(resolveExplainRecordIdPage({ limit: 50, afterId: null })).toEqual({ where: {}, limit: 50 })
    expect(resolveExplainRecordIdPage({ limit: 10, afterId: ORG_A.toUpperCase() })).toEqual({
      where: { id: { $gt: ORG_A } },
      limit: 10,
    })
    expect(resolveExplainRecordIdPage({ limit: 0, afterId: null })?.limit).toBe(1)
    expect(resolveExplainRecordIdPage({ limit: 99999, afterId: null })?.limit).toBe(1000)
    expect(resolveExplainRecordIdPage({ limit: Number.NaN, afterId: null })?.limit).toBe(1)
  })

  it('refuses a malformed cursor instead of restarting from the first page', () => {
    expect(resolveExplainRecordIdPage({ limit: 10, afterId: 'deal-1' })).toBeNull()
  })
})
