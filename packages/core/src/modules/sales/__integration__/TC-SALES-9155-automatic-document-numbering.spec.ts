import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

const documents = [
  {
    path: '/api/sales/orders',
    idField: 'id',
    numberField: 'orderNumber',
    inputNumberField: 'orderNumber',
    lines: [{ name: 'QA line', currencyCode: 'USD', quantity: 1, unitPriceNet: 0, unitPriceGross: 0 }],
  },
  { path: '/api/sales/quotes', idField: 'id', numberField: 'quoteNumber', inputNumberField: 'quoteNumber' },
  { path: '/api/sales/invoices', idField: 'invoiceId', numberField: 'invoice_number', inputNumberField: 'invoiceNumber' },
  { path: '/api/sales/credit-memos', idField: 'creditMemoId', numberField: 'credit_memo_number', inputNumberField: 'creditMemoNumber' },
] as const

test('sales staff without number-edit permission can only use automatic numbering', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const suffix = randomUUID()
  const email = `qa-sales-numbering-${suffix}@example.com`
  const password = `QaSales1!${suffix}`
  const createdDocuments: Array<{ path: string; id: string }> = []
  let roleId: string | null = null
  let userId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, {
      name: `QA Sales Numbering ${suffix}`,
      tenantId: scope.tenantId ?? undefined,
    })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [
        'sales.orders.view', 'sales.orders.manage', 'sales.quotes.view', 'sales.quotes.manage',
        'sales.invoices.manage', 'sales.credit_memos.manage',
      ],
    })
    userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId: scope.organizationId!,
      roles: [roleId],
    })
    const token = await getAuthToken(request, email, password)

    for (const document of documents) {
      const data = { currencyCode: 'USD', ...('lines' in document ? { lines: document.lines } : {}) }
      const manualNumber = `MANUAL-${suffix}`
      const deniedCreate = await apiRequest(request, 'POST', document.path, {
        token,
        data: { ...data, [document.inputNumberField]: manualNumber },
      })
      if (deniedCreate.status() === 201) {
        const unexpected = await readJsonSafe<Record<string, string>>(deniedCreate)
        if (unexpected?.[document.idField]) {
          createdDocuments.push({ path: document.path, id: unexpected[document.idField] })
        }
      }
      expect(deniedCreate.status(), `manual create ${document.path}`).toBe(403)

      const created = await apiRequest(request, 'POST', document.path, { token, data })
      expect(created.status(), `create ${document.path}`).toBe(201)
      const result = await readJsonSafe<Record<string, string>>(created)
      const id = result?.[document.idField] ?? ''
      expect(id, `id from ${document.path}`).toBeTruthy()
      createdDocuments.push({ path: document.path, id })

      const response = await apiRequest(request, 'GET', `${document.path}?id=${encodeURIComponent(id)}`, { token })
      expect(response.status(), `read ${document.path}`).toBe(200)
      const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(response)
      const record = body?.items.find((item) => item.id === id)
      const assignedNumber = record?.[document.numberField]
      expect(assignedNumber).toMatch(/\S/)
      const updatedAt = record?.updatedAt ?? record?.updated_at
      if (typeof updatedAt !== 'string') throw new Error('[internal] document version missing')

      const deniedUpdate = await apiRequest(request, 'PUT', document.path, {
        token,
        headers: buildOptimisticLockHeader(updatedAt),
        data: { id, [document.inputNumberField]: manualNumber },
      })
      expect(deniedUpdate.status(), `manual update ${document.path}`).toBe(403)

      const afterUpdate = await apiRequest(request, 'GET', `${document.path}?id=${encodeURIComponent(id)}`, { token })
      expect(afterUpdate.status(), `read after refusal ${document.path}`).toBe(200)
      const unchanged = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(afterUpdate)
      expect(unchanged?.items.find((item) => item.id === id)?.[document.numberField]).toBe(assignedNumber)
    }
  } finally {
    for (const { path, id } of createdDocuments.reverse()) {
      await deleteSalesEntityIfExists(request, adminToken, path, id)
    }
    if (userId) await deleteUserIfExists(request, adminToken, userId)
    if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
  }
})
