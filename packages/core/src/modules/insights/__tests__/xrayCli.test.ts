const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { formatXrayStatus, parseXrayArgs, resolveXrayTargets } from '../cli'
import type { XrayStatus } from '../lib/projection/jobs'
import { XRAY_SETTINGS_DEFAULTS } from '../lib/projection/settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'

describe('parseXrayArgs', () => {
  it('parses tenant, organization and the inline flag', () => {
    expect(parseXrayArgs(['--tenant', TENANT_ID.toUpperCase(), `--org=${ORG_ID}`, '--inline'])).toEqual({
      ok: true,
      args: { tenantId: TENANT_ID, organizationId: ORG_ID, inline: true },
    })
    expect(parseXrayArgs([])).toEqual({ ok: true, args: { tenantId: null, organizationId: null, inline: false } })
  })

  it.each([
    [['--tenant', 'abc'], '--tenant must be a UUID'],
    [['--tenant', TENANT_ID, '--org', 'abc'], '--org must be a UUID'],
    [['--org', ORG_ID], '--org requires --tenant'],
  ])('rejects %p', (args, error) => {
    expect(parseXrayArgs(args)).toEqual({ ok: false, error })
  })
})

describe('resolveXrayTargets', () => {
  beforeEach(() => findWithDecryptionMock.mockReset())

  it('targets one organization without a query when both ids are given', async () => {
    expect(await resolveXrayTargets({} as EntityManager, { tenantId: TENANT_ID, organizationId: ORG_ID, inline: false }))
      .toEqual([{ tenantId: TENANT_ID, organizationId: ORG_ID }])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('lists the live organizations of a tenant', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: ORG_ID, tenant: { id: TENANT_ID } },
      { id: '22222222-0000-4000-8000-000000000002', tenant: TENANT_ID },
      { id: '22222222-0000-4000-8000-000000000003', tenant: null },
    ])
    const targets = await resolveXrayTargets({} as EntityManager, { tenantId: TENANT_ID, organizationId: null, inline: false })
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { deletedAt: null, tenant: TENANT_ID },
      { orderBy: { id: 'asc' } },
      { tenantId: TENANT_ID, organizationId: null },
    )
    expect(targets).toEqual([
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      { tenantId: TENANT_ID, organizationId: '22222222-0000-4000-8000-000000000002' },
    ])
  })
})

describe('formatXrayStatus', () => {
  const status: XrayStatus = {
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    ingestEnabled: false,
    settings: { id: null, updatedAt: null, ...XRAY_SETTINGS_DEFAULTS },
    registry: { ready: true, contractHash: 'hash', processes: [], rejected: 0 },
    cursor: null,
    counts: [{ processKey: 'customers.deal', events: 5, voidedEvents: 1, cases: 2, openCases: 1, firstOccurredAt: null, lastOccurredAt: null }],
  }

  it('prints settings, cursor state and counts', () => {
    expect(formatXrayStatus(status)).toEqual([
      `- tenant=${TENANT_ID} org=${ORG_ID}`,
      '    settings: enabled=true retentionDays=365 ingestToggle=off',
      '    cursor: none (not ingested yet)',
      '    customers.deal: events=5 voided=1 cases=2 open=1',
    ])
  })

  it('prints the coverage, the processes being rebuilt and timed-out counts', () => {
    const cursor: XrayStatus['cursor'] = {
      id: 'cursor-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      lastCreatedAt: '2026-10-08T10:00:00.000000Z',
      lastLogId: null,
      stateWatermark: null,
      stateLastLogId: null,
      scanId: null,
      scanKind: null,
      scanFrom: null,
      scanUntil: null,
      scanAfterCreatedAt: null,
      scanAfterLogId: null,
      scanProgressJobId: null,
      scanProcessedCount: 0,
      scanStartedAt: null,
      scanUpdatedAt: null,
      scanChainId: null,
      actorKeyFingerprint: null,
      lastReconciledAt: null,
      lastFullReconciledAt: null,
      lastPrunedAt: null,
      leaseOwner: null,
      leaseToken: 0,
      leaseUntil: null,
      contractHashes: { 'customers.deal': 'hash' },
      pendingRebuildKeys: ['sales.order'],
      scanProcessKeys: ['customers.deal'],
      contractChangedAt: null,
      contractChange: null,
      coverageFrom: '2026-10-01T00:00:00.000000Z',
      historyScannedAt: null,
      undecryptableRows: 0,
      overlapTimeouts: 0,
      lastOverlapTimeoutAt: null,
      status: 'idle',
      lastRunAt: null,
      lastError: null,
    }
    expect(formatXrayStatus({ ...status, cursor, counts: [], countsTimedOut: true })).toEqual([
      `- tenant=${TENANT_ID} org=${ORG_ID}`,
      '    settings: enabled=true retentionDays=365 ingestToggle=off',
      '    cursor: status=idle computedThrough=2026-10-08T10:00:00.000000Z coverageFrom=2026-10-01T00:00:00.000000Z rebuilding=sales.order,customers.deal',
      '    counts: unavailable (timed out)',
    ])
  })
})
