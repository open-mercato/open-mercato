import { expect, test } from '@playwright/test'
import { withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  chromeWindows, createActivityFixture, expectActivityCount, expectLoginToken, getActivity, signIn,
} from './helpers/signInActivityFixtures'
import { enrollTotp, verifyTotpChallenge } from './helpers/securityFixtures'

for (const firstBrowser of ['Firefox', 'Chrome'] as const) {
  test(`TC-SEC-021: verifies only the exact sign-in when ${firstBrowser} completes MFA first`, async ({ request }) => {
    test.skip(parseBooleanWithDefault(process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS, false), 'Requires MFA challenge enforcement.')
    const fixture = await createActivityFixture(request)
    try {
      const actor = await fixture.createActor()
      const token = expectLoginToken(await signIn(actor))
      const { secret } = await enrollTotp(request, token)
      const [firefox, chrome] = await Promise.all([
        signIn(actor, { ip: '203.0.113.8' }),
        signIn(actor, { ip: '203.0.113.9', userAgent: chromeWindows }),
      ])
      expect(firefox.mfa_required).toBe(true)
      expect(chrome.mfa_required).toBe(true)
      expect(firefox.challenge_id).toEqual(expect.any(String))
      expect(chrome.challenge_id).toEqual(expect.any(String))
      expect(firefox.challenge_id).not.toBe(chrome.challenge_id)

      const query = { userId: actor.userId, result: 'success' }
      const before = await expectActivityCount(request, fixture.adminToken, query, 3)
      const firefoxRow = before.find((row) => row.ipAddress === '203.0.113.8')
      const chromeRow = before.find((row) => row.ipAddress === '203.0.113.9')
      expect(firefoxRow?.mfaStatus).toBe('pending')
      expect(chromeRow?.mfaStatus).toBe('pending')

      const enrollments = [{ login: firefox, row: firefoxRow }, { login: chrome, row: chromeRow }]
      if (firstBrowser === 'Chrome') enrollments.reverse()
      const [first, second] = enrollments
      const verify = (login: typeof firefox) => withCredentialIsolatedRequest((isolated) =>
        verifyTotpChallenge(isolated, expectLoginToken(login), login.challenge_id ?? '', secret),
      )
      expect((await verify(first.login)).status).toBe(200)
      await drainIntegrationQueue('events')
      const afterFirst = await getActivity(request, fixture.adminToken, query)
      expect(afterFirst.items.find((row) => row.id === first.row?.id)?.mfaStatus).toBe('verified')
      expect(afterFirst.items.find((row) => row.id === second.row?.id)?.mfaStatus).toBe('pending')

      expect((await verify(second.login)).status).toBe(200)
      const afterSecond = await expectActivityCount(request, fixture.adminToken, query, 3)
      expect(afterSecond.find((row) => row.id === second.row?.id)?.mfaStatus).toBe('verified')
    } finally {
      await fixture.dispose()
    }
  })
}
