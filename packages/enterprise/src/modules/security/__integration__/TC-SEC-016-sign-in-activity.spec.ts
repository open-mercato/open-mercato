import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  createActivityFixture, expectActivityCount, expectLoginToken, fixtureIp, getActivity, getOwnActivity, signIn,
} from './helpers/signInActivityFixtures'
import { setAuthCookie } from './helpers/securityFixtures'

test('TC-SEC-016: records resolved password failures and MFA status', async ({ request }) => {
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor()
    const query = { userId: actor.userId, result: 'failure' }
    expect(await signIn({ ...actor, password: `Wrong1!${randomUUID()}` }, { status: 401 })).toMatchObject({ ok: false })
    const [failure] = await expectActivityCount(request, fixture.adminToken, query, 1)
    expect(failure).toMatchObject({
      reason: 'invalid_password', browserName: 'Firefox', osName: 'Linux', ipAddress: fixtureIp,
    })
    expect((await getActivity(request, fixture.adminToken, { ...query, ip: fixtureIp })).total).toBe(1)
    expect((await getActivity(request, fixture.adminToken, { ...query, ip: '198.51.100.1' })).total).toBe(0)

    const unknown = { email: `unknown-${randomUUID()}@example.test`, password: actor.password }
    expect(await signIn(unknown, { status: 401 })).toMatchObject({ ok: false })
    await expectActivityCount(request, fixture.adminToken, { email: unknown.email }, 0)

    const login = await signIn(actor)
    const token = expectLoginToken(login)
    expect(login.mfa_required).toBeFalsy()
    const bypass = parseBooleanWithDefault(process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS, false)
    const [success] = await expectActivityCount(request, fixture.adminToken, { userId: actor.userId, result: 'success' }, 1)
    const mfaStatus = bypass ? 'bypassed' : 'not_required'
    expect(success.mfaStatus).toBe(mfaStatus)
    expect((await getOwnActivity(request, token)).items).toContainEqual(expect.objectContaining({ id: success.id, mfaStatus }))
  } finally {
    await fixture.dispose()
  }
})

test('TC-SEC-016: records enrollment for an enforced user without a compliant method', async ({ request, page }) => {
  test.skip(parseBooleanWithDefault(process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS, false), 'Emergency bypass intentionally overrides enrollment.')
  const fixture = await createActivityFixture(request)
  try {
    const actor = await fixture.createActor({ enforce: true })
    const login = await signIn(actor)
    const token = expectLoginToken(login)
    expect(login.mfa_required).toBeFalsy()
    const [success] = await expectActivityCount(request, fixture.adminToken, { userId: actor.userId, result: 'success' }, 1)
    expect(success.mfaStatus).toBe('enrollment_required')
    await setAuthCookie(page, token)
    await page.goto('/backend')
    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa(?:\?|$)/)
    await expect(page.getByRole('heading', { name: 'MFA enrollment required' })).toBeVisible()
  } finally {
    await fixture.dispose()
  }
})
