import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

const initialPassword = ' Valid3!Profile '
const backendUrl = /\/backend(?:\/.*)?$/
const loginUrl = /\/login(?:\?.*)?$/

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await expect(page.locator('form[data-auth-ready="1"]')).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('checkbox', { name: 'Remember me' }).check()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(backendUrl)
}

async function sessionCookieNames(page: Page) {
  return (await page.context().cookies())
    .map(({ name }) => name)
    .filter((name) => name === 'auth_token' || name === 'session_token')
    .sort()
}

const profileTest = test.extend<{ account: { email: string; suffix: string; securityEnabled: boolean } }>({
  account: async ({ page, request }, use) => {
    const securityProbe = await request.get('/api/security/mfa')
    const securityEnabled = securityProbe.status() !== 404
    const adminToken = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const suffix = randomUUID()
    const email = `qa-profile-${suffix}@example.test`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      if (securityEnabled) {
        roleId = await createRoleFixture(request, adminToken, { name: `qa-profile-${suffix}`, tenantId })
        await setRoleAclFeatures(request, adminToken, {
          roleId,
          features: ['security.profile.view'],
          organizations: [organizationId],
        })
      }
      userId = await createUserFixture(request, adminToken, {
        email,
        password: initialPassword,
        organizationId,
        roles: roleId ? [roleId] : [],
      })
      await acknowledgeGlobalNotices(page)
      await use({ email, suffix, securityEnabled })
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  },
})

profileTest.describe('TC-AUTH-PROFILE-001: Self-service credentials in the browser', () => {
  profileTest('opens the Enterprise Security profile or verifies the OSS login-email change', async ({ page, account }) => {
    await signIn(page, account.email, initialPassword)
    expect(await sessionCookieNames(page)).toEqual(['auth_token', 'session_token'])
    await page.goto('/backend/auth/profile')

    if (account.securityEnabled) {
      await expect(page).toHaveURL(/\/backend\/profile\/security$/)
      await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible()
      return
    }

    const nextEmail = `qa-profile-updated-${account.suffix}@example.test`
    const email = page.getByRole('textbox', { name: 'Email *', exact: true })
    const save = page.getByRole('button', { name: 'Save changes', exact: true })
    await expect(email).toHaveValue(account.email)
    await email.fill(nextEmail)
    await save.click()

    await expect(page.getByText('Current password is required.', { exact: true }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/backend\/auth\/profile$/)

    await page.getByLabel('Current password', { exact: true }).fill(initialPassword)
    await save.click()
    await expect(page).toHaveURL(loginUrl)
    expect(await sessionCookieNames(page)).toEqual([])

    await signIn(page, nextEmail, initialPassword)
    await page.goto('/backend/auth/profile')
    await expect(email).toHaveValue(nextEmail)
  })

  profileTest('shows password byte limits and requires a fresh sign-in after an OSS password change', async ({ page, account }) => {
    profileTest.skip(account.securityEnabled, 'Enterprise delegates password changes to the Security profile')
    await signIn(page, account.email, initialPassword)
    expect(await sessionCookieNames(page)).toEqual(['auth_token', 'session_token'])
    await page.goto('/backend/profile/change-password')

    const currentPassword = page.getByLabel('Current password', { exact: true })
    const newPassword = page.getByLabel('New password', { exact: true })
    const confirmation = page.getByLabel('Confirm new password', { exact: true })
    const save = page.getByRole('button', { name: 'Save changes', exact: true })
    await expect(page.getByText('At most 72 bytes (UTF-8)', { exact: false })).toBeVisible()

    const oversizedPassword = `Valid3!${'é'.repeat(33)}`
    await currentPassword.fill(initialPassword)
    await newPassword.fill(oversizedPassword)
    await confirmation.fill(oversizedPassword)
    await save.click()
    await expect(page.getByText('Password must meet the requirements.', { exact: true }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/backend\/profile\/change-password$/)

    const changedPassword = 'Changed4!Profile'
    await newPassword.fill(changedPassword)
    await confirmation.fill(changedPassword)
    await save.click()
    await expect(page).toHaveURL(loginUrl)
    expect(await sessionCookieNames(page)).toEqual([])

    await signIn(page, account.email, changedPassword)
  })
})
