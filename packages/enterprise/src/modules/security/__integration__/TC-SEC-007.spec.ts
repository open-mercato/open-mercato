import { expect, test } from '@playwright/test'
import { enrollTotp, fetchJson } from './helpers/securityFixtures'
import { createIsolatedMfaSudoFixture, verifyTotpSudoChallenge } from './helpers/sudoFixtures'

type MfaStatus = {
  enrolled: boolean
  methods: Array<{ id: string; type: string }>
  recoveryCodesRemaining: number
}

test.describe('TC-SEC-007: Admin MFA reset and status reporting', () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedMfaSudoFixture>> | undefined

  test.beforeAll(async ({ request }) => {
    fixture = await createIsolatedMfaSudoFixture(request)
    await enrollTotp(request, fixture.target.token)
    await enrollTotp(request, fixture.control.token)
  })

  test.afterAll(async ({ request }) => {
    await fixture?.cleanup(request)
  })

  test('resets only the selected user after MFA step-up and rejects invalid requests', async ({ request }) => {
    if (!fixture) throw new Error('[internal] Sudo fixture was not initialized')
    const { token, secret, target, control } = fixture
    const status = (userId: string) => fetchJson<MfaStatus>(
      request, 'GET', `/api/security/users/${userId}/mfa/status`, { token },
    )
    const before = await status(target.id)
    expect(before.status).toBe(200)
    expect(before.body.enrolled).toBe(true)
    expect(before.body.methods.map((method) => method.type)).toEqual(['totp'])
    const controlBefore = await status(control.id)
    expect(controlBefore.status).toBe(200)
    expect(controlBefore.body.enrolled).toBe(true)

    const compliance = await fetchJson<{ items: Array<{ userId: string; enrolled: boolean }> }>(
      request, 'GET', '/api/security/users/mfa/compliance', { token },
    )
    expect(compliance.status).toBe(200)
    expect(compliance.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: target.id, enrolled: true }),
      expect.objectContaining({ userId: control.id, enrolled: true }),
    ]))
    const invalidStatus = await status('not-a-uuid')
    expect(invalidStatus.status).toBe(400)
    const resetPath = `/api/security/users/${target.id}/mfa/reset`
    const missingSudo = await fetchJson<{ error?: string }>(request, 'POST', resetPath, {
      token, data: { reason: 'TC-SEC-007 missing sudo' },
    })
    expect(missingSudo.status).toBe(403)
    expect(missingSudo.body.error).toBe('sudo_required')

    const sudo = await verifyTotpSudoChallenge(request, {
      token, secret, targetIdentifier: 'security.admin.mfa.reset',
    })
    const invalidSudo = await fetchJson<{ error?: string }>(request, 'POST', resetPath, {
      token,
      headers: { 'x-sudo-token': `${sudo.sudoToken}-invalid` },
      data: { reason: 'TC-SEC-007 invalid sudo' },
    })
    expect(invalidSudo.status).toBe(403)
    expect(invalidSudo.body.error).toBe('sudo_required')
    const emptyReason = await fetchJson(request, 'POST', resetPath, {
      token, headers: { 'x-sudo-token': sudo.sudoToken as string }, data: { reason: '' },
    })
    expect(emptyReason.status).toBe(400)
    const unchanged = await status(target.id)
    expect(unchanged.status).toBe(200)
    expect(unchanged.body).toEqual(before.body)

    const reset = await fetchJson<{ ok?: boolean }>(request, 'POST', resetPath, {
      token,
      headers: { 'x-sudo-token': sudo.sudoToken as string },
      data: { reason: 'TC-SEC-007 confirmed reset' },
    })
    expect(reset.status).toBe(200)
    expect(reset.body.ok).toBe(true)
    const after = await status(target.id)
    expect(after.status).toBe(200)
    expect(after.body.enrolled).toBe(false)
    expect(after.body.methods).toEqual([])
    expect(after.body.recoveryCodesRemaining).toBe(0)
    const controlAfter = await status(control.id)
    expect(controlAfter.status).toBe(200)
    expect(controlAfter.body).toEqual(controlBefore.body)
  })
})
