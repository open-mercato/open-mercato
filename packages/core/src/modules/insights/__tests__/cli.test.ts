import type { ExplainResourceDescriptor } from '@open-mercato/shared/modules/insights/explain'
import { collectExplainCoverage, formatExplainCoverage, parseCoverageArgs } from '../cli'
import type { RegisteredExplainResource } from '../lib/explain-registry'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'

function resource(overrides: Partial<ExplainResourceDescriptor> = {}, moduleId = 'customers'): RegisteredExplainResource {
  return {
    moduleId,
    descriptor: {
      resourceKind: 'customers.deal',
      labelKey: 'deal',
      requiredFeatures: [],
      loadCurrent: async () => null,
      fields: [],
      ...overrides,
    },
  }
}

describe('parseCoverageArgs', () => {
  it('parses all options in both flag styles', () => {
    expect(parseCoverageArgs(['--tenant', TENANT_ID, `--org=${ORG_ID}`, '--since', '2026-01-01', '--limit', '50'])).toEqual({
      ok: true,
      args: { tenantId: TENANT_ID, organizationId: ORG_ID, since: new Date('2026-01-01'), limit: 50 },
    })
  })

  it('defaults and caps the sample limit', () => {
    expect(parseCoverageArgs([])).toEqual({ ok: true, args: { tenantId: null, organizationId: null, since: null, limit: 100 } })
    expect(parseCoverageArgs(['--limit', '99999'])).toEqual(expect.objectContaining({ args: expect.objectContaining({ limit: 1000 }) }))
  })

  it.each([
    [['--tenant', 'abc'], '--tenant must be a UUID'],
    [['--org', ORG_ID], '--org requires --tenant'],
    [['--since', 'yesterday'], '--since must be an ISO-8601 date'],
    [['--limit', '0'], '--limit must be a positive integer'],
  ])('rejects %p', (args, error) => {
    expect(parseCoverageArgs(args)).toEqual({ ok: false, error })
  })
})

describe('collectExplainCoverage', () => {
  it('aggregates cause buckets per resource and samples records without history', async () => {
    const actionLogService = {
      countHistoryByCause: jest.fn(async () => [
        { resourceKind: 'customers.deal', causeKind: 'user', count: 6 },
        { resourceKind: 'customers.deal', causeKind: 'unknown', count: 2 },
        { resourceKind: 'customers.deal', causeKind: null, count: 2 },
        { resourceKind: 'sales.order', causeKind: 'workflow', count: 3 },
      ]),
      findResourceIdsWithHistory: jest.fn(async () => ['deal-1']),
    }
    const listRecordIds = jest.fn(async () => ['deal-1', 'deal-2', 'deal-2'])
    const coverage = await collectExplainCoverage({
      resources: [
        resource({ listRecordIds }),
        resource({ resourceKind: 'customer_groups.group', noHistory: { reasonKey: 'customer_groups.noHistory' } }, 'customer_groups'),
      ],
      actionLogService,
      em: {} as never,
      args: { tenantId: TENANT_ID, organizationId: null, since: null, limit: 10 },
    })

    expect(actionLogService.countHistoryByCause).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationId: null,
      resourceKinds: ['customers.deal', 'customer_groups.group'],
      since: null,
    })
    expect(listRecordIds).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { tenantId: TENANT_ID, organizationIds: null } }),
      { limit: 10, afterId: null },
    )
    expect(coverage[1]).toEqual(expect.objectContaining({
      resourceKind: 'customers.deal',
      total: 10,
      byCause: { user: 6, unknown: 2, legacy: 2 },
      unknownShare: 0.2,
      legacyShare: 0.2,
      sampledRecords: 2,
      recordsWithoutHistory: 1,
    }))
    expect(coverage[0]).toEqual(expect.objectContaining({
      resourceKind: 'customer_groups.group',
      total: 0,
      noHistoryReasonKey: 'customer_groups.noHistory',
      sampledRecords: null,
    }))

    const output = formatExplainCoverage(coverage, { tenantId: TENANT_ID, organizationId: null, since: null, limit: 10 })
    expect(output).toEqual(expect.arrayContaining([
      '- customers.deal (customers)',
      '    history rows: 10',
      '      legacy: 2 (20.0%)',
      '    unknown cause share: 20.0%',
      '    records without history: 1 of 2 sampled',
      '    declared without history: customer_groups.noHistory',
    ]))
  })

  it('does not sample records without a tenant', async () => {
    const listRecordIds = jest.fn(async () => ['deal-1'])
    const coverage = await collectExplainCoverage({
      resources: [resource({ listRecordIds })],
      actionLogService: { countHistoryByCause: jest.fn(async () => []), findResourceIdsWithHistory: jest.fn() },
      em: {} as never,
      args: { tenantId: null, organizationId: null, since: null, limit: 10 },
    })

    expect(listRecordIds).not.toHaveBeenCalled()
    expect(coverage[0].recordsWithoutHistory).toBeNull()
  })

  it('prints a hint when nothing is registered', () => {
    expect(formatExplainCoverage([], { tenantId: null, organizationId: null, since: null, limit: 10 })[1]).toContain('No explain resources are registered')
  })
})
