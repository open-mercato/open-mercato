import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { fetchJson } from './helpers/securityFixtures'
import {
  createIsolatedMfaSudoFixture,
  createPasswordSudoConfig,
  deleteSudoFixtures,
  verifyTotpSudoChallenge,
} from './helpers/sudoFixtures'

test.describe('TC-SEC-006: Sudo challenge and admin override', () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedMfaSudoFixture>> | undefined

  test.beforeAll(async ({ request }) => {
    fixture = await createIsolatedMfaSudoFixture(request)
  })

  test.afterAll(async ({ request }) => {
    await fixture?.cleanup(request)
  })

  test('scopes sudo configuration reads to the actor tenant', async ({ request }) => {
    if (!fixture) throw new Error('[internal] Sudo fixture was not initialized')
    const { token, target, resetConfigId } = fixture
    const otherConfigId = await createPasswordSudoConfig({
      targetIdentifier: 'security.admin.mfa.reset',
      tenantId: randomUUID(),
      organizationId: null,
      configuredBy: target.id,
    })

    try {
      const list = await fetchJson<{ items: Array<{ id: string }> }>(
        request, 'GET', '/api/security/sudo/configs', { token },
      )
      expect(list.status).toBe(200)
      const visibleIds = list.body.items.map((config) => config.id)
      expect(visibleIds).toContain(resetConfigId)
      expect(visibleIds).not.toContain(otherConfigId)

      const detail = await fetchJson(
        request, 'GET', `/api/security/sudo/configs/${otherConfigId}`, { token },
      )
      expect(detail.status).toBe(404)
    } finally {
      await deleteSudoFixtures({ configIds: [otherConfigId] })
    }
  })

  test('verifies MFA before changing sudo protection and enforces it again after re-enabling', async ({ request }) => {
    if (!fixture) throw new Error('[internal] Sudo fixture was not initialized')
    const { token, secret, resetConfigId, target } = fixture
    const resetPath = `/api/security/users/${target.id}/mfa/reset`
    const configPath = `/api/security/sudo/configs/${resetConfigId}`
    const reset = () => fetchJson<{ ok?: boolean; error?: string }>(request, 'POST', resetPath, {
      token, data: { reason: 'TC-SEC-006 sudo protection check' },
    })
    const before = await reset()
    expect(before.status).toBe(403)
    expect(before.body.error).toBe('sudo_required')

    const manageSudo = await verifyTotpSudoChallenge(request, {
      token, secret, targetIdentifier: 'security.sudo.manage',
    })
    const configBefore = await fetchJson<{ isEnabled: boolean; updatedAt: string }>(request, 'GET', configPath, { token })
    expect(configBefore.status).toBe(200)
    expect(configBefore.body.isEnabled).toBe(true)
    const rejectedUpdate = await fetchJson<{ error?: string }>(request, 'PUT', configPath, {
      token,
      headers: {
        'x-sudo-token': `${manageSudo.sudoToken}-invalid`,
        [OPTIMISTIC_LOCK_HEADER_NAME]: configBefore.body.updatedAt,
      },
      data: { isEnabled: false },
    })
    expect(rejectedUpdate.status).toBe(403)
    expect(rejectedUpdate.body.error).toBe('sudo_required')

    const disabled = await fetchJson<{ ok?: boolean }>(request, 'PUT', configPath, {
      token,
      headers: {
        'x-sudo-token': manageSudo.sudoToken as string,
        [OPTIMISTIC_LOCK_HEADER_NAME]: configBefore.body.updatedAt,
      },
      data: { isEnabled: false },
    })
    expect(disabled.status).toBe(200)
    expect(disabled.body.ok).toBe(true)
    const allowed = await reset()
    expect(allowed.status).toBe(200)
    expect(allowed.body.ok).toBe(true)

    const configDisabled = await fetchJson<{ isEnabled: boolean; updatedAt: string }>(request, 'GET', configPath, { token })
    expect(configDisabled.status).toBe(200)
    expect(configDisabled.body.isEnabled).toBe(false)
    const enabled = await fetchJson<{ ok?: boolean }>(request, 'PUT', configPath, {
      token,
      headers: {
        'x-sudo-token': manageSudo.sudoToken as string,
        [OPTIMISTIC_LOCK_HEADER_NAME]: configDisabled.body.updatedAt,
      },
      data: { isEnabled: true },
    })
    expect(enabled.status).toBe(200)
    expect(enabled.body.ok).toBe(true)
    const protectedAgain = await reset()
    expect(protectedAgain.status).toBe(403)
    expect(protectedAgain.body.error).toBe('sudo_required')
  })
})
