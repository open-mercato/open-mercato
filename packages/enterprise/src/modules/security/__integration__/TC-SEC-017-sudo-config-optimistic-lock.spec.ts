import { expect, test, type Page } from '@playwright/test'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { fetchJson, generateTotpCode, setAuthCookie } from './helpers/securityFixtures'
import { createIsolatedMfaSudoFixture, verifyTotpSudoChallenge } from './helpers/sudoFixtures'

type ConfigVersion = { updatedAt: string; label: string }

async function confirmSudo(page: Page, secret: string) {
  const dialog = page.getByRole('dialog', { name: 'Confirm sensitive action' })
  await dialog.getByLabel('Verification code').fill(generateTotpCode(secret))
  await dialog.getByRole('button', { name: 'Verify', exact: true }).click()
}

test.describe.configure({ timeout: 90_000 })

for (const operation of ['PUT', 'DELETE'] as const) {
  test(`a stale sudo config ${operation} shows the record conflict in the browser`, async ({ page, request }) => {
    const fixture = await createIsolatedMfaSudoFixture(request)
    try {
      const { token, secret, resetConfigId } = fixture
      const path = `/api/security/sudo/configs/${resetConfigId}`
      const sudo = await verifyTotpSudoChallenge(request, { token, secret, targetIdentifier: 'security.sudo.manage' })
      const original = await fetchJson<ConfigVersion>(request, 'GET', path, { token })
      expect(original.status).toBe(200)
      await setAuthCookie(page, token)
      await page.goto(`/backend/security/sudo/${resetConfigId}/edit`)
      const label = page.getByRole('textbox', { name: 'Label (optional)', exact: true })
      const form = page.locator('form').filter({ has: label })
      await expect(label).toHaveValue(original.body.label)

      const latest = await fetchJson<ConfigVersion>(request, 'PUT', path, {
        token,
        headers: { 'x-sudo-token': sudo.sudoToken as string, [OPTIMISTIC_LOCK_HEADER_NAME]: original.body.updatedAt },
        data: { label: 'Saved in another session' },
      })
      expect(latest.status).toBe(200)
      expect(latest.body.updatedAt).not.toBe(original.body.updatedAt)
      const rejected = page.waitForResponse((response) =>
        new URL(response.url()).pathname === path && response.request().method() === operation)
      if (operation === 'PUT') {
        await label.fill('Stale edit')
        await form.getByRole('button', { name: 'Save', exact: true }).click()
      } else {
        await form.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
      }
      await confirmSudo(page, secret)
      const response = await rejected
      expect(response.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(original.body.updatedAt)
      expect(response.status()).toBe(409)
      expect(await response.json()).toEqual({
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: latest.body.updatedAt,
        expectedUpdatedAt: original.body.updatedAt,
      })
      await expect(page.getByTestId('record-conflict-banner')).toBeVisible()
      const current = await fetchJson<ConfigVersion>(request, 'GET', path, { token })
      expect(current.body).toMatchObject({ label: 'Saved in another session', updatedAt: latest.body.updatedAt })
    } finally {
      await fixture.cleanup()
    }
  })
}

test('concurrent authenticated writers share a single version winner and accept legacy saves', async ({ request }) => {
  const fixture = await createIsolatedMfaSudoFixture(request)
  try {
    const { token, secret, resetConfigId } = fixture
    const path = `/api/security/sudo/configs/${resetConfigId}`
    const sudo = await verifyTotpSudoChallenge(request, { token, secret, targetIdentifier: 'security.sudo.manage' })
    const initial = await fetchJson<ConfigVersion>(request, 'GET', path, { token })
    expect(initial.status).toBe(200)
    const save = (label: string, expectedUpdatedAt?: string) => fetchJson<{ ok?: true; updatedAt?: string; code?: string }>(request, 'PUT', path, {
      token,
      headers: {
        'x-sudo-token': sudo.sudoToken as string,
        ...(expectedUpdatedAt && { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt }),
      },
      data: { label },
    })
    const responses = await Promise.all([
      save('First editor', initial.body.updatedAt),
      save('Second editor', initial.body.updatedAt),
    ])
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409])
    expect(responses.find(({ status }) => status === 409)?.body.code).toBe('optimistic_lock_conflict')
    const winner = responses.find(({ status }) => status === 200)
    expect(winner?.body.updatedAt).toBeTruthy()
    const subsequent = await save('Current edit', winner?.body.updatedAt)
    expect(subsequent.status).toBe(200)
    const headerless = await save('Legacy edit')
    expect(headerless.status).toBe(200)
    const current = await fetchJson<ConfigVersion>(request, 'GET', path, { token })
    expect(current.body).toMatchObject({ label: 'Legacy edit', updatedAt: headerless.body.updatedAt })
  } finally {
    await fixture.cleanup()
  }
})
