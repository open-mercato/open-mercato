/** @jest-environment node */

import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const THREAD_ID = '66666666-6666-4666-8666-666666666666'

const mockCommandBusExecute = jest.fn(async () => ({
  result: {
    proposalId: 'proposal-1',
    proposalCartId: 'proposal-cart-1',
    messageId: 'message-1',
    expiresAt: '2026-01-02T00:00:00.000Z',
    rejectedLines: [],
    replayed: false,
  },
}))

let guards: MutationGuard[] = []
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: mockCommandBusExecute }
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
  readJsonSafe: jest.fn(async () => ({
    lines: [{ productId: '88888888-8888-4888-8888-888888888888', quantity: '1' }],
    idempotencyKey: 'idempotency-key-1',
  })),
}))

import { POST } from '../route'

const THREAD_RESOURCE_KIND = 'assisted_selling.thread'

function callPost() {
  return POST(new Request(`http://localhost/api/assisted_selling/threads/${THREAD_ID}/proposals`, { method: 'POST' }), {
    params: { id: THREAD_ID },
  })
}

// M12 (review finding, the cited example): `POST /threads/:id/proposals` dispatched
// `assisted_selling.proposal.author` without going through the shared route mutation-guard
// registry at all.
describe('POST /threads/:id/proposals — mutation guard registry (review finding M12)', () => {
  beforeEach(() => {
    mockCommandBusExecute.mockClear()
    guards = []
  })

  it('refuses with the guard\'s own status/body and never dispatches the author command when a guard denies', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.deny-proposal-author',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['create'],
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
      id: 'test.transform-proposal-author',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['create'],
      async validate() {
        return { ok: true, modifiedPayload: { note: 'transformed note' }, shouldRunAfterSuccess: true }
      },
      afterSuccess,
    }
    guards = [transformingGuard]

    const response = await callPost()

    expect(response.status).toBe(201)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { note?: unknown } }).input.note).toBe('transformed note')
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('passes the caller\'s own userId (not "anonymous") to the guard registry', async () => {
    const seenUserIds: string[] = []
    const recordingGuard: MutationGuard = {
      id: 'test.record-user-id',
      targetEntity: THREAD_RESOURCE_KIND,
      operations: ['create'],
      async validate(input) {
        seenUserIds.push(input.userId)
        return { ok: true }
      },
    }
    guards = [recordingGuard]

    await callPost()

    expect(seenUserIds).toEqual([mockAuth.sub])
  })
})
