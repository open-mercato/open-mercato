import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createActivityFixture, expectActivityCount, signIn } from './helpers/signInActivityFixtures'

test('TC-SEC-020: records role denials with the existing 403 response', async ({ request }) => {
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const denied = await signIn(actor, { requireRole: `qa-missing-${randomUUID()}`, status: 403 })
    expect(denied).toMatchObject({ ok: false })
    expect(denied).not.toHaveProperty('token')
    const [failure] = await expectActivityCount(request, fixture.adminToken, { userId: actor.userId, result: 'failure' }, 1)
    expect(failure).toMatchObject({ reason: 'role_denied', email: actor.email, userId: actor.userId })
  } finally {
    await fixture.dispose()
  }
})
