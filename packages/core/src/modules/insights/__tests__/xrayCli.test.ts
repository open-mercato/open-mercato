const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { formatXrayStatus, parseXrayArgs, resolveXrayTargets, validateXrayScopeArgs } from '../cli'
import type { XrayStatus } from '../lib/projection/jobs'
import { XRAY_SETTINGS_DEFAULTS } from '../lib/projection/settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'

describe('parseXrayArgs', () => {
  it('parses tenant, organization, the inline flag and the explicit all-tenants flag', () => {
    expect(parseXrayArgs(['--tenant', TENANT_ID.toUpperCase(), `--org=${ORG_ID}`, '--inline'])).toEqual({
      ok: true,
      args: { tenantId: TENANT_ID, organizationId: ORG_ID, inline: true, all: false },
    })
    expect(parseXrayArgs([])).toEqual({ ok: true, args: { tenantId: null, organizationId: null, inline: false, all: false } })
    expect(parseXrayArgs(['--all'])).toEqual({ ok: true, args: { tenantId: null, organizationId: null, inline: false, all: true } })
  })

  it.each([
    [['--tenant', 'abc'], '--tenant must be a UUID'],
    [['--tenant', TENANT_ID, '--org', 'abc'], '--org must be a UUID'],
    [['--org', ORG_ID], '--org requires --tenant'],
    [['--all', '--tenant', TENANT_ID], '--all cannot be combined with --tenant or --org'],
  ])('rejects %p', (args, error) => {
    expect(parseXrayArgs(args)).toEqual({ ok: false, error })
  })
})

describe('validateXrayScopeArgs', () => {
  const unscoped = { tenantId: null, organizationId: null, inline: false, all: false }

  it('refuses a destructive command without --tenant or an explicit --all', () => {
    expect(validateXrayScopeArgs(unscoped, 'xray:rebuild', { destructive: true })).toBe('xray:rebuild requires --tenant <id> (optionally --org <id>) or --all')
    expect(validateXrayScopeArgs(unscoped, 'xray:prune', { destructive: true })).toBe('xray:prune requires --tenant <id> (optionally --org <id>) or --all')
  })

  it('accepts a scoped or an explicitly global destructive command, and a non-destructive one without scope', () => {
    expect(validateXrayScopeArgs({ ...unscoped, tenantId: TENANT_ID }, 'xray:rebuild', { destructive: true })).toBeNull()
    expect(validateXrayScopeArgs({ ...unscoped, all: true }, 'xray:prune', { destructive: true })).toBeNull()
    expect(validateXrayScopeArgs(unscoped, 'xray:status', { destructive: false })).toBeNull()
  })
})

describe('resolveXrayTargets', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
  })

  it('targets one organization after verifying it belongs to the tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: ORG_ID })
    expect(await resolveXrayTargets({} as EntityManager, { tenantId: TENANT_ID, organizationId: ORG_ID, inline: false, all: false }))
      .toEqual({ ok: true, targets: [{ tenantId: TENANT_ID, organizationId: ORG_ID }] })
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: ORG_ID, tenant: TENANT_ID }, undefined, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('refuses an organization of another tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    const resolved = await resolveXrayTargets({} as EntityManager, { tenantId: TENANT_ID, organizationId: ORG_ID, inline: false, all: false })
    expect(resolved).toEqual({ ok: false, error: expect.stringMatching(/^\[internal\] .*does not belong/) })
  })

  it('lists the live organizations of a tenant', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: ORG_ID, tenant: { id: TENANT_ID } },
      { id: '22222222-0000-4000-8000-000000000002', tenant: TENANT_ID },
      { id: '22222222-0000-4000-8000-000000000003', tenant: null },
    ])
    const targets = await resolveXrayTargets({} as EntityManager, { tenantId: TENANT_ID, organizationId: null, inline: false, all: false })
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { deletedAt: null, tenant: TENANT_ID },
      { orderBy: { id: 'asc' } },
      { tenantId: TENANT_ID, organizationId: null },
    )
    expect(targets).toEqual({
      ok: true,
      targets: [
        { tenantId: TENANT_ID, organizationId: ORG_ID },
        { tenantId: TENANT_ID, organizationId: '22222222-0000-4000-8000-000000000002' },
      ],
    })
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
