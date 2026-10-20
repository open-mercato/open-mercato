/** @jest-environment node */
// The two custom write routes (PATCH /settings, POST /reconcile) run the
// shared mutation-guard registry before calling their command (see
// packages/core/AGENTS.md → API Routes). The registry guards here are real
// `MutationGuard`s run by the real `runMutationGuards`; only the guard store,
// auth and the command bus are stubbed.
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '33333333-3333-4333-8333-333333333333'
const OTHER_ACCOUNT = '55555555-5555-4555-8555-555555555555'
const PERIOD = '44444444-4444-4444-8444-444444444444'

const mockGuards: MutationGuard[] = []
const mockExecute = jest.fn()
const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'rbacService') return { getGrantedFeatures: jest.fn(async () => ['posting_rules.*']) }
    if (token === 'em') return {}
    throw new Error(`[internal] not registered: ${token}`)
  }),
}

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => mockGuards),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT, orgId: ORG })),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ tenantId: TENANT, selectedId: ORG, filterIds: [ORG] })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key })),
}))

import { PATCH as patchSettings } from '../settings/route'
import { POST as postReconcile } from '../reconcile/route'

function blockingGuard(resourceKind: string): MutationGuard {
  return {
    id: 'test.block',
    targetEntity: resourceKind,
    operations: ['update'],
    validate: jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked by test guard' } })),
  }
}

function passingGuard(resourceKind: string, modifiedPayload?: Record<string, unknown>) {
  const afterSuccess = jest.fn(async () => undefined)
  const guard: MutationGuard = {
    id: 'test.pass',
    targetEntity: resourceKind,
    operations: ['update'],
    validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, ...(modifiedPayload ? { modifiedPayload } : {}) })),
    afterSuccess,
  }
  return { guard, afterSuccess }
}

const jsonRequest = (url: string, method: string, body: unknown) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const settingsRequest = (body: unknown) => jsonRequest('http://localhost/api/posting_rules/settings', 'PATCH', body)
const reconcileRequest = (body: unknown) => jsonRequest('http://localhost/api/posting_rules/reconcile', 'POST', body)

describe('posting_rules custom write routes — mutation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGuards.length = 0
    mockExecute.mockImplementation(async (commandId: string, options: { input: Record<string, unknown> }) => {
      if (commandId === 'posting_rules.updatePostingRulesSettings') {
        return {
          result: {
            settingsId: 'settings-1',
            clearingAccountId: options.input.clearingAccountId ?? null,
            unallocatedCostAccountId: null,
            updatedAt: '2026-10-20T10:00:00.000Z',
          },
          logEntry: null,
        }
      }
      return { result: { entriesInspected: 0, linesReclassified: 0, failures: [] }, logEntry: null }
    })
  })

  describe('PATCH /api/posting_rules/settings', () => {
    it('returns the blocking guard\'s status and body and does not run the command', async () => {
      const guard = blockingGuard('posting_rules.settings')
      mockGuards.push(guard)

      const response = await patchSettings(settingsRequest({ clearingAccountId: ACCOUNT }))

      expect(response.status).toBe(423)
      await expect(response.json()).resolves.toEqual({ error: 'Locked by test guard' })
      expect(mockExecute).not.toHaveBeenCalled()
      expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: TENANT,
        organizationId: ORG,
        userId: 'user-1',
        resourceKind: 'posting_rules.settings',
        resourceId: `${ORG}:${TENANT}`,
        operation: 'update',
        requestMethod: 'PATCH',
        mutationPayload: { clearingAccountId: ACCOUNT },
      }))
    })

    it('merges the guard\'s modified payload into the command input and runs afterSuccess after the write', async () => {
      const { guard, afterSuccess } = passingGuard('posting_rules.settings', { clearingAccountId: OTHER_ACCOUNT })
      mockGuards.push(guard)

      const response = await patchSettings(settingsRequest({ clearingAccountId: ACCOUNT }))

      expect(response.status).toBe(200)
      expect(mockExecute).toHaveBeenCalledWith('posting_rules.updatePostingRulesSettings', expect.objectContaining({
        input: { organizationId: ORG, tenantId: TENANT, clearingAccountId: OTHER_ACCOUNT },
      }))
      expect(afterSuccess).toHaveBeenCalledTimes(1)
      expect(afterSuccess.mock.invocationCallOrder[0]).toBeGreaterThan(mockExecute.mock.invocationCallOrder[0])
    })

    it('still answers 200 when an afterSuccess callback fails after the write committed', async () => {
      const { guard, afterSuccess } = passingGuard('posting_rules.settings')
      afterSuccess.mockRejectedValueOnce(new Error('[internal] callback failed'))
      mockGuards.push(guard)

      const response = await patchSettings(settingsRequest({ clearingAccountId: ACCOUNT }))

      expect(response.status).toBe(200)
      expect(afterSuccess).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /api/posting_rules/reconcile', () => {
    it('returns the blocking guard\'s status and body and does not run the sweep', async () => {
      const guard = blockingGuard('posting_rules.reconcile_run')
      mockGuards.push(guard)

      const response = await postReconcile(reconcileRequest({ periodId: PERIOD }))

      expect(response.status).toBe(423)
      await expect(response.json()).resolves.toEqual({ error: 'Locked by test guard' })
      expect(mockExecute).not.toHaveBeenCalled()
      expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({
        resourceKind: 'posting_rules.reconcile_run',
        resourceId: `${ORG}:${TENANT}`,
        operation: 'update',
        requestMethod: 'POST',
        mutationPayload: { periodId: PERIOD },
      }))
    })

    it('runs the sweep and then afterSuccess when the guard passes', async () => {
      const { guard, afterSuccess } = passingGuard('posting_rules.reconcile_run')
      mockGuards.push(guard)

      const response = await postReconcile(reconcileRequest({ periodId: PERIOD }))

      expect(response.status).toBe(200)
      expect(mockExecute).toHaveBeenCalledWith('posting_rules.reconcileCostRing', expect.objectContaining({
        input: { organizationId: ORG, tenantId: TENANT, periodId: PERIOD },
      }))
      expect(afterSuccess).toHaveBeenCalledTimes(1)
    })
  })
})
