/** @jest-environment node */
/**
 * The enqueue side of retro-rounding: gated, guarded, and honest about an empty
 * tenant rather than queueing a job that would complete instantly.
 */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const progressJobId = '44444444-4444-4444-8444-444444444444'

let candidateCount = 5
const enqueue = jest.fn(async () => 'queued-1')
const createJob = jest.fn(async () => ({ id: progressJobId }))

jest.mock('../../../../../lib/time-tracking/reapplyRounding', () => {
  const actual = jest.requireActual('../../../../../lib/time-tracking/reapplyRounding')
  return {
    ...actual,
    getStaffQueue: jest.fn(() => ({ enqueue })),
    countReapplyRoundingCandidates: jest.fn(async () => candidateCount),
  }
})

let grantedFeatures: string[] = ['staff.timesheets.settings.manage']

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { fork: () => ({}) }
    if (name === 'progressService') return { createJob }
    if (name === 'rbacService') return {
      getGrantedFeatures: async () => grantedFeatures,
      // Same grants, asked the way the code now asks — a test that grants a
      // feature must still grant it once the check goes through the service.
      userHasAllFeatures: async (_u: string, required: string[]) =>
        required.every((feature: string) =>
          (grantedFeatures ?? []).some((grant: string) =>
            grant === '*' || grant === feature || (grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1))),
          ),
        ),
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }
let organizationScope: Record<string, unknown> | null = {
  tenantId,
  selectedId: organizationId,
  filterIds: [organizationId],
  allowedIds: [organizationId],
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => organizationScope),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import { POST, metadata } from '../route'

const request = () =>
  new Request('http://localhost/api/staff/timesheets/settings/reapply-rounding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

describe('reapply rounding route', () => {
  beforeEach(() => {
    candidateCount = 5
    enqueue.mockClear()
    createJob.mockClear()
    container.resolve.mockClear()
    registerMutationGuards([])
    grantedFeatures = ['staff.timesheets.settings.manage']
    authValue = { tenantId, sub: userId, orgId: organizationId }
    organizationScope = {
      tenantId,
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
    }
  })

  afterAll(() => {
    registerMutationGuards([])
  })

  it('is gated on the settings manage feature', () => {
    expect(metadata.POST.requireFeatures).toEqual(['staff.timesheets.settings.manage'])
  })

  it('rejects an unauthenticated caller', async () => {
    authValue = null
    expect((await POST(request())).status).toBe(401)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses a caller without the manage feature', async () => {
    grantedFeatures = ['staff.timesheets.view']
    expect((await POST(request())).status).toBe(403)
    expect(createJob).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('creates a progress job and queues it, answering 202', async () => {
    const response = await POST(request())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, progressJobId, candidateCount: 5 })

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'staff.timesheets.reapply_rounding', totalCount: 5, cancellable: true }),
      { tenantId, organizationId, userId },
    )
    expect(enqueue).toHaveBeenCalledWith({
      progressJobId,
      scope: { tenantId, organizationIds: [organizationId], userId },
    })
  })

  it('does nothing at all when there is nothing to restate', async () => {
    candidateCount = 0
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, progressJobId: null, candidateCount: 0 })
    expect(createJob).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('lets a mutation guard block the job before anything is queued', async () => {
    const guard: MutationGuard = {
      id: 'test.block-retro-rounding',
      targetEntity: 'staff.timesheets.settings',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: false, status: 422, body: { error: 'blocked by policy' } }),
    } as unknown as MutationGuard
    registerMutationGuards([{ moduleId: 'staff', guards: [guard] }])

    const response = await POST(request())

    expect(response.status).toBe(422)
    expect(createJob).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('passes the caller organization scope through to the job', async () => {
    organizationScope = { tenantId, selectedId: null, filterIds: null, allowedIds: null }
    authValue = { tenantId, sub: userId, orgId: null }

    await POST(request())

    expect(enqueue).toHaveBeenCalledWith({
      progressJobId,
      scope: { tenantId, organizationIds: null, userId },
    })
  })

  it('reports a queueing failure as a 500', async () => {
    enqueue.mockRejectedValueOnce(new Error('[internal] redis down'))

    const response = await POST(request())
    expect(response.status).toBe(500)
  })
})
