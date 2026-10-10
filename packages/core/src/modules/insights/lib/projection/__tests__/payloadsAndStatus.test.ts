const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  XrayScopeMismatchError,
  assertXrayScope,
  isOrganizationInTenant,
  readBackfillPayload,
  readIngestPayload,
  readIngestScope,
  resolveOrganizationTenants,
} from '../payloads'
import { XRAY_FANOUT_KIND } from '../queue'
import { toXrayStatusResponse } from '../statusView'
import { xrayStatusResponseSchema } from '../../../data/validators'
import type { XrayStatus } from '../jobs'
import type { ProjectionCursor } from '../store'
import { XRAY_SETTINGS_DEFAULTS } from '../settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
const OTHER_ORG_ID = '22222222-0000-4000-8000-000000000002'
const SCAN_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const CHAIN_ID = 'bbbbbbbb-0000-4000-8000-000000000001'

describe('readIngestScope', () => {
  it('reads the nested scheduler payload first, then the top-level fields', () => {
    expect(readIngestScope({ scope: { tenantId: TENANT_ID.toUpperCase(), organizationId: ORG_ID } })).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(readIngestScope({ tenantId: TENANT_ID, organizationId: ORG_ID })).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('refuses a missing or malformed scope instead of widening it', () => {
    expect(readIngestScope({ scope: { tenantId: TENANT_ID } })).toBeNull()
    expect(readIngestScope({ tenantId: 'tenant', organizationId: ORG_ID })).toBeNull()
    expect(readIngestScope(null)).toBeNull()
  })

  it('never pairs the tenant of one source with the organization of another', () => {
    expect(readIngestScope({ scope: { tenantId: OTHER_TENANT_ID }, tenantId: TENANT_ID, organizationId: ORG_ID })).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(readIngestScope({ scope: { organizationId: OTHER_ORG_ID }, tenantId: TENANT_ID })).toBeNull()
  })
})

describe('readIngestPayload', () => {
  it('recognizes the system fan-out tick the scheduler dispatches with an empty scope', () => {
    expect(readIngestPayload({ kind: XRAY_FANOUT_KIND, scope: { tenantId: null, organizationId: null }, tenantId: null, organizationId: null, _jobOrigin: 'scheduler' }))
      .toEqual({ kind: 'fanout' })
  })

  it('reads an organization job and flags one fired by a per-organization schedule of the previous design', () => {
    expect(readIngestPayload({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID } }))
      .toEqual({ kind: 'organization', scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, legacySchedule: false })
    expect(readIngestPayload({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, tenantId: TENANT_ID, organizationId: ORG_ID, _jobOrigin: 'scheduler' }))
      .toEqual({ kind: 'organization', scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, legacySchedule: true })
  })

  it('rejects a payload without a scope or a known kind', () => {
    expect(readIngestPayload({ kind: 'other' })).toBeNull()
    expect(readIngestPayload({ scope: { tenantId: null, organizationId: null }, _jobOrigin: 'scheduler' })).toBeNull()
    expect(readIngestPayload('nope')).toBeNull()
  })
})

describe('X-Ray scope verification', () => {
  const em = {} as EntityManager

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
  })

  it('accepts an organization of the tenant with one scoped lookup', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: ORG_ID })
    expect(await isOrganizationInTenant(em, { tenantId: TENANT_ID, organizationId: ORG_ID })).toBe(true)
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { id: ORG_ID, tenant: TENANT_ID },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('rejects an organization of another tenant with an [internal] error', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    await expect(assertXrayScope(em, { tenantId: OTHER_TENANT_ID, organizationId: ORG_ID })).rejects.toBeInstanceOf(XrayScopeMismatchError)
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    await expect(assertXrayScope(em, { tenantId: OTHER_TENANT_ID, organizationId: ORG_ID })).rejects.toThrow(/^\[internal\]/)
  })

  it('resolves the tenant of a page of organizations in one query', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: ORG_ID, tenant: { id: TENANT_ID } },
      { id: OTHER_ORG_ID, tenant: OTHER_TENANT_ID },
    ])
    const tenants = await resolveOrganizationTenants(em, [ORG_ID, OTHER_ORG_ID, ORG_ID])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ id: { $in: [ORG_ID, OTHER_ORG_ID] } })
    expect(Array.from(tenants.entries())).toEqual([[ORG_ID, TENANT_ID], [OTHER_ORG_ID, OTHER_TENANT_ID]])
    expect((await resolveOrganizationTenants(em, [])).size).toBe(0)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
  })
})

describe('readBackfillPayload', () => {
  it('normalizes a valid payload and drops invalid optional ids', () => {
    expect(readBackfillPayload({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID, userId: 'nope' }, scanId: SCAN_ID, chainId: CHAIN_ID, progressJobId: 'nope' }))
      .toEqual({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID, userId: null }, scanId: SCAN_ID, chainId: CHAIN_ID, progressJobId: null })
  })

  it('rejects payloads without a scoped scan and its job chain', () => {
    expect(readBackfillPayload({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, scanId: 'x', chainId: CHAIN_ID })).toBeNull()
    expect(readBackfillPayload({ scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, scanId: SCAN_ID })).toBeNull()
    expect(readBackfillPayload({ scanId: SCAN_ID })).toBeNull()
    expect(readBackfillPayload('nope')).toBeNull()
  })
})

function cursor(overrides: Partial<ProjectionCursor> = {}): ProjectionCursor {
  return {
    id: 'cursor-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lastCreatedAt: '2026-10-08T10:00:00.000000Z',
    lastLogId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    stateWatermark: '2026-10-08T10:00:00.000000Z',
    stateLastLogId: null,
    scanId: SCAN_ID,
    scanKind: 'backfill',
    scanFrom: '2025-10-08T10:00:00.000000Z',
    scanUntil: '2026-10-08T10:00:00.000000Z',
    scanAfterCreatedAt: '2026-01-01T00:00:00.000000Z',
    scanAfterLogId: null,
    scanProgressJobId: null,
    scanProcessedCount: 42,
    scanStartedAt: '2026-10-08T09:00:00.000000Z',
    scanUpdatedAt: '2026-10-08T09:30:00.000000Z',
    scanChainId: CHAIN_ID,
    actorKeyFingerprint: 'tk1:fingerprint',
    lastReconciledAt: null,
    lastFullReconciledAt: null,
    lastPrunedAt: null,
    leaseOwner: 'worker',
    leaseToken: 3,
    leaseUntil: '2026-10-08T10:02:00.000000Z',
    contractHashes: { 'customers.deal': 'deal-hash' },
    pendingRebuildKeys: [],
    scanProcessKeys: null,
    contractChangedAt: null,
    contractChange: null,
    coverageFrom: '2026-10-01T00:00:00.000000Z',
    historyScannedAt: null,
    undecryptableRows: 0,
    overlapTimeouts: 0,
    lastOverlapTimeoutAt: null,
    status: 'backfilling',
    lastRunAt: null,
    lastError: null,
    ...overrides,
  }
}

describe('toXrayStatusResponse', () => {
  const base: XrayStatus = {
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    ingestEnabled: true,
    settings: { id: null, updatedAt: null, ...XRAY_SETTINGS_DEFAULTS },
    registry: { ready: true, contractHash: 'hash-1', processes: [{ processKey: 'customers.deal', labelKey: 'customers.insights.process.deal', moduleId: 'customers' }], rejected: 0 },
    cursor: cursor(),
    counts: [{ processKey: 'customers.deal', events: 10, voidedEvents: 2, cases: 3, openCases: 1, firstOccurredAt: '2026-01-02T00:00:00.000000Z', lastOccurredAt: '2026-10-08T09:59:00.000000Z' }],
  }

  it('maps the cursor, scan and counts into the documented response', () => {
    const response = toXrayStatusResponse(base, Date.parse('2026-10-08T10:00:00.000Z'))
    expect(xrayStatusResponseSchema.parse(response)).toEqual(response)
    expect(response.computedThrough).toBe('2026-10-08T10:00:00.000000Z')
    expect(response.cursor).toEqual(expect.objectContaining({ status: 'backfilling', contractMatches: true, rebuildingProcessKeys: [], leaseActive: true }))
    expect(response.cursor?.scan).toEqual(expect.objectContaining({ id: SCAN_ID, kind: 'backfill', processed: 42, position: '2026-01-01T00:00:00.000000Z', processKeys: null }))
    expect(response.processes).toEqual([{ processKey: 'customers.deal', n: 10, voidedEvents: 2, cases: 3, openCases: 1, firstOccurredAt: '2026-01-02T00:00:00.000000Z', lastOccurredAt: '2026-10-08T09:59:00.000000Z' }])
    expect(response.countsTimedOut).toBe(false)
    expect(JSON.stringify(response)).not.toContain('tk1:fingerprint')
    expect(JSON.stringify(response)).not.toContain(CHAIN_ID)
    expect(JSON.stringify(response)).not.toContain('deal-hash')
  })

  it('reports pending per-process rebuilds, an expired lease and a missing cursor', () => {
    const rebuilding = toXrayStatusResponse({
      ...base,
      cursor: cursor({
        scanProcessKeys: ['customers.deal'],
        pendingRebuildKeys: ['sales.order'],
        contractChangedAt: '2026-10-08T10:30:00.000000Z',
        contractChange: { changed: ['customers.deal'], added: ['sales.order'], removed: ['legacy.process'] },
      }),
    }, Date.parse('2026-10-08T11:00:00.000Z'))
    expect(xrayStatusResponseSchema.parse(rebuilding)).toEqual(rebuilding)
    expect(rebuilding.cursor).toEqual(expect.objectContaining({
      contractMatches: false,
      rebuildingProcessKeys: ['customers.deal', 'sales.order'],
      contractChange: { at: '2026-10-08T10:30:00.000000Z', changed: ['customers.deal'], added: ['sales.order'], removed: ['legacy.process'] },
      leaseActive: false,
    }))
    expect(rebuilding.cursor?.scan?.processKeys).toEqual(['customers.deal'])
    const unadopted = toXrayStatusResponse({ ...base, cursor: cursor({ contractHashes: null, scanId: null }) })
    expect(unadopted.cursor).toEqual(expect.objectContaining({ contractMatches: false, scan: null }))
    const empty = toXrayStatusResponse({ ...base, cursor: null, counts: [] })
    expect(empty).toEqual(expect.objectContaining({ cursor: null, computedThrough: null, coverageFrom: null, processes: [] }))
  })

  it('exposes where the projection is complete from, so computedThrough is never read as full history', () => {
    const now = Date.parse('2026-10-08T10:00:00.000Z')
    const fresh = toXrayStatusResponse(base, now)
    expect(fresh.coverageFrom).toBe('2026-10-01T00:00:00.000000Z')
    expect(fresh.cursor).toEqual(expect.objectContaining({ coverageFrom: '2026-10-01T00:00:00.000000Z', historyScanned: false, historyScannedAt: null }))
    const backfilled = toXrayStatusResponse({
      ...base,
      cursor: cursor({ coverageFrom: '2020-01-01T00:00:00.000000Z', historyScannedAt: '2026-10-07T00:00:00.000000Z' }),
    }, now)
    expect(backfilled.coverageFrom).toBe(new Date(now - XRAY_SETTINGS_DEFAULTS.retentionDays * 24 * 60 * 60_000).toISOString().replace(/Z$/, '000Z'))
    expect(backfilled.cursor).toEqual(expect.objectContaining({ historyScanned: true, historyScannedAt: '2026-10-07T00:00:00.000000Z' }))
  })

  it('shows skipped rows and overlap timeouts as counts', () => {
    const response = toXrayStatusResponse({ ...base, cursor: cursor({ undecryptableRows: 4, overlapTimeouts: 2, lastOverlapTimeoutAt: '2026-10-08T09:00:00.000000Z' }) })
    expect(response.cursor).toEqual(expect.objectContaining({ undecryptableRows: 4, overlapTimeouts: 2, lastOverlapTimeoutAt: '2026-10-08T09:00:00.000000Z' }))
  })

  it('degrades to null counts with a flag when the counts timed out, still listing registered processes', () => {
    const response = toXrayStatusResponse({ ...base, counts: [], countsTimedOut: true })
    expect(xrayStatusResponseSchema.parse(response)).toEqual(response)
    expect(response.countsTimedOut).toBe(true)
    expect(response.processes).toEqual([{ processKey: 'customers.deal', n: null, voidedEvents: null, cases: null, openCases: null, firstOccurredAt: null, lastOccurredAt: null }])
  })

  it('lists only registered processes: rows of a disabled module stay but are not shown', () => {
    const response = toXrayStatusResponse({
      ...base,
      counts: [
        ...base.counts,
        { processKey: 'retired.process', events: 7, voidedEvents: 0, cases: 1, openCases: 0, firstOccurredAt: null, lastOccurredAt: null },
      ],
    })
    expect(response.processes.map((process) => process.processKey)).toEqual(['customers.deal'])
  })
})
