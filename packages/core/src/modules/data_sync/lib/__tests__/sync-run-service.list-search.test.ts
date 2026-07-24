/** @jest-environment node */

import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncRun } from '../../data/entities'
import { createSyncRunService } from '../sync-run-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findAndCountWithDecryption: jest.fn().mockResolvedValue([[], 0]),
}))

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

function buildFakeEm() {
  return {}
}

function lastWhere(): Record<string, unknown> {
  const calls = (findAndCountWithDecryption as jest.Mock).mock.calls
  const [, , where] = calls[calls.length - 1]
  return where as Record<string, unknown>
}

describe('SyncRunService.listRuns — run-table search (issue #3215)', () => {
  beforeEach(() => {
    ;(findAndCountWithDecryption as jest.Mock).mockClear()
    ;(findAndCountWithDecryption as jest.Mock).mockResolvedValue([[], 0])
  })

  it('does not add a search filter when search is absent', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ page: 1, pageSize: 20 }, SCOPE)

    const where = lastWhere()
    expect(where.$or).toBeUndefined()
    expect(where).toMatchObject({ organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
  })

  it('builds a bounded $or filter across integrationId, entityType, and status', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ search: 'excel', page: 1, pageSize: 20 }, SCOPE)

    const where = lastWhere()
    expect(where.$or).toEqual([
      { integrationId: { $ilike: '%excel%' } },
      { entityType: { $ilike: '%excel%' } },
      { status: { $ilike: '%excel%' } },
    ])
  })

  it('escapes LIKE wildcards in the search term', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ search: '50%_off', page: 1, pageSize: 20 }, SCOPE)

    const where = lastWhere()
    expect(where.$or).toEqual([
      { integrationId: { $ilike: '%50\\%\\_off%' } },
      { entityType: { $ilike: '%50\\%\\_off%' } },
      { status: { $ilike: '%50\\%\\_off%' } },
    ])
  })

  it('matches run id exactly when the search term is a UUID', async () => {
    const runId = '11111111-1111-4111-8111-111111111111'
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ search: runId, page: 1, pageSize: 20 }, SCOPE)

    const where = lastWhere()
    expect(where.$or).toContainEqual({ id: runId })
  })

  it('does not add an id condition for non-UUID search terms', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ search: 'products', page: 1, pageSize: 20 }, SCOPE)

    const where = lastWhere()
    const conditions = where.$or as Array<Record<string, unknown>>
    expect(conditions.some((condition) => 'id' in condition)).toBe(false)
  })

  it('preserves explicit filters alongside the search filter', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns(
      { search: 'import', direction: 'import', status: 'failed', page: 1, pageSize: 20 },
      SCOPE,
    )

    const where = lastWhere()
    expect(where).toMatchObject({ direction: 'import', status: 'failed' })
    expect(Array.isArray(where.$or)).toBe(true)
  })

  it('passes the search query to the SyncRun entity lookup', async () => {
    const service = createSyncRunService(buildFakeEm() as any)
    await service.listRuns({ search: 'excel', page: 1, pageSize: 20 }, SCOPE)

    const [, entity] = (findAndCountWithDecryption as jest.Mock).mock.calls[0]
    expect(entity).toBe(SyncRun)
  })
})
