import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createActivityFixture, expectActivityCount, expectLoginToken, getActivity, getOwnActivity, signIn,
} from './helpers/signInActivityFixtures'

test('TC-SEC-017: exposes self history and enforces admin feature and tenant scope', async ({ request }) => {
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const foreignAdmin = await fixture.createActor({ foreign: true, isAdmin: true })
    const actorToken = expectLoginToken(await signIn(actor))
    const foreignToken = expectLoginToken(await signIn(foreignAdmin))
    const filter = { userId: actor.userId, result: 'success' }
    const [activity] = await expectActivityCount(request, fixture.adminToken, filter, 1)

    const own = (await getOwnActivity(request, actorToken)).items
    expect(own).toContainEqual(expect.objectContaining({ id: activity.id }))
    expect(own[0]).not.toHaveProperty('email')
    expect(own[0]).not.toHaveProperty('userId')
    expect(own[0]).not.toHaveProperty('userName')

    const detailRoute = `/api/security/sign-ins/${activity.id}`
    const adminDetail = await apiRequest(request, 'GET', detailRoute, { token: fixture.adminToken })
    expect(adminDetail.status()).toBe(200)
    expect(await adminDetail.json()).toMatchObject({ id: activity.id, email: actor.email, userId: actor.userId })
    expect((await apiRequest(request, 'GET', '/api/security/sign-ins', { token: actorToken })).status()).toBe(403)
    expect((await getActivity(request, foreignToken, filter)).items).toEqual([])
    expect((await apiRequest(request, 'GET', detailRoute, { token: foreignToken })).status()).toBe(404)
  } finally {
    await fixture.dispose()
  }
})
