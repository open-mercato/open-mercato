import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAgentProcessesForOrganization, insertAgentProcessFixture } from './helpers/agentUxFixtures'

/**
 * TC-AGENT-UXC-005: Processes search narrows the server-paginated list.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 6: debounced search box over the route's existing `q` →
 * `subject_label $ilike`; facet counts share the filter).
 *
 * Seeds three processes with distinct subject labels; typing a label fragment
 * must narrow the table to the two matching rows AND the All-facet count badge
 * must reflect the filtered total (counts share `q`).
 */

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UXC-005: processes search over q', () => {
  test('typing a subject fragment narrows rows and the facet total', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    expect(tenantId, 'a tenant id is required to place the throwaway org').toBeTruthy()

    let orgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const email = `tc-uxc-005-${stamp}@example.com`
    const matchLabelA = `UXC005-MATCH-A-${stamp}`
    const matchLabelB = `UXC005-MATCH-B-${stamp}`
    const otherLabel = `UXC005-OTHER-${stamp}`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-UXC-005 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-uxc-005-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.processes.view', 'agent_orchestrator.proposals.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-UXC-005',
      })

      for (const subjectLabel of [matchLabelA, matchLabelB, otherLabel]) {
        await insertAgentProcessFixture({ tenantId: tenantId!, organizationId: orgId!, subjectLabel })
      }

      await loginAs(page, email, password)
      await page.goto('/backend/processes', { waitUntil: 'domcontentloaded' })

      // Baseline: all three seeded rows visible.
      await expect(page.getByText(otherLabel)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(matchLabelA)).toBeVisible()

      const searchBox = page.getByPlaceholder(/subject reference/i)
      await expect(searchBox).toBeVisible()
      await searchBox.fill('UXC005-MATCH')

      // Debounced server filter: two matches remain, the non-match drops out.
      await expect(page.getByText(otherLabel)).toBeHidden({ timeout: 15_000 })
      await expect(page.getByText(matchLabelA)).toBeVisible()
      await expect(page.getByText(matchLabelB)).toBeVisible()
      await expect(page.locator('table tbody tr')).toHaveCount(2)

      // Facet counts share the filter — the All badge shows the filtered total.
      const allTab = page.getByRole('button', { name: /all/i }).first()
      await expect(allTab).toContainText('2')

      // The searchable-scope hint is visible next to the box.
      await expect(page.getByText(/encrypted titles/i)).toBeVisible()
    } finally {
      await deleteAgentProcessesForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
