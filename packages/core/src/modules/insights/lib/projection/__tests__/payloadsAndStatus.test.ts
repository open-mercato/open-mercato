import { readBackfillPayload, readIngestScope } from '../payloads'
import { toXrayStatusResponse } from '../statusView'
import { xrayStatusResponseSchema } from '../../../data/validators'
import type { XrayStatus } from '../jobs'
import type { ProjectionCursor } from '../store'
import { XRAY_SETTINGS_DEFAULTS } from '../settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
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
    contractHash: 'hash-1',
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
    counts: [{ processKey: 'customers.deal', events: 10, voidedEvents: 2, cases: 3, openCases: 1, lastOccurredAt: '2026-10-08T09:59:00.000000Z' }],
  }

  it('maps the cursor, scan and counts into the documented response', () => {
    const response = toXrayStatusResponse(base, Date.parse('2026-10-08T10:00:00.000Z'))
    expect(xrayStatusResponseSchema.parse(response)).toEqual(response)
    expect(response.computedThrough).toBe('2026-10-08T10:00:00.000000Z')
    expect(response.cursor).toEqual(expect.objectContaining({ status: 'backfilling', contractMatches: true, leaseActive: true }))
    expect(response.cursor?.scan).toEqual(expect.objectContaining({ id: SCAN_ID, kind: 'backfill', processed: 42, position: '2026-01-01T00:00:00.000000Z' }))
    expect(response.processes).toEqual([{ processKey: 'customers.deal', n: 10, voidedEvents: 2, cases: 3, openCases: 1, lastOccurredAt: '2026-10-08T09:59:00.000000Z' }])
    expect(JSON.stringify(response)).not.toContain('tk1:fingerprint')
    expect(JSON.stringify(response)).not.toContain(CHAIN_ID)
  })

  it('reports an outdated contract, an expired lease and a missing cursor', () => {
    const outdated = toXrayStatusResponse({ ...base, cursor: cursor({ contractHash: 'old', scanId: null }) }, Date.parse('2026-10-08T11:00:00.000Z'))
    expect(outdated.cursor).toEqual(expect.objectContaining({ contractMatches: false, leaseActive: false, scan: null }))
    const empty = toXrayStatusResponse({ ...base, cursor: null, counts: [] })
    expect(empty).toEqual(expect.objectContaining({ cursor: null, computedThrough: null, processes: [] }))
  })
})
