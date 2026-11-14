/** @jest-environment node */

import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const THREAD_ID = '66666666-6666-4666-8666-666666666666'

const mockCommandBusExecute = jest.fn(async () => ({
  result: { threadId: THREAD_ID, assignedActorId: 'rep-1', updatedAt: '2026-01-01T00:00:00.000Z' },
}))

let guards: MutationGuard[] = []
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))

let grantedFeatures: string[] = []
const getGrantedFeatures = jest.fn(async () => grantedFeatures)

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: mockCommandBusExecute }
    if (name === 'rbacService') return { getGrantedFeatures }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

const mockAuth = { sub: 'rep-1', tenantId: TENANT_ID, orgId: ORG_ID }
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => mockAuth),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn(async () => ({})),
}))

import { POST } from '../route'

const THREAD_RESOURCE_KIND = 'assisted_selling.thread'

function callPost() {
  return POST(new Request(`http://localhost/api/assisted_selling/threads/${THREAD_ID}/assign`, { method: 'POST' }), {
    params: { id: THREAD_ID },
  })
}

// M12 fix (review finding): `POST /threads/:id/assign` dispatched `assisted_selling.thread.assign`
// without going through the shared route mutation-guard registry.
describe('POST /threads/:id/assign — mutation guard registry (review finding M12)', () => {
  beforeEach(() => {
    mockCommandBusExecute.mockClear()
    getGrantedFeatures.mockClear()
    guards = []
    grantedFeatures = []
  })

  it('refuses with the guard\'s own status/body and never dispatches the assign command when a guard denies', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.deny-thread-assign',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'blocked by test guard', code: 'test_guard_blocked' } }
      },
    }
    guards = [denyingGuard]

    const response = await callPost()

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked by test guard', code: 'test_guard_blocked' })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('merges a transforming guard\'s modifiedPayload into the dispatched command input and still runs afterSuccess', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const transformingGuard: MutationGuard = {
      id: 'test.transform-thread-assign',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      async validate() {
        return { ok: true, modifiedPayload: { actorId: '77777777-7777-4777-8777-777777777777' }, shouldRunAfterSuccess: true }
      },
      afterSuccess,
    }
    guards = [transformingGuard]

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { actorId?: unknown } }).input.actorId).toBe('77777777-7777-4777-8777-777777777777')
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('passes the caller\'s own userId (not "anonymous") to the guard registry', async () => {
    const seenUserIds: string[] = []
    const recordingGuard: MutationGuard = {
      id: 'test.record-user-id',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      async validate(input) {
        seenUserIds.push(input.userId)
        return { ok: true }
      },
    }
    guards = [recordingGuard]

    await callPost()

    expect(seenUserIds).toEqual([mockAuth.sub])
  })

  // #8268 review Major 6: `userFeatures` used to be hard-coded to `[]`, which the
  // registry treats as authoritative — a feature-gated guard never ran regardless of
  // the caller's real grants. Now the wrapper resolves grants via
  // `rbacService.getGrantedFeatures` (mocked above), so a feature-gated guard runs
  // only when the caller actually holds the feature — concretely or via wildcard.
  it('skips a feature-gated guard when the caller lacks the required feature', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.feature-gated-deny',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      features: ['assisted_selling.threads.block_assign'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'should not run' } }
      },
    }
    guards = [denyingGuard]
    grantedFeatures = []

    const response = await callPost()

    expect(getGrantedFeatures).toHaveBeenCalledWith(mockAuth.sub, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(response.status).toBe(200)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
  })

  it('runs a feature-gated guard when the caller holds the concrete feature', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.feature-gated-deny-concrete',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      features: ['assisted_selling.threads.block_assign'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'blocked by concrete grant' } }
      },
    }
    guards = [denyingGuard]
    grantedFeatures = ['assisted_selling.threads.block_assign']

    const response = await callPost()

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked by concrete grant' })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('runs a feature-gated guard when the caller holds a wildcard grant', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.feature-gated-deny-wildcard',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['update'],
      features: ['assisted_selling.threads.block_assign'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'blocked by wildcard grant' } }
      },
    }
    guards = [denyingGuard]
    grantedFeatures = ['assisted_selling.*']

    const response = await callPost()

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked by wildcard grant' })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })
})
