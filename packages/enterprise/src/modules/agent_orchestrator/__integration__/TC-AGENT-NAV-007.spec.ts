import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentOrchestratorRowsForOrganization,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

for (const count of [0, 1, 100]) {
  test(`TC-AGENT-NAV-007: Caseload sidebar with ${count} pending proposals`, async ({ page, request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const tenantId = getTokenContext(token).tenantId || getTokenContext(await getAuthToken(request, 'admin')).tenantId
    if (!tenantId) throw new Error('[internal] A tenant is required for the sidebar organization fixture')

    const name = `qa-caseload-sidebar-${randomUUID()}`
    const email = `${name}@example.com`
    const password = `Qa!${randomUUID()}`
    const caseloadPath = '/backend/caseload'
    const caseloadSelector = `[data-menu-item-id="${caseloadPath}"]`
    const countLabel = (count: number) => `${count} waiting for your decision`
    const desktop = page.locator('aside').first()
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, token, { name, tenantId })
      roleId = await createRoleFixture(request, token, { name, tenantId })
      await setRoleAclFeatures(request, token, {
        roleId,
        features: ['agent_orchestrator.proposals.view'],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, token, {
        email, password, organizationId, roles: [roleId], name,
      })

      if (count > 0) {
        const seed = { tenantId, organizationId, agentId: name, createdAt: new Date() }
        const [runId] = await insertAgentRunFixtures([seed])
        await insertAgentProposalFixtures(Array.from({ length: count }, () => ({
          ...seed, runId, disposition: 'pending',
        })))
      }

      const login = await page.request.post('/api/auth/login', { form: { email, password } })
      expect(login.ok()).toBe(true)
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => {
          const url = new URL(candidate.url())
          return url.pathname === '/api/agent_orchestrator/proposals'
            && url.searchParams.get('disposition') === 'pending'
            && url.searchParams.get('pageSize') === '1'
        }),
        page.goto('/backend/overview'),
      ])
      expect(response.ok()).toBe(true)
      expect(await response.json()).toMatchObject({ total: count })

      const caseload = desktop.locator(caseloadSelector)
      await expect(caseload.getByText('Caseload', { exact: true })).toBeVisible()
      if (count === 0) {
        await expect(caseload.locator('[aria-label]')).toHaveCount(0)
        return
      }

      const badge = caseload.getByLabel(countLabel(count), { exact: true })
      await expect(badge).toBeVisible()
      await expect(badge).toHaveText(count > 99 ? '99+' : String(count))
      if (count > 99) return

      const overview = desktop.getByRole('link', { name: 'Overview', exact: true })
      await expect(overview).toBeVisible()
      await expect(overview.locator('[aria-label]')).toHaveCount(0)

      const agents = desktop.getByRole('button', { name: 'Agents', exact: true })
      await agents.click()
      await expect(caseload).toBeHidden()
      await agents.click()
      await expect(badge).toBeVisible()

      await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
      await expect(caseload).toHaveAttribute('title', 'Caseload')
      await expect(badge).toHaveText('1')

      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Open menu', exact: true }).click()
      const mobileCaseload = page.locator('#mobile-drawer-tabpanel').locator(caseloadSelector)
      const mobileBadge = mobileCaseload.getByLabel(countLabel(1), { exact: true })
      await expect(mobileBadge).toBeVisible()
      await expect(mobileBadge).toHaveText('1')
      await mobileCaseload.click()
      await expect(page).toHaveURL(new RegExp(`${caseloadPath}$`))
    } finally {
      const results = await Promise.allSettled([
        deleteAgentOrchestratorRowsForOrganization(organizationId),
        deleteUserIfExists(request, token, userId),
      ])
      await deleteRoleIfExists(request, token, roleId)
      await deleteOrganizationIfExists(request, token, organizationId)
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
      }
    }
  })
}
