import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createOrganizationFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-AUD-8200: identify and undo the intended organization from a laptop audit table', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(token)
  const records: Array<{ id: string; before: string; after: string; logId?: string }> = []
  let scopeId: string | null = null
  const suffix = `${Date.now()}-${testInfo.parallelIndex}`

  try {
    scopeId = await createOrganizationFixture(request, token, { name: `Audit scope 8200 ${suffix}`, tenantId })
    for (const label of ['A', 'B']) {
      const before = `Audit 8200 ${suffix} ${label}`
      const after = `${before} renamed`
      const created = await apiRequestWithSelectedOrg(request, 'POST', '/api/directory/organizations', {
        token, selectedOrgId: scopeId, data: { name: before, tenantId },
      })
      expect(created.status()).toBe(201)
      const body = await readJsonSafe<{ id: string }>(created)
      expect(body?.id).toBeTruthy()
      const record: (typeof records)[number] = { id: body!.id, before, after }
      records.push(record)
      const updated = await apiRequestWithSelectedOrg(request, 'PUT', '/api/directory/organizations', {
        token, selectedOrgId: scopeId, data: { id: record.id, name: after },
      })
      expect(updated.status()).toBe(200)
      const auditResponse = await apiRequestWithSelectedOrg(request, 'GET', `/api/audit_logs/audit-logs/actions?resourceKind=directory.organization&resourceId=${record.id}`, { token, selectedOrgId: scopeId })
      expect(auditResponse.status()).toBe(200)
      const auditBody = await readJsonSafe<{ items: Array<{ id: string; commandId: string }> }>(auditResponse)
      record.logId = auditBody?.items.find((entry) => entry.commandId === 'directory.organizations.update')?.id
      expect(record.logId).toBeTruthy()
    }

    await page.setViewportSize({ width: 1280, height: 800 })
    await login(page, 'superadmin')
    await page.context().addCookies([
      { name: 'locale', value: 'pl', url: new URL(page.url()).origin },
      { name: 'om_selected_org', value: scopeId, url: new URL(page.url()).origin },
    ])
    await page.goto('/backend/audit-logs')

    const [first, second] = records
    const firstRow = page.getByRole('row').filter({ has: page.getByText(first.after, { exact: true }) })
    const secondRow = page.getByRole('row').filter({ has: page.getByText(second.after, { exact: true }) })
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()
    await expect(firstRow.getByText(`Nazwa: ${first.before} → ${first.after}`, { exact: true })).toBeVisible()
    await expect(firstRow.getByText('Wykonano', { exact: true })).toBeVisible()
    await expect(firstRow).toContainText(/\d{1,2}:\d{2}:\d{2}/)

    const undo = firstRow.getByRole('button', { name: 'Cofnij to działanie', exact: true })
    await expect(undo).toBeInViewport()
    await expect(undo).toBeEnabled()
    await undo.evaluate((button) => {
      let ancestor = button.parentElement
      while (ancestor && ancestor.scrollWidth <= ancestor.clientWidth) ancestor = ancestor.parentElement
      if (ancestor) ancestor.scrollLeft = ancestor.scrollWidth
    })
    await expect(undo).toBeInViewport()
    await undo.evaluate((button) => {
      let ancestor = button.parentElement
      while (ancestor && ancestor.scrollWidth <= ancestor.clientWidth) ancestor = ancestor.parentElement
      if (ancestor) ancestor.scrollLeft = 0
    })
    await expect(undo).toBeInViewport()
    await expect(undo).toHaveAttribute('title', 'Cofnij to działanie')
    await page.screenshot({ path: testInfo.outputPath('issue-8200-before-undo.png'), fullPage: true })
    await undo.focus()
    await undo.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(firstRow.getByText('Cofnięto', { exact: true })).toBeVisible()
    const auditResponse = await apiRequestWithSelectedOrg(request, 'GET', `/api/audit_logs/audit-logs/actions?resourceId=${first.id}`, { token, selectedOrgId: scopeId })
    expect(auditResponse.status()).toBe(200)
    const auditBody = await readJsonSafe<{ items: Array<{ id: string; executionState: string }> }>(auditResponse)
    expect(auditBody?.items.find((entry) => entry.id === first.logId)?.executionState).toBe('undone')

    const readNames = async () => {
      const response = await apiRequest(request, 'GET', `/api/directory/organizations?view=options&tenantId=${tenantId}&ids=${records.map((record) => record.id).join(',')}`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items: Array<{ id: string; name: string }> }>(response)
      return Object.fromEntries((body?.items ?? []).map((record) => [record.id, record.name]))
    }
    await expect.poll(readNames).toEqual({ [first.id]: first.before, [second.id]: second.after })

    const redo = firstRow.getByRole('button', { name: 'Ponów to działanie', exact: true })
    await expect(redo).toBeInViewport()
    await redo.click()
    await expect.poll(readNames).toEqual({ [first.id]: first.after, [second.id]: second.after })
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    for (const record of records.reverse()) {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', record.id)
    }
    await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', scopeId)
  }
})
