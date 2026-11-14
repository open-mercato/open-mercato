/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isProjectAssignedToMember,
  loadTimesheetPreference,
  saveTimesheetPreference,
} from '../timesheetPreferenceService'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const MEMBER_ID = 'member-1'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

function buildEm(execute: jest.Mock, transactionContext: unknown = undefined) {
  return {
    getConnection: () => ({ execute }),
    getTransactionContext: () => transactionContext,
  } as unknown as EntityManager
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase()
}

describe('timesheetPreferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('saveTimesheetPreference', () => {
    it('writes through a single atomic upsert rather than a read-then-branch', async () => {
      const execute = jest.fn().mockResolvedValue([
        { last_project_id: PROJECT_ID, updated_at: new Date('2026-08-09T10:00:00.000Z') },
      ])

      const result = await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)

      expect(execute).toHaveBeenCalledTimes(1)
      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
      expect(result).toEqual({ lastProjectId: PROJECT_ID, updatedAt: '2026-08-09T10:00:00.000Z' })
    })

    it('restates the partial-index predicate on the conflict target', async () => {
      const execute = jest.fn().mockResolvedValue([{ last_project_id: null, updated_at: new Date() }])

      await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, null)

      const sql = normalizeSql(String(execute.mock.calls[0][0]))
      // Postgres only infers a PARTIAL unique index when the statement repeats the
      // index predicate. Without `WHERE deleted_at IS NULL` here the upsert raises
      // "no unique or exclusion constraint matching the ON CONFLICT specification"
      // at runtime — the exact trap the spec calls out.
      expect(sql).toContain('ON CONFLICT (ORGANIZATION_ID, TENANT_ID, STAFF_MEMBER_ID) WHERE DELETED_AT IS NULL')
      expect(sql).toContain('DO UPDATE SET')
      expect(sql).toContain('RETURNING LAST_PROJECT_ID, UPDATED_AT')
    })

    it('parameterizes every caller-supplied value', async () => {
      const execute = jest.fn().mockResolvedValue([{ last_project_id: PROJECT_ID, updated_at: new Date() }])

      await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)

      const [sql, params] = execute.mock.calls[0]
      expect(params).toEqual(['tenant-1', 'org-1', MEMBER_ID, PROJECT_ID])
      expect(String(sql)).not.toContain(MEMBER_ID)
      expect(String(sql)).not.toContain(PROJECT_ID)
    })

    it('retries once when a concurrent write raises a unique violation', async () => {
      const execute = jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
        .mockResolvedValueOnce([{ last_project_id: PROJECT_ID, updated_at: new Date() }])

      const result = await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)

      expect(execute).toHaveBeenCalledTimes(2)
      expect(result.lastProjectId).toBe(PROJECT_ID)
    })

    it('does not retry a failure that is not a unique violation', async () => {
      const execute = jest.fn().mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }))

      await expect(saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)).rejects.toThrow(
        'connection lost',
      )
      expect(execute).toHaveBeenCalledTimes(1)
    })

    it('propagates a unique violation that survives the single retry', async () => {
      const execute = jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }))

      await expect(saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)).rejects.toThrow(
        'duplicate key',
      )
      expect(execute).toHaveBeenCalledTimes(2)
    })

    it('normalizes a driver-returned timestamp string to an ISO string', async () => {
      const execute = jest.fn().mockResolvedValue([
        { last_project_id: PROJECT_ID, updated_at: '2026-08-09T10:00:00.000Z' },
      ])

      const result = await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)

      expect(result.updatedAt).toBe('2026-08-09T10:00:00.000Z')
    })

    it('joins the ambient transaction when there is one', async () => {
      // Nothing wraps the route in a transaction today, so this is future-
      // proofing: without the context the raw upsert would silently run on a
      // separate connection and escape any transaction added later.
      const execute = jest.fn().mockResolvedValue([{ last_project_id: null, updated_at: new Date() }])
      const transaction = { id: 'tx-1' }

      await saveTimesheetPreference(buildEm(execute, transaction), SCOPE, MEMBER_ID, null)

      expect(execute.mock.calls[0][3]).toBe(transaction)
    })

    it('scopes the insert by tenant and organization', async () => {
      const execute = jest.fn().mockResolvedValue([{ last_project_id: null, updated_at: new Date() }])

      await saveTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID, null)

      const params = execute.mock.calls[0][1] as string[]
      expect(params[0]).toBe('tenant-1')
      expect(params[1]).toBe('org-1')
    })
  })

  describe('loadTimesheetPreference', () => {
    const execute = jest.fn()

    it('returns an empty preference when no row exists', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const result = await loadTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID)

      expect(result).toEqual({ lastProjectId: null, updatedAt: null })
    })

    it('drops a stored project the member is no longer actively assigned to', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ lastProjectId: PROJECT_ID, updatedAt: new Date('2026-08-09T10:00:00.000Z') })
        .mockResolvedValueOnce(null)

      const result = await loadTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID)

      expect(result).toEqual({ lastProjectId: null, updatedAt: '2026-08-09T10:00:00.000Z' })
    })

    it('serves a stored project that is still an active assignment', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ lastProjectId: PROJECT_ID, updatedAt: new Date('2026-08-09T10:00:00.000Z') })
        .mockResolvedValueOnce({ id: 'assignment-1' })

      const result = await loadTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID)

      expect(result).toEqual({ lastProjectId: PROJECT_ID, updatedAt: '2026-08-09T10:00:00.000Z' })
    })

    it('skips the assignment lookup when the stored project is null', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce({ lastProjectId: null, updatedAt: null })

      const result = await loadTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID)

      expect(result).toEqual({ lastProjectId: null, updatedAt: null })
      expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    })

    it('scopes the row lookup by tenant, organization and member', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      await loadTimesheetPreference(buildEm(execute), SCOPE, MEMBER_ID)

      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          staffMemberId: MEMBER_ID,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          deletedAt: null,
        },
        {},
        SCOPE,
      )
    })
  })

  describe('isProjectAssignedToMember', () => {
    const execute = jest.fn()

    it('requires an active, non-deleted assignment inside the caller scope', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'assignment-1' })

      const assigned = await isProjectAssignedToMember(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)

      expect(assigned).toBe(true)
      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          timeProjectId: PROJECT_ID,
          staffMemberId: MEMBER_ID,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          status: 'active',
          deletedAt: null,
        },
        {},
        SCOPE,
      )
    })

    it('reports false when no assignment matches', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      await expect(isProjectAssignedToMember(buildEm(execute), SCOPE, MEMBER_ID, PROJECT_ID)).resolves.toBe(false)
    })
  })
})
