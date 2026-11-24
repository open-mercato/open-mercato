import { recordSignInEvent } from '../record-sign-in-event'
import type { SubscriberContext } from '@open-mercato/events/types'

const tenantId = 'a9b3a037-1b31-4b03-ae71-20ee22354ad0'
const userId = '6ea5719f-d06d-45d9-ba83-396d3f90931f'
const attemptId = '360ea2c4-7c05-4d3e-991b-d21b84cb1390'
const recordSignInAttempt = jest.fn()
const resolve = jest.fn(() => ({ recordSignInAttempt }))
const payload = { id: userId, email: 'Person@example.test', tenantId, attemptId, occurredAt: '2026-11-24T11:00:00.000Z' }

function context(scope: string | null) {
  return { tenantId: scope, resolve } as unknown as SubscriberContext
}

beforeEach(() => jest.clearAllMocks())

test('uses trusted scope and preserves the retry identity', async () => {
  await recordSignInEvent('success', payload, context(tenantId))
  expect(recordSignInAttempt).toHaveBeenCalledWith({
    tenantId, organizationId: null, userId, attemptId, email: 'person@example.test',
    occurredAt: new Date(payload.occurredAt), ip: null, userAgent: null, result: 'success', reason: null,
  })
})

test('ignores unresolved failures', async () => {
  await recordSignInEvent('failure', { email: payload.email, attemptId, reason: 'invalid_credentials' }, context(null))
  expect(resolve).not.toHaveBeenCalled()
})

test('rejects a mismatch between trusted and payload scope', async () => {
  await recordSignInEvent('success', payload, context(userId))
  expect(resolve).not.toHaveBeenCalled()
})
