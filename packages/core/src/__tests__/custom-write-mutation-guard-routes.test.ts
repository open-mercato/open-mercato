/** @jest-environment node */

import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { POST as sendQuote } from '../modules/sales/api/quotes/send/route'
import { POST as convertQuote } from '../modules/sales/api/quotes/convert/route'
import { POST as purgeCache } from '../modules/configs/api/cache/route'
import { POST as sendCustomPush } from '../modules/push_notifications/api/custom-send/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const recordId = '44444444-4444-4444-8444-444444444444'
const requiredFeature = 'record_locks.enforce'
const blockedBody = { error: 'Locked by route guard', code: 'record_locked' }

const mockGetGrantedFeatures = jest.fn()
const mockCommandExecute = jest.fn()
const mockEntityManagerFork = jest.fn()
const mockCacheClear = jest.fn()
const mockSendCustomPush = jest.fn()

const mockContainer = {
  hasRegistration: (name: string) => name === 'rbacService',
  resolve: (name: string) => {
    if (name === 'rbacService') return { getGrantedFeatures: mockGetGrantedFeatures }
    if (name === 'commandBus') return { execute: mockCommandExecute }
    if (name === 'em') return { fork: mockEntityManagerFork }
    if (name === 'cache') return { clear: mockCacheClear }
    if (name === 'pushNotificationService') return { sendCustomPush: mockSendCustomPush }
    return undefined
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
  detectLocale: jest.fn(async () => 'en'),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
    allowedIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn(),
}))

function createBlockingGuard(): MutationGuard {
  return {
    id: 'test.route-lock',
    targetEntity: '*',
    operations: ['create', 'update', 'delete'],
    features: [requiredFeature],
    validate: jest.fn().mockResolvedValue({ ok: false, status: 423, body: blockedBody }),
  }
}

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('standalone custom write route mutation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetGrantedFeatures.mockResolvedValue([requiredFeature])
    registerMutationGuards([{ moduleId: 'test', guards: [createBlockingGuard()] }])
  })

  afterEach(() => {
    registerMutationGuards([])
  })

  it.each([
    {
      name: 'quote send',
      run: () => sendQuote(post('http://localhost/api/sales/quotes/send', { quoteId: recordId, validForDays: 14 })),
      mutation: mockEntityManagerFork,
    },
    {
      name: 'quote convert',
      run: () => convertQuote(post('http://localhost/api/sales/quotes/convert', { quoteId: recordId })),
      mutation: mockCommandExecute,
    },
    {
      name: 'cache purge',
      run: () => purgeCache(post('http://localhost/api/configs/cache', { action: 'purgeAll' })),
      mutation: mockCacheClear,
    },
    {
      name: 'custom push send',
      run: () => sendCustomPush(post('http://localhost/api/push_notifications/custom-send', {
        recipientUserId: recordId,
        title: 'Guarded notification',
      })),
      mutation: mockSendCustomPush,
    },
  ])('returns the registered guard rejection before $name mutates', async ({ run, mutation }) => {
    const response = await run()

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual(blockedBody)
    expect(mockGetGrantedFeatures).toHaveBeenCalledWith(userId, { tenantId, organizationId })
    expect(mutation).not.toHaveBeenCalled()
  })
})
